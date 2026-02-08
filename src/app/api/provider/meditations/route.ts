import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/provider/meditations
 * List current user's meditations (all statuses)
 * Auth: PROVIDER or ADMIN
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

    const meditations = await prisma.meditation.findMany({
        where: { providerId: user.id },
        include: {
            tags: {
                include: { tag: true },
            },
            _count: {
                select: { sessions: true },
            },
        },
        orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
        meditations: meditations.map((m) => ({
            id: m.id,
            title: m.title,
            description: m.description,
            durationSeconds: m.durationSeconds,
            streamName: m.streamName,
            status: m.status,
            isPublished: m.isPublished,
            isFeatured: m.isFeatured,
            rejectionReason: m.rejectionReason,
            createdAt: m.createdAt.toISOString(),
            playCount: m._count.sessions,
            tags: m.tags.map((t) => ({
                name: t.tag.name,
                slug: t.tag.slug,
                category: t.tag.category,
            })),
        })),
    });
}
