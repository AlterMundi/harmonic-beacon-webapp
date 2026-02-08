import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { generateInviteCode } from '@/lib/invite-codes';

export const dynamic = 'force-dynamic';

/**
 * POST /api/provider/sessions/[id]/invites
 * Create a new invite for a session.
 */
export async function POST(
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

    if (scheduledSession.status === 'ENDED' || scheduledSession.status === 'CANCELLED') {
        return NextResponse.json(
            { error: 'Cannot create invites for ended or cancelled sessions' },
            { status: 400 },
        );
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { maxUses, expiresInHours } = body;

    const expiresAt = expiresInHours
        ? new Date(Date.now() + expiresInHours * 60 * 60 * 1000)
        : null;

    const invite = await prisma.sessionInvite.create({
        data: {
            code: generateInviteCode(),
            sessionId: id,
            maxUses: maxUses || 0,
            expiresAt,
        },
    });

    return NextResponse.json({ invite }, { status: 201 });
}

/**
 * GET /api/provider/sessions/[id]/invites
 * List invites for a session with usage info.
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
        select: { providerId: true },
    });

    if (!scheduledSession) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (scheduledSession.providerId !== user.id) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    const invites = await prisma.sessionInvite.findMany({
        where: { sessionId: id },
        orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ invites });
}
