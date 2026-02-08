import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { getEgressClient } from '@/lib/livekit-server';
import { existsSync } from 'fs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/provider/sessions/[id]/recording/stop
 * Stop egress recording. Verifies the file was written; cleans up if not.
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

    if (!scheduledSession.egressId) {
        return NextResponse.json(
            { error: 'No recording in progress' },
            { status: 400 },
        );
    }

    try {
        const egressClient = getEgressClient();
        await egressClient.stopEgress(scheduledSession.egressId);
    } catch (e) {
        console.error('Failed to stop egress:', e);
        // Continue — egress may have already stopped or crashed
    }

    // Wait briefly for the egress to finalize the file
    await new Promise((r) => setTimeout(r, 2000));

    // Verify the recording file exists; clean up recordingPath if not
    const fileExists = scheduledSession.recordingPath && existsSync(scheduledSession.recordingPath);

    await prisma.scheduledSession.update({
        where: { id },
        data: {
            egressId: null,
            recordingPath: fileExists ? scheduledSession.recordingPath : null,
        },
    });

    if (!fileExists) {
        return NextResponse.json({
            ok: false,
            error: 'Recording stopped but no file was produced',
        }, { status: 500 });
    }

    return NextResponse.json({ ok: true, recordingPath: scheduledSession.recordingPath });
}
