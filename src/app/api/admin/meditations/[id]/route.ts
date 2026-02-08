import { NextRequest, NextResponse } from 'next/server';
import { rename, copyFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const UPLOADS_PATH = process.env.UPLOADS_PATH || join(process.cwd(), 'uploads');
const MEDITATIONS_PATH = process.env.MEDITATIONS_STORAGE_PATH || join(process.cwd(), 'public/audio/meditations');

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

    // On approve, move file from uploads to meditations directory
    if (status === 'APPROVED') {
        const src = join(UPLOADS_PATH, meditation.filePath);
        const dest = join(MEDITATIONS_PATH, meditation.filePath);
        try {
            await mkdir(MEDITATIONS_PATH, { recursive: true });
            try {
                await rename(src, dest);
            } catch {
                // rename fails across filesystems — fall back to copy+delete
                await copyFile(src, dest);
                await unlink(src);
            }
        } catch (err) {
            console.error('Failed to move file to meditations:', err);
            return NextResponse.json({ error: 'Failed to publish meditation file' }, { status: 500 });
        }
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
