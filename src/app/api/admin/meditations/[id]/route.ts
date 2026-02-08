import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/admin/meditations/[id]
 * Approve or reject a meditation
 * Body: { status: "APPROVED" | "REJECTED", rejectionReason?: string, isFeatured?: boolean }
 * Auth: ADMIN only
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const [, errorResponse] = await requireRole('ADMIN');
    if (errorResponse) return errorResponse;

    const { id } = await params;
    const body = await request.json();

    const { status, rejectionReason, isFeatured } = body;

    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
        return NextResponse.json({ error: 'status must be APPROVED or REJECTED' }, { status: 400 });
    }

    const meditation = await prisma.meditation.findUnique({ where: { id } });
    if (!meditation) {
        return NextResponse.json({ error: 'Meditation not found' }, { status: 404 });
    }

    const updated = await prisma.meditation.update({
        where: { id },
        data: {
            status,
            reviewedAt: new Date(),
            rejectionReason: status === 'REJECTED' ? (rejectionReason || null) : null,
            isPublished: status === 'APPROVED',
            ...(isFeatured !== undefined ? { isFeatured } : {}),
        },
    });

    return NextResponse.json({
        meditation: {
            id: updated.id,
            status: updated.status,
            reviewedAt: updated.reviewedAt?.toISOString() ?? null,
            isPublished: updated.isPublished,
            isFeatured: updated.isFeatured,
        },
    });
}
