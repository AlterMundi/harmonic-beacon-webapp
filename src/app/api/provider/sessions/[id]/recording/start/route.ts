import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { getEgressClient } from '@/lib/livekit-server';
import { EncodedFileOutput, EncodedFileType } from 'livekit-server-sdk';

export const dynamic = 'force-dynamic';

const RECORDINGS_PATH = process.env.RECORDINGS_PATH || '/data/recordings';

/**
 * POST /api/provider/sessions/[id]/recording/start
 * Start room composite egress recording (audio-only OGG).
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
        const filepath = `${RECORDINGS_PATH}/${scheduledSession.roomName}-${timestamp}.ogg`;

        const output = new EncodedFileOutput({
            fileType: EncodedFileType.OGG,
            filepath,
        });

        const egress = await egressClient.startRoomCompositeEgress(
            scheduledSession.roomName,
            output,
            '',       // layout
            undefined, // encoding options
            true,     // audioOnly
        );

        // Save egressId immediately so we can stop it if needed
        await prisma.scheduledSession.update({
            where: { id },
            data: { egressId: egress.egressId },
        });

        // Poll until egress is actually active (status 1 = EGRESS_ACTIVE)
        const POLL_INTERVAL = 1000;
        const MAX_WAIT = 30000;
        let elapsed = 0;
        let active = false;

        while (elapsed < MAX_WAIT) {
            await new Promise((r) => setTimeout(r, POLL_INTERVAL));
            elapsed += POLL_INTERVAL;

            try {
                const list = await egressClient.listEgress({ egressId: egress.egressId });
                const info = list[0];
                if (info && info.status === 1) {
                    active = true;
                    break;
                }
                // Status 0 = STARTING, keep polling
                // Any other status means it failed
                if (info && info.status > 1) break;
            } catch {
                // Polling error, keep trying
            }
        }

        if (!active) {
            // Egress didn't start — attempt cleanup
            try { await egressClient.stopEgress(egress.egressId); } catch { /* ignore */ }
            await prisma.scheduledSession.update({
                where: { id },
                data: { egressId: null, recordingPath: null },
            });
            return NextResponse.json(
                { error: 'Recording failed to start — try again' },
                { status: 500 },
            );
        }

        // Egress is active — now save the recording path
        await prisma.scheduledSession.update({
            where: { id },
            data: { recordingPath: filepath },
        });

        return NextResponse.json({
            egressId: egress.egressId,
            recordingPath: filepath,
        });
    } catch (e) {
        console.error('Failed to start recording:', e);
        return NextResponse.json(
            { error: 'Failed to start recording' },
            { status: 500 },
        );
    }
}
