import { NextRequest, NextResponse } from 'next/server';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/db';
import { redactErrorDetail } from '@/lib/redact';

export const dynamic = 'force-dynamic';

// Configuration
const MEDITATIONS_PATH = process.env.MEDITATIONS_STORAGE_PATH || join(process.cwd(), 'public/audio/meditations');

// Response types
interface MeditationResponse {
    id: string;
    title: string;
    description: string | null;
    durationSeconds: number;
    streamName: string;
    fileName: string;
    isFeatured: boolean;
    defaultMix: number;
    provider: { name: string | null; avatarUrl: string | null } | null;
    tags: { name: string; slug: string; category: string }[];
}

/**
 * GET /api/meditations
 * Returns list of published meditations from database
 * Optional query params: ?tag=slug
 */
export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tagSlug = searchParams.get('tag');

        const meditations = await prisma.meditation.findMany({
            where: {
                isPublished: true,
                status: 'APPROVED',
                isHidden: false,
                ...(tagSlug ? {
                    tags: {
                        some: {
                            tag: { slug: tagSlug },
                        },
                    },
                } : {}),
            },
            include: {
                provider: {
                    select: { name: true, avatarUrl: true },
                },
                tags: {
                    include: { tag: true },
                },
            },
            orderBy: [
                { isFeatured: 'desc' },
                { createdAt: 'desc' },
            ],
        });

        // Transform for API response
        const response: MeditationResponse[] = meditations.map((m) => ({
            id: m.id,
            title: m.title,
            description: m.description,
            durationSeconds: m.durationSeconds,
            streamName: m.streamName,
            fileName: m.filePath,
            isFeatured: m.isFeatured,
            defaultMix: m.defaultMix,
            provider: m.provider,
            tags: m.tags.map((t) => ({
                name: t.tag.name,
                slug: t.tag.slug,
                category: t.tag.category,
            })),
        }));

        return NextResponse.json({ meditations: response });
    } catch (error) {
        console.error('Error listing meditations:', redactErrorDetail(error));

        // Fallback to file system if database is unavailable
        try {
            const files = await readdir(MEDITATIONS_PATH);
            const audioFiles = files.filter(f => f.endsWith('.m4a') || f.endsWith('.mp3') || f.endsWith('.ogg'));

            const meditations = audioFiles.map(fileName => {
                const id = fileName.replace(/\.(m4a|mp3|ogg)$/, '');
                return {
                    id,
                    title: id.replace(/_/g, ' '),
                    streamName: `meditation-${id}`,
                    fileName: fileName,
                    tags: [],
                };
            });

            return NextResponse.json({ meditations, fallback: true });
        } catch {
            return NextResponse.json({ error: 'Failed to list meditations' }, { status: 500 });
        }
    }
}
