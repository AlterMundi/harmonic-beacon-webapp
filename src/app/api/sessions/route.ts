import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions
 * Returns user's session history
 * Query: ?limit=20&offset=0
 */
export async function GET(request: NextRequest) {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100);
    const offset = parseInt(searchParams.get('offset') || '0');

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const [sessions, total] = await Promise.all([
        prisma.listeningSession.findMany({
            where: { userId: user.id },
            include: {
                meditation: {
                    select: { title: true },
                },
            },
            orderBy: { startedAt: 'desc' },
            take: limit,
            skip: offset,
        }),
        prisma.listeningSession.count({
            where: { userId: user.id },
        }),
    ]);

    return NextResponse.json({
        sessions: sessions.map((s) => ({
            id: s.id,
            type: s.type,
            durationSeconds: s.durationSeconds,
            completed: s.completed,
            startedAt: s.startedAt.toISOString(),
            endedAt: s.endedAt?.toISOString() ?? null,
            meditation: s.meditation ? { title: s.meditation.title } : null,
        })),
        total,
    });
}

/**
 * POST /api/sessions
 * Start a new session
 * Body: { type: "LIVE" | "MEDITATION", meditationId?: string }
 */
export async function POST(request: NextRequest) {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    const { type, meditationId } = await request.json();

    if (!type || !['LIVE', 'MEDITATION'].includes(type)) {
        return NextResponse.json({ error: 'type must be LIVE or MEDITATION' }, { status: 400 });
    }

    if (type === 'MEDITATION' && !meditationId) {
        return NextResponse.json({ error: 'meditationId required for MEDITATION sessions' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const listeningSession = await prisma.listeningSession.create({
        data: {
            userId: user.id,
            type,
            meditationId: meditationId || null,
            durationSeconds: 0,
        },
    });

    return NextResponse.json({
        sessionId: listeningSession.id,
        startedAt: listeningSession.startedAt.toISOString(),
    });
}
