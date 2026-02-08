import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { generateRoomName } from '@/lib/invite-codes';

export const dynamic = 'force-dynamic';

/**
 * POST /api/provider/sessions
 * Create a new scheduled session.
 */
export async function POST(request: NextRequest) {
    const [session, errorResponse] = await requireRole('PROVIDER', 'ADMIN');
    if (!session) return errorResponse;

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { title, description, scheduledAt } = body;

    if (!title || typeof title !== 'string' || !title.trim()) {
        return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const scheduledSession = await prisma.scheduledSession.create({
        data: {
            title: title.trim(),
            description: description?.trim() || null,
            roomName: generateRoomName(),
            providerId: user.id,
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
        },
    });

    return NextResponse.json({ session: scheduledSession }, { status: 201 });
}

/**
 * GET /api/provider/sessions
 * List current provider's sessions with participant counts.
 */
export async function GET() {
    const [session, errorResponse] = await requireRole('PROVIDER', 'ADMIN');
    if (!session) return errorResponse;

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const sessions = await prisma.scheduledSession.findMany({
        where: { providerId: user.id },
        include: {
            _count: {
                select: { participants: true, invites: true },
            },
        },
        orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
        sessions: sessions.map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description,
            roomName: s.roomName,
            status: s.status,
            scheduledAt: s.scheduledAt?.toISOString() ?? null,
            startedAt: s.startedAt?.toISOString() ?? null,
            endedAt: s.endedAt?.toISOString() ?? null,
            durationSeconds: s.durationSeconds,
            createdAt: s.createdAt.toISOString(),
            participantCount: s._count.participants,
            inviteCount: s._count.invites,
        })),
    });
}
