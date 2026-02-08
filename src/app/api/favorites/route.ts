import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/favorites
 * Returns user's favorited meditations
 */
export async function GET() {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const favorites = await prisma.favorite.findMany({
        where: { userId: user.id },
        include: {
            meditation: {
                select: {
                    id: true,
                    title: true,
                    streamName: true,
                    durationSeconds: true,
                    tags: {
                        include: { tag: true },
                    },
                },
            },
        },
        orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({
        favorites: favorites.map((f) => ({
            meditationId: f.meditationId,
            meditation: {
                id: f.meditation.id,
                title: f.meditation.title,
                streamName: f.meditation.streamName,
                durationSeconds: f.meditation.durationSeconds,
                tags: f.meditation.tags.map((t) => ({
                    name: t.tag.name,
                    slug: t.tag.slug,
                    category: t.tag.category,
                })),
            },
        })),
    });
}

/**
 * POST /api/favorites
 * Toggle favorite by meditationId
 * Body: { meditationId: string }
 */
export async function POST(request: NextRequest) {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    const { meditationId } = await request.json();
    if (!meditationId) {
        return NextResponse.json({ error: 'meditationId is required' }, { status: 400 });
    }

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Check if already favorited
    const existing = await prisma.favorite.findUnique({
        where: {
            userId_meditationId: {
                userId: user.id,
                meditationId,
            },
        },
    });

    if (existing) {
        // Unfavorite
        await prisma.favorite.delete({
            where: {
                userId_meditationId: {
                    userId: user.id,
                    meditationId,
                },
            },
        });
        return NextResponse.json({ favorited: false });
    } else {
        // Favorite
        await prisma.favorite.create({
            data: {
                userId: user.id,
                meditationId,
            },
        });
        return NextResponse.json({ favorited: true });
    }
}
