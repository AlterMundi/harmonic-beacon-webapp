import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { computeCompleted } from '@/lib/session-completion';

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
 * Body: ignored. `completed` is computed server-side per BUSINESS_RULES.md §2.3;
 * a client-supplied value is discarded.
 */
export async function PATCH(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
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

    // Find the session and verify ownership
    const listeningSession = await prisma.listeningSession.findUnique({
        where: { id },
        include: {
            meditation: { select: { durationSeconds: true } },
            scheduledSession: { select: { status: true } },
        },
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

    // BUSINESS_RULES.md §2.3: derived from the server's own facts, never asserted
    // by the client. See src/lib/session-completion.ts for the unknown-duration case.
    const completed = computeCompleted({
        type: listeningSession.type,
        durationSeconds,
        meditationDurationSeconds: listeningSession.meditation?.durationSeconds ?? null,
        scheduledSessionStatus: listeningSession.scheduledSession?.status ?? null,
    });

    const updated = await prisma.listeningSession.update({
        where: { id },
        data: {
            endedAt: now,
            durationSeconds,
            completed,
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
