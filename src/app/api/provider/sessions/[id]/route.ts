import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/provider/sessions/[id]
 * Get session detail with invites and participants.
 */
export async function GET(
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
        include: {
            invites: {
                orderBy: { createdAt: 'desc' },
            },
            participants: {
                include: {
                    user: { select: { id: true, name: true, email: true } },
                },
                orderBy: { joinedAt: 'desc' },
            },
            _count: {
                select: { participants: true },
            },
        },
    });

    if (!scheduledSession) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (scheduledSession.providerId !== user.id) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    return NextResponse.json({ session: scheduledSession });
}

/**
 * PATCH /api/provider/sessions/[id]
 * Update session status: start, end, or cancel.
 */
export async function PATCH(
    request: NextRequest,
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

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { action } = body;

    if (action === 'start') {
        if (scheduledSession.status !== 'SCHEDULED') {
            return NextResponse.json(
                { error: 'Can only start a SCHEDULED session' },
                { status: 400 },
            );
        }
        const updated = await prisma.scheduledSession.update({
            where: { id },
            data: { status: 'LIVE', startedAt: new Date() },
        });
        return NextResponse.json({ session: updated });
    }

    if (action === 'end') {
        if (scheduledSession.status !== 'LIVE') {
            return NextResponse.json(
                { error: 'Can only end a LIVE session' },
                { status: 400 },
            );
        }
        const now = new Date();
        const durationSeconds = scheduledSession.startedAt
            ? Math.floor((now.getTime() - scheduledSession.startedAt.getTime()) / 1000)
            : 0;

        const updated = await prisma.scheduledSession.update({
            where: { id },
            data: { status: 'ENDED', endedAt: now, durationSeconds },
        });
        return NextResponse.json({ session: updated });
    }

    if (action === 'cancel') {
        if (scheduledSession.status === 'ENDED' || scheduledSession.status === 'CANCELLED') {
            return NextResponse.json(
                { error: 'Session is already ended or cancelled' },
                { status: 400 },
            );
        }
        const updated = await prisma.scheduledSession.update({
            where: { id },
            data: { status: 'CANCELLED', endedAt: new Date() },
        });
        return NextResponse.json({ session: updated });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
