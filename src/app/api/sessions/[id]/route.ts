import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/sessions/[id]
 * End a session — set endedAt, durationSeconds, completed
 * Body: { completed?: boolean }
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    const { id } = await params;
    const body = await request.json();

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Find the session and verify ownership
    const listeningSession = await prisma.listeningSession.findUnique({
        where: { id },
    });

    if (!listeningSession) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (listeningSession.userId !== user.id) {
        return NextResponse.json({ error: 'Not your session' }, { status: 403 });
    }

    // Calculate duration
    const now = new Date();
    const durationSeconds = Math.floor((now.getTime() - listeningSession.startedAt.getTime()) / 1000);

    const updated = await prisma.listeningSession.update({
        where: { id },
        data: {
            endedAt: now,
            durationSeconds,
            completed: body.completed ?? true,
        },
    });

    return NextResponse.json({
        session: {
            id: updated.id,
            durationSeconds: updated.durationSeconds,
            completed: updated.completed,
            startedAt: updated.startedAt.toISOString(),
            endedAt: updated.endedAt?.toISOString() ?? null,
        },
    });
}
