import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/scheduled-sessions
 * Browse LIVE and SCHEDULED sessions (for listeners).
 */
export async function GET(request: NextRequest) {
    const [, errorResponse] = await requireAuth();
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status');
    const statuses = statusParam
        ? statusParam.split(',').filter((s) => ['SCHEDULED', 'LIVE', 'ENDED'].includes(s))
        : ['SCHEDULED', 'LIVE'];

    const sessions = await prisma.scheduledSession.findMany({
        where: {
            status: { in: statuses as ('SCHEDULED' | 'LIVE' | 'ENDED')[] },
        },
        include: {
            provider: { select: { id: true, name: true } },
            _count: { select: { participants: true } },
        },
        orderBy: [
            { createdAt: 'desc' },
        ],
    });

    return NextResponse.json({
        sessions: sessions.map((s) => ({
            id: s.id,
            title: s.title,
            description: s.description,
            status: s.status,
            scheduledAt: s.scheduledAt?.toISOString() ?? null,
            startedAt: s.startedAt?.toISOString() ?? null,
            provider: s.provider,
            participantCount: s._count.participants,
        })),
    });
}
