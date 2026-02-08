import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/meditations
 * List all meditations with optional status filter
 * Query: ?status=PENDING|APPROVED|REJECTED
 * Auth: ADMIN only
 */
export async function GET(request: NextRequest) {
    const [, errorResponse] = await requireRole('ADMIN');
    if (errorResponse) return errorResponse;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');

    const validStatuses = ['PENDING', 'APPROVED', 'REJECTED'];
    const whereClause = status && validStatuses.includes(status)
        ? { status: status as 'PENDING' | 'APPROVED' | 'REJECTED' }
        : {};

    const meditations = await prisma.meditation.findMany({
        where: whereClause,
        include: {
            provider: {
                select: { name: true, email: true },
            },
            tags: {
                include: { tag: true },
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
            reviewedAt: m.reviewedAt?.toISOString() ?? null,
            provider: m.provider,
            tags: m.tags.map((t) => ({
                name: t.tag.name,
                slug: t.tag.slug,
                category: t.tag.category,
            })),
        })),
    });
}
