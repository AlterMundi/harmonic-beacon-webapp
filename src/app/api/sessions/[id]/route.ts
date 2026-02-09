import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions/[id]
 * Get scheduled session metadata for playback.
 * Access: provider, session participant, or admin.
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    const { id } = await params;

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true, role: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id },
        include: {
            provider: { select: { name: true } },
            recordings: {
                where: { active: false },
                select: {
                    id: true,
                    participantIdentity: true,
                    category: true,
                },
            },
        },
    });

    if (!scheduledSession) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Access check: provider, participant, or admin
    const isProvider = scheduledSession.providerId === user.id;
    const isAdmin = user.role === 'ADMIN';

    if (!isProvider && !isAdmin) {
        const participant = await prisma.sessionParticipant.findUnique({
            where: {
                sessionId_userId: { sessionId: id, userId: user.id },
            },
            select: { id: true },
        });
        if (!participant) {
            return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
        }
    }

    return NextResponse.json({
        session: {
            id: scheduledSession.id,
            title: scheduledSession.title,
            description: scheduledSession.description,
            providerName: scheduledSession.provider.name,
            durationSeconds: scheduledSession.durationSeconds,
            startedAt: scheduledSession.startedAt?.toISOString() ?? null,
            endedAt: scheduledSession.endedAt?.toISOString() ?? null,
            recordings: scheduledSession.recordings,
        },
    });
}

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
