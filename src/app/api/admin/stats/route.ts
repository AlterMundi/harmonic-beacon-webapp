import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET() {
    const [session, errorResponse] = await requireRole('ADMIN');
    if (!session) return errorResponse;

    try {
        const [
            totalUsers,
            totalMeditations,
            pendingMeditations,
            totalSessions,
            totalMinutesBigInt
        ] = await Promise.all([
            prisma.user.count(),
            prisma.meditation.count(),
            prisma.meditation.count({ where: { status: 'PENDING' } }),
            prisma.listeningSession.count(),
            prisma.listeningSession.aggregate({
                _sum: {
                    durationSeconds: true
                }
            })
        ]);

        const totalMinutes = Number(totalMinutesBigInt._sum.durationSeconds || 0) / 60;

        return NextResponse.json({
            stats: {
                totalUsers,
                totalMeditations,
                pendingMeditations,
                totalSessions,
                totalMinutes: Math.round(totalMinutes)
            }
        });
    } catch (error) {
        console.error('Admin stats error:', error);
        return NextResponse.json({ error: 'Failed to load stats' }, { status: 500 });
    }
}
