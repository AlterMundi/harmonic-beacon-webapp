import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    const [session, errorResponse] = await requireRole('ADMIN');
    if (!session) return errorResponse;

    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                name: true,
                email: true,
                image: true,
                role: true,
                createdAt: true,
                _count: {
                    select: {
                        meditations: true,
                        listeningSessions: true
                    }
                }
            }
        });

        return NextResponse.json({ users });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch users' }, { status: 500 });
    }
}
