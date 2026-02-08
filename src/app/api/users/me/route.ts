import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/users/me
 * Returns user profile + stats
 */
export async function GET() {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            role: true,
        },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const [totalSessions, totalMinutesResult, favoritesCount] = await Promise.all([
        prisma.listeningSession.count({
            where: { userId: user.id },
        }),
        prisma.listeningSession.aggregate({
            where: { userId: user.id },
            _sum: { durationSeconds: true },
        }),
        prisma.favorite.count({
            where: { userId: user.id },
        }),
    ]);

    const totalMinutes = Math.floor((totalMinutesResult._sum.durationSeconds || 0) / 60);

    return NextResponse.json({
        user: {
            name: user.name,
            email: user.email,
            avatarUrl: user.avatarUrl,
            role: user.role,
        },
        stats: {
            totalSessions,
            totalMinutes,
            favoritesCount,
        },
    });
}
