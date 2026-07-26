import { NextResponse } from 'next/server';
import type { Meditation } from '@prisma/client';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logAdminAction } from '@/lib/audit';
import { redactErrorDetail } from '@/lib/redact';

export const dynamic = 'force-dynamic';

/**
 * Resolve the meditation this request is allowed to act on, or the response
 * explaining why it is not. Same tuple shape as `requireAuth`/`requireRole`.
 *
 * An Admin passes for any meditation — the moderation route is theirs and this
 * route has always let them through. A Provider passes only for their own:
 * `session.user.id` is the Zitadel subject, so the owner comparison needs the DB
 * user row, not the session id.
 */
async function resolveOwnedMeditation(
    session: { user: { id: string; role: string } },
    id: string,
): Promise<[Meditation, null] | [null, NextResponse]> {
    const dbUser = await prisma.user.findUnique({ where: { zitadelId: session.user.id } });
    if (!dbUser) return [null, NextResponse.json({ error: 'User not found' }, { status: 404 })];

    const meditation = await prisma.meditation.findUnique({ where: { id } });
    if (!meditation) return [null, NextResponse.json({ error: 'Meditation not found' }, { status: 404 })];

    if (session.user.role !== 'ADMIN' && meditation.providerId !== dbUser.id) {
        return [null, NextResponse.json({ error: 'Unauthorized' }, { status: 403 })];
    }

    return [meditation, null];
}

/**
 * GET /api/provider/meditations/[id]
 * Get single meditation details for editing
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const [session, errorResponse] = await requireRole('PROVIDER', 'ADMIN');
    if (!session) return errorResponse;

    const meditation = await prisma.meditation.findUnique({
        where: { id },
        include: {
            tags: {
                include: { tag: true }
            }
        }
    });

    if (!meditation) {
        return NextResponse.json({ error: 'Meditation not found' }, { status: 404 });
    }

    // Ensure ownership if not admin
    if (session.user.role !== 'ADMIN' && meditation.providerId !== session.user.id) { // NOTE: providerId check needs user ID to be UUID from DB, not Zitadel ID
        // To fix this properly we need to fetch the DB user first like in the list endpoint
        // But for now let's assume session.user.id matches for simplicity or fetch user
        const dbUser = await prisma.user.findUnique({ where: { zitadelId: session.user.id } });
        if (!dbUser || meditation.providerId !== dbUser.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }
    }

    return NextResponse.json({
        meditation: {
            ...meditation,
            tags: meditation.tags.map(mt => ({
                id: mt.tag.id,
                name: mt.tag.name,
                slug: mt.tag.slug,
                category: mt.tag.category
            }))
        }
    });
}

/**
 * PATCH /api/provider/meditations/[id]
 * Update meditation details
 */
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const [session, errorResponse] = await requireRole('PROVIDER', 'ADMIN');
    if (!session) return errorResponse;

    try {
        const body = await request.json();
        const { title, description, tagIds, defaultMix } = body;

        const [, ownershipError] = await resolveOwnedMeditation(session, id);
        if (ownershipError) return ownershipError;

        // Update basic fields
        await prisma.meditation.update({
            where: { id },
            data: {
                title,
                description,
                ...(typeof defaultMix === 'number' && defaultMix >= 0 && defaultMix <= 1
                    ? { defaultMix }
                    : {}),
            }
        });

        // Update tags if provided
        if (tagIds && Array.isArray(tagIds)) {
            // Delete existing tags
            await prisma.meditationTag.deleteMany({
                where: { meditationId: id }
            });

            // Add new tags
            if (tagIds.length > 0) {
                await prisma.meditationTag.createMany({
                    data: tagIds.map((tagId: string) => ({
                        meditationId: id,
                        tagId
                    }))
                });
            }
        }

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Update error:', redactErrorDetail(error));
        return NextResponse.json({ error: 'Failed to update meditation' }, { status: 500 });
    }
}

