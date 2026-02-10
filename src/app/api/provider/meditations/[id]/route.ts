import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

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

        // Verify ownership
        const dbUser = await prisma.user.findUnique({ where: { zitadelId: session.user.id } });
        if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });

        const meditation = await prisma.meditation.findUnique({ where: { id } });
        if (!meditation) return NextResponse.json({ error: 'Meditation not found' }, { status: 404 });

        if (session.user.role !== 'ADMIN' && meditation.providerId !== dbUser.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
        }

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
        console.error('Update error:', error);
        return NextResponse.json({ error: 'Failed to update meditation' }, { status: 500 });
    }
}
