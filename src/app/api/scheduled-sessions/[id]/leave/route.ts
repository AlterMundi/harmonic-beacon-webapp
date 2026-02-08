import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * POST /api/scheduled-sessions/[id]/leave
 * Record that a participant left a session.
 */
export async function POST(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    const { id } = await params;

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const participant = await prisma.sessionParticipant.findUnique({
        where: {
            sessionId_userId: { sessionId: id, userId: user.id },
        },
    });

    if (!participant) {
        return NextResponse.json({ error: 'Not a participant' }, { status: 404 });
    }

    // Already left — don't recalculate duration
    if (participant.leftAt) {
        return NextResponse.json({ ok: true });
    }

    const now = new Date();
    const durationSeconds = Math.floor(
        (now.getTime() - participant.joinedAt.getTime()) / 1000,
    );

    await prisma.sessionParticipant.update({
        where: { id: participant.id },
        data: { leftAt: now, durationSeconds },
    });

    return NextResponse.json({ ok: true });
}
