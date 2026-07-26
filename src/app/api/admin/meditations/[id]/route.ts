import { NextRequest, NextResponse } from 'next/server';
import { rename, copyFile, unlink, mkdir } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logAdminAction } from '@/lib/audit';
import { redactErrorDetail } from '@/lib/redact';
import { findMissingPublicationTags } from '@/lib/publication-tags';

export const dynamic = 'force-dynamic';

const UPLOADS_PATH = process.env.UPLOADS_PATH || join(process.cwd(), 'uploads');
const MEDITATIONS_PATH = process.env.MEDITATIONS_STORAGE_PATH || join(process.cwd(), 'public/audio/meditations');

/**
 * PATCH /api/admin/meditations/[id]
 * Update meditation status, featured flag, or hidden flag
 * Body: { status?: "APPROVED" | "REJECTED", rejectionReason?: string, isFeatured?: boolean, isHidden?: boolean }
 * Auth: ADMIN only
 */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const [session, errorResponse] = await requireRole('ADMIN');
    if (!session) return errorResponse;

    const { id } = await params;
    const body = await request.json();

    const { status, rejectionReason, isFeatured, isHidden } = body;

    const meditation = await prisma.meditation.findUnique({ where: { id } });
    if (!meditation) {
        return NextResponse.json({ error: 'Meditation not found' }, { status: 404 });
    }

    // If only toggling visibility flags (no status change required)
    if (isHidden !== undefined && status === undefined) {
        const updated = await prisma.meditation.update({
            where: { id },
            data: {
                isHidden,
                ...(isFeatured !== undefined ? { isFeatured } : {}),
            },
        });

        // One entry per semantic change rather than one per request, so the log
        // stays filterable by action: an incident review asking "who hid this"
        // should not have to unpack a combined visibility payload.
        await logAdminAction(session, {
            action: isHidden ? 'meditation.hide' : 'meditation.unhide',
            targetType: 'MEDITATION',
            targetId: id,
            metadata: { previousIsHidden: meditation.isHidden },
        });
        if (isFeatured !== undefined) {
            await logAdminAction(session, {
                action: isFeatured ? 'meditation.feature' : 'meditation.unfeature',
                targetType: 'MEDITATION',
                targetId: id,
                metadata: { previousIsFeatured: meditation.isFeatured },
            });
        }

        return NextResponse.json({
            meditation: {
                id: updated.id,
                isHidden: updated.isHidden,
                isFeatured: updated.isFeatured,
            },
        });
    }

    // Status-based moderation update
    if (!status || !['APPROVED', 'REJECTED'].includes(status)) {
        return NextResponse.json({ error: 'status must be APPROVED or REJECTED' }, { status: 400 });
    }

    // BUSINESS_RULES.md §2.1: publication requires a LANGUAGE tag plus at least one
    // of MOOD, TECHNIQUE or DURATION. Scoped to the write that actually publishes,
    // because the Featured toggle in the moderation UI also PATCHes
    // status: 'APPROVED' — an already-published meditation should not have that
    // action fail on a rule about publication. Checked before the file moves, so a
    // refused approval leaves nothing half-done.
    const publishes = status === 'APPROVED' && !(meditation.isPublished && meditation.status === 'APPROVED');

    // A meditation that is down cannot be published without first being brought
    // back up. This is what stops a Provider's withdrawal (CONTENT_POLICY.md
    // §6.1) from being undone by a reviewer working the PENDING queue: the row
    // is still in that queue, flagged Hidden, but approving it is refused.
    // Scoped to the write that publishes, so unhiding and the Featured toggle —
    // both of which PATCH an already-approved row — are unaffected.
    if (publishes && meditation.isHidden) {
        return NextResponse.json(
            { error: 'This meditation has been taken down. Unhide it before approving.' },
            { status: 409 },
        );
    }

    if (publishes) {
        const meditationTags = await prisma.meditationTag.findMany({
            where: { meditationId: id },
            select: { tag: { select: { category: true } } },
        });
        const tagError = findMissingPublicationTags(meditationTags.map((mt) => mt.tag.category));
        if (tagError) {
            return NextResponse.json({ error: tagError }, { status: 400 });
        }
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
            console.error('Failed to move file to meditations:', redactErrorDetail(err));
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

    await logAdminAction(session, {
        action: status === 'APPROVED' ? 'meditation.approve' : 'meditation.reject',
        targetType: 'MEDITATION',
        targetId: id,
        metadata: {
            previousStatus: meditation.status,
            published: updated.isPublished,
            ...(status === 'REJECTED' ? { rejectionReason: rejectionReason || null } : {}),
        },
    });
    if (isFeatured !== undefined) {
        await logAdminAction(session, {
            action: isFeatured ? 'meditation.feature' : 'meditation.unfeature',
            targetType: 'MEDITATION',
            targetId: id,
            metadata: { previousIsFeatured: meditation.isFeatured },
        });
    }

    return NextResponse.json({
        meditation: {
            id: updated.id,
            status: updated.status,
            reviewedAt: updated.reviewedAt?.toISOString() ?? null,
            isPublished: updated.isPublished,
            isFeatured: updated.isFeatured,
            isHidden: updated.isHidden,
        },
    });
}
