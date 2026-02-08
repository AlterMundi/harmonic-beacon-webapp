import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { getEgressClient } from '@/lib/livekit-server';

export const dynamic = 'force-dynamic';

/**
 * POST /api/provider/sessions/[id]/recording/stop
 * Stop egress recording and save path to DB.
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

        await prisma.scheduledSession.update({
            where: { id },
            data: { egressId: null },
        });

        return NextResponse.json({ ok: true, recordingPath: scheduledSession.recordingPath });
    } catch (e) {
        console.error('Failed to stop recording:', e);
        return NextResponse.json(
            { error: 'Failed to stop recording' },
            { status: 500 },
        );
    }
}
