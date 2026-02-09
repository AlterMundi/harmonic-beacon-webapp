import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { getEgressClient } from '@/lib/livekit-server';
import { EncodedFileOutput, EncodedFileType, type EgressClient, type EgressInfo } from 'livekit-server-sdk';

export const dynamic = 'force-dynamic';

const RECORDINGS_PATH = process.env.RECORDINGS_PATH || '/data/recordings';
const BEACON_ROOM = process.env.LIVEKIT_ROOM_NAME || 'beacon';

/**
 * Poll until an egress reaches ACTIVE status (1) or fails.
 * Returns true if active, false otherwise.
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

/**
 * POST /api/provider/sessions/[id]/recording/start
 * Start dual room composite egress recording (session + beacon, audio-only OGG).
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

    if (scheduledSession.egressId) {
        return NextResponse.json(
            { error: 'Recording already in progress' },
            { status: 409 },
        );
    }

    try {
        const egressClient = getEgressClient();
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        // Session egress
        const sessionFilepath = `${RECORDINGS_PATH}/${scheduledSession.roomName}-${timestamp}.ogg`;
        const sessionOutput = new EncodedFileOutput({
            fileType: EncodedFileType.OGG,
            filepath: sessionFilepath,
        });
        const sessionEgress = await egressClient.startRoomCompositeEgress(
            scheduledSession.roomName,
            sessionOutput,
            '',        // layout
            undefined, // encoding options
            true,      // audioOnly
        );

        // Beacon egress
        const beaconFilepath = `${RECORDINGS_PATH}/beacon-${scheduledSession.roomName}-${timestamp}.ogg`;
        const beaconOutput = new EncodedFileOutput({
            fileType: EncodedFileType.OGG,
            filepath: beaconFilepath,
        });
        const beaconEgress = await egressClient.startRoomCompositeEgress(
            BEACON_ROOM,
            beaconOutput,
            '',        // layout
            undefined, // encoding options
            true,      // audioOnly
        );

        // Save both egress IDs immediately
        await prisma.scheduledSession.update({
            where: { id },
            data: {
                egressId: sessionEgress.egressId,
                beaconEgressId: beaconEgress.egressId,
            },
        });

        // Poll both in parallel
        const [sessionActive, beaconActive] = await Promise.all([
            pollEgressActive(egressClient, sessionEgress.egressId),
            pollEgressActive(egressClient, beaconEgress.egressId),
        ]);

        if (!sessionActive) {
            // Session egress failed — clean up both
            try { await egressClient.stopEgress(sessionEgress.egressId); } catch { /* ignore */ }
            try { await egressClient.stopEgress(beaconEgress.egressId); } catch { /* ignore */ }
            await prisma.scheduledSession.update({
                where: { id },
                data: {
                    egressId: null,
                    recordingPath: null,
                    beaconEgressId: null,
                    beaconRecordingPath: null,
                },
            });
            return NextResponse.json(
                { error: 'Recording failed to start — try again' },
                { status: 500 },
            );
        }

        // Session OK — save session recording path
        // Handle beacon result: save path if active, clear fields if not
        if (!beaconActive) {
            try { await egressClient.stopEgress(beaconEgress.egressId); } catch { /* ignore */ }
            await prisma.scheduledSession.update({
                where: { id },
                data: {
                    recordingPath: sessionFilepath,
                    beaconEgressId: null,
                    beaconRecordingPath: null,
                },
            });
            return NextResponse.json({
                egressId: sessionEgress.egressId,
                recordingPath: sessionFilepath,
                beaconRecordingFailed: true,
            });
        }

        // Both OK
        await prisma.scheduledSession.update({
            where: { id },
            data: {
                recordingPath: sessionFilepath,
                beaconRecordingPath: beaconFilepath,
            },
        });

        return NextResponse.json({
            egressId: sessionEgress.egressId,
            recordingPath: sessionFilepath,
            beaconEgressId: beaconEgress.egressId,
            beaconRecordingPath: beaconFilepath,
        });
    } catch (e) {
        console.error('Failed to start recording:', e);
        return NextResponse.json(
            { error: 'Failed to start recording' },
            { status: 500 },
        );
    }
}
