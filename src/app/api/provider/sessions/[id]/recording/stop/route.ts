import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { getEgressClient } from '@/lib/livekit-server';
import { existsSync } from 'fs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/provider/sessions/[id]/recording/stop
 * Stop both session and beacon egress recordings.
 * Verifies both files were written; cleans up paths if not.
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

    if (!scheduledSession.egressId && !scheduledSession.beaconEgressId) {
        return NextResponse.json(
            { error: 'No recording in progress' },
            { status: 400 },
        );
    }

    const egressClient = getEgressClient();

    // Stop both egresses in parallel
    await Promise.allSettled([
        scheduledSession.egressId
            ? egressClient.stopEgress(scheduledSession.egressId).catch((e: unknown) => {
                console.error('Failed to stop session egress:', e);
            })
            : Promise.resolve(),
        scheduledSession.beaconEgressId
            ? egressClient.stopEgress(scheduledSession.beaconEgressId).catch((e: unknown) => {
                console.error('Failed to stop beacon egress:', e);
            })
            : Promise.resolve(),
    ]);

    // Wait briefly for egresses to finalize files
    await new Promise((r) => setTimeout(r, 2000));

    // Verify files exist
    const sessionFileExists = scheduledSession.recordingPath && existsSync(scheduledSession.recordingPath);
    const beaconFileExists = scheduledSession.beaconRecordingPath && existsSync(scheduledSession.beaconRecordingPath);

    await prisma.scheduledSession.update({
        where: { id },
        data: {
            egressId: null,
            beaconEgressId: null,
            recordingPath: sessionFileExists ? scheduledSession.recordingPath : null,
            beaconRecordingPath: beaconFileExists ? scheduledSession.beaconRecordingPath : null,
        },
    });

    if (!sessionFileExists) {
        return NextResponse.json({
            ok: false,
            error: 'Recording stopped but session file was not produced',
        }, { status: 500 });
    }

    return NextResponse.json({
        ok: true,
        recordingPath: scheduledSession.recordingPath,
        beaconRecordingPath: beaconFileExists ? scheduledSession.beaconRecordingPath : null,
    });
}
