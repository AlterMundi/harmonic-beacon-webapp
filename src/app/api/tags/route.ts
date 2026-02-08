import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

interface TagItem {
    id: string;
    name: string;
    slug: string;
}

interface TagResponse {
    id: string;
    name: string;
    slug: string;
    category: string;
}

/**
 * GET /api/tags
 * Returns all available tags grouped by category
 */
export async function GET() {
    try {
        const tags = await prisma.tag.findMany({
            orderBy: [
                { category: 'asc' },
                { sortOrder: 'asc' },
                { name: 'asc' },
            ],
        });

        // Group by category
        const grouped: Record<string, TagItem[]> = {};
        for (const tag of tags) {
            const category = tag.category;
            if (!grouped[category]) {
                grouped[category] = [];
            }
            grouped[category].push({
                id: tag.id,
                name: tag.name,
                slug: tag.slug,
            });
        }

        const all: TagResponse[] = tags.map((t) => ({
            id: t.id,
            name: t.name,
            slug: t.slug,
            category: t.category,
        }));

        return NextResponse.json({ tags: grouped, all });
    } catch (error) {
        console.error('Error listing tags:', error);
        return NextResponse.json({ error: 'Failed to list tags' }, { status: 500 });
    }
}