/**
 * DELETE /api/provider/meditations/[id]
 * Provider-initiated takedown. CONTENT_POLICY.md §6.1: "a Provider may take down
 * their own content at any time."
 * Auth: PROVIDER or ADMIN, owner-checked.
 *
 * DELETE rather than a PATCH field, for two reasons. PATCH here is the editor
 * payload — title, description, tags, mix — and a takedown arriving inside an
 * edit would be indistinguishable from one in the request body and ambiguous in
 * the audit entry. And a boolean `isHidden` on PATCH would imply the provider
 * can also write `false`, which they must not: the same flag carries Admin
 * moderation hides (CONTENT_POLICY.md §6.2), and a Provider able to clear it
 * could undo a policy takedown. Taking your own content down is yours; putting
 * it back is an Admin's. So this verb is one-way.
 *
 * It is a takedown, not a deletion. BUSINESS_RULES.md §9.2 keeps a tombstone for
 * Listener-history integrity, and the row is that tombstone: a past
 * `ListeningSession` references `meditationId`, and dropping the row would blank
 * other people's history. The response says plainly what survives.
 */
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const [session, errorResponse] = await requireRole('PROVIDER', 'ADMIN');
    if (!session) return errorResponse;

    try {
        const [meditation, ownershipError] = await resolveOwnedMeditation(session, id);
        if (!meditation) return ownershipError;

        // Withdrawing a submission before review is a different act from taking
        // published content down, and it is worth naming as such — but it is the
        // same write. The Hidden invariant (BUSINESS_RULES.md §2.1) is that
        // hiding sets `isHidden` and nothing else, so that an unhide returns the
        // row to exactly where it stood. That reasoning holds for a PENDING row
        // too: leaving `status` and `isPublished` alone keeps "withdrawn before
        // review" distinguishable from "published, then taken down".
        const withdrawnFromReview = !meditation.isPublished;

        const updated = await prisma.meditation.update({
            where: { id },
            // `takenDownAt` is what makes this distinguishable from an Admin's
            // moderation hide. Both set `isHidden`, but they are different acts —
            // the author withdrawing their own work, versus the platform acting on
            // it — and without the distinction an Admin clicking unhide would
            // republish something its author had withdrawn, with nothing on screen
            // to say so.
            data: { isHidden: true, takenDownAt: new Date() },
        });

        // TODO(storage): when an object-storage driver exists, this is where the
        // audio delete hooks in — `uploads/{id}/*` and `meditations/{id}/*` per
        // the key layout quoted in `src/app/api/users/me/route.ts`. It must run
        // after the DB write commits, never before, or a failed update leaves a
        // row pointing at a key that is gone; and presigned GETs already issued
        // stay valid until their TTL expires, so the purge is not effective the
        // instant it runs.

        await logAdminAction(session, {
            action: 'meditation.takedown',
            targetType: 'MEDITATION',
            targetId: id,
            metadata: {
                previousIsHidden: meditation.isHidden,
                previousStatus: meditation.status,
                previousIsPublished: meditation.isPublished,
                withdrawnFromReview,
            },
        });

        const retained = [
            'The meditation record is kept, not deleted. Listeners who played it have history rows that reference it, and removing the row would blank their records (BUSINESS_RULES.md §9.2).',
            'The audio file is not purged. No object-storage driver exists yet, so the file still sits on the host filesystem. It is no longer served to anyone, but the bytes have not been erased — ask an administrator if the file itself must go.',
        ];

        if (withdrawnFromReview) {
            retained.push('This meditation was not published, so the takedown is a withdrawal from review: it stays out of the catalogue and cannot be approved while it is down.');
        } else {
            retained.push('Listeners who favourited it keep the entry in their favourites list. It no longer plays.');
        }

        return NextResponse.json({
            takenDown: true,
            withdrawnFromReview,
            meditation: {
                id: updated.id,
                status: updated.status,
                isPublished: updated.isPublished,
                isHidden: updated.isHidden,
            },
            retained,
        });
    } catch (error) {
        console.error('Takedown error:', redactErrorDetail(error));
        return NextResponse.json({ error: 'Failed to take down meditation' }, { status: 500 });
    }
}
