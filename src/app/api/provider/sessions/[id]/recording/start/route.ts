import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { getEgressClient, getRoomService } from '@/lib/livekit-server';
import {
    DirectFileOutput,
    TrackType,
    type EgressClient,
    type EgressInfo,
} from 'livekit-server-sdk';

export const dynamic = 'force-dynamic';

const RECORDINGS_PATH = process.env.RECORDINGS_PATH || '/data/recordings';
const BEACON_ROOM = process.env.LIVEKIT_ROOM_NAME || 'beacon';
const BEACON_IDENTITY = process.env.BEACON_IDENTITY || 'beacon01';

/**
 * Poll until an egress reaches ACTIVE status (1) or fails.
 */
async function pollEgressActive(
    client: EgressClient,
    egressId: string,
    maxWait = 30000,
): Promise<boolean> {
    const POLL_INTERVAL = 1000;
    let elapsed = 0;

    while (elapsed < maxWait) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL));
        elapsed += POLL_INTERVAL;

        try {
            const list = await client.listEgress({ egressId });
            const info: EgressInfo | undefined = list[0];
            if (info && info.status === 1) return true;   // EGRESS_ACTIVE
            if (info && info.status > 1) return false;     // Failed/ended
        } catch {
            // Polling error, keep trying
        }
    }
    return false;
}

interface TrackTarget {
    roomName: string;
    identity: string;
    trackSid: string;
    category: 'SESSION' | 'BEACON';
}

/**
 * Snapshot all publishing participants with unmuted audio tracks.
 */
async function snapshotPublishers(sessionRoomName: string): Promise<TrackTarget[]> {
    const roomService = getRoomService();
    const targets: TrackTarget[] = [];

    // Session room — all participants with unmuted audio
    try {
        const participants = await roomService.listParticipants(sessionRoomName);
        for (const p of participants) {
            for (const t of p.tracks) {
                if (t.type === TrackType.AUDIO && !t.muted && t.sid) {
                    targets.push({
                        roomName: sessionRoomName,
                        identity: p.identity,
                        trackSid: t.sid,
                        category: 'SESSION',
                    });
                }
            }
        }
    } catch (e) {
        console.error('Failed to list session room participants:', e);
    }

    // Beacon room — beacon01 participant
    try {
        const participants = await roomService.listParticipants(BEACON_ROOM);
        const beacon = participants.find((p) => p.identity === BEACON_IDENTITY);
        if (beacon) {
            const audioTrack = beacon.tracks.find(
                (t) => t.type === TrackType.AUDIO && !t.muted,
            );
            if (audioTrack?.sid) {
                targets.push({
                    roomName: BEACON_ROOM,
                    identity: BEACON_IDENTITY,
                    trackSid: audioTrack.sid,
                    category: 'BEACON',
                });
            }
        }
    } catch (e) {
        console.error('Failed to list beacon room participants:', e);
    }

    return targets;
}

/**
 * POST /api/provider/sessions/[id]/recording/start
 * Start per-track egress recording for every publishing participant.
 */
export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [session, errorResponse] = await requireRole('PROVIDER', 'ADMIN');
    if (!session) return errorResponse;

    const { id } = await params;

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id },
    });

    if (!scheduledSession) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (scheduledSession.providerId !== user.id) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (scheduledSession.status !== 'LIVE') {
        return NextResponse.json(
            { error: 'Can only record a LIVE session' },
            { status: 400 },
        );
    }

    // Check for already-active recordings
    const existingActive = await prisma.sessionRecording.findFirst({
        where: { sessionId: id, active: true },
    });
    if (existingActive) {
        return NextResponse.json(
            { error: 'Recording already in progress' },
            { status: 409 },
        );
    }

    try {
        const egressClient = getEgressClient();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        // Snapshot all publishers
        const targets = await snapshotPublishers(scheduledSession.roomName);

        if (targets.length === 0) {
            return NextResponse.json(
                { error: 'No audio tracks found to record' },
                { status: 400 },
            );
        }

        // Start track egress for each target
        const startResults: Array<{
            target: TrackTarget;
            egress: EgressInfo;
            filePath: string;
        }> = [];

        await Promise.all(
            targets.map(async (target) => {
                const filePath = `${RECORDINGS_PATH}/${target.roomName}-${target.identity}-${timestamp}.ogg`;
                const output = new DirectFileOutput({ filepath: filePath });
                const egress = await egressClient.startTrackEgress(
                    target.roomName,
                    output,
                    target.trackSid,
                );
                startResults.push({ target, egress, filePath });
            }),
        );

        // Poll all egresses in parallel
        const pollResults = await Promise.all(
            startResults.map(async (r) => ({
                ...r,
                active: await pollEgressActive(egressClient, r.egress.egressId),
            })),
        );

        // Require at least 1 track to be active
        const activeTracks = pollResults.filter((r) => r.active);

        if (activeTracks.length === 0) {
            // All tracks failed — stop everything and bail
            await Promise.allSettled(
                pollResults.map((r) =>
                    egressClient.stopEgress(r.egress.egressId).catch(() => {}),
                ),
            );
            return NextResponse.json(
                { error: 'Recording failed to start — try again' },
                { status: 500 },
            );
        }

        // Stop failed egresses, keep active ones
        const activeResults = pollResults.filter((r) => r.active);
        const failedResults = pollResults.filter((r) => !r.active);

        await Promise.allSettled(
            failedResults.map((r) =>
                egressClient.stopEgress(r.egress.egressId).catch(() => {}),
            ),
        );

        // Create SessionRecording rows in a transaction
        const recordings = await prisma.$transaction(
            activeResults.map((r) =>
                prisma.sessionRecording.create({
                    data: {
                        sessionId: id,
                        egressId: r.egress.egressId,
                        trackSid: r.target.trackSid,
                        roomName: r.target.roomName,
                        participantIdentity: r.target.identity,
                        category: r.target.category,
                        filePath: r.filePath,
                        active: true,
                    },
                }),
            ),
        );

        return NextResponse.json({
            recordings: recordings.map((r) => ({
                id: r.id,
                participantIdentity: r.participantIdentity,
                category: r.category,
                egressId: r.egressId,
            })),
        });
    } catch (e) {
        console.error('Failed to start recording:', e);
        return NextResponse.json(
            { error: 'Failed to start recording' },
            { status: 500 },
        );
    }
}
