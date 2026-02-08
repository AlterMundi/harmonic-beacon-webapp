import { NextRequest, NextResponse } from 'next/server';
import { readdir, stat } from 'fs/promises';
import { join, basename } from 'path';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

// Configuration
const GO2RTC_API_URL = process.env.GO2RTC_INTERNAL_URL || process.env.GO2RTC_API_URL || 'http://localhost:1984';
const MEDITATIONS_PATH = process.env.MEDITATIONS_STORAGE_PATH || join(process.cwd(), 'public/audio/meditations');

/**
 * Sanitize path to prevent directory traversal attacks
 */
function sanitizePath(input: string): string {
    return basename(input).replace(/[^a-zA-Z0-9_-]/g, '');
}

// Response types
interface MeditationResponse {
    id: string;
    title: string;
    description: string | null;
    durationSeconds: number;
    streamName: string;
    isFeatured: boolean;
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
            isFeatured: m.isFeatured,
            provider: m.provider,
            tags: m.tags.map((t) => ({
                name: t.tag.name,
                slug: t.tag.slug,
                category: t.tag.category,
            })),
        }));

        return NextResponse.json({ meditations: response });
    } catch (error) {
        console.error('Error listing meditations:', error);

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
                    tags: [],
                };
            });

            return NextResponse.json({ meditations, fallback: true });
        } catch {
            return NextResponse.json({ error: 'Failed to list meditations' }, { status: 500 });
        }
    }
}

/**
 * POST /api/meditations
 * Creates a go2rtc stream for a meditation
 * Body: { meditationId: string } - can be UUID or stream name
 */
export async function POST(request: NextRequest) {
    try {
        const { meditationId } = await request.json();

        if (!meditationId) {
            return NextResponse.json({ error: 'meditationId is required' }, { status: 400 });
        }

        // Find meditation in database
        const meditation = await prisma.meditation.findFirst({
            where: {
                OR: [
                    { id: meditationId },
                    { streamName: `meditation-${meditationId}` },
                    { streamName: meditationId },
                ],
                isPublished: true,
            },
        });

        // Fallback: check file system directly if not in DB
        if (!meditation) {
            const sanitizedId = sanitizePath(meditationId);
            const files = await readdir(MEDITATIONS_PATH);
            const meditationFile = files.find(f => f.startsWith(sanitizedId));

            if (!meditationFile) {
                return NextResponse.json({ error: 'Meditation not found' }, { status: 404 });
            }

            const filePath = join(MEDITATIONS_PATH, meditationFile);
            const streamName = `meditation-${sanitizedId}`;

            // Verify file exists
            const fileStats = await stat(filePath);
            if (!fileStats.isFile()) {
                return NextResponse.json({ error: 'Meditation file not accessible' }, { status: 404 });
            }

            // Create stream in go2rtc
            const audioFilter = meditationFile.endsWith('.ogg') ? '#audio=copy' : '#audio=opus';
            await createGo2rtcStream(streamName, filePath, audioFilter);

            return NextResponse.json({
                success: true,
                streamName,
                meditationId: sanitizedId,
                title: sanitizedId.replace(/_/g, ' '),
            });
        }

        // Use database meditation
        const filePath = join(MEDITATIONS_PATH, meditation.filePath);

        // Verify file exists
        try {
            const fileStats = await stat(filePath);
            if (!fileStats.isFile()) {
                throw new Error('Not a file');
            }
        } catch {
            return NextResponse.json({ error: 'Meditation file not accessible' }, { status: 404 });
        }

        // Create stream in go2rtc
        const audioFilter = meditation.filePath.endsWith('.ogg') ? '#audio=copy' : '#audio=opus';
        await createGo2rtcStream(meditation.streamName, filePath, audioFilter);

        return NextResponse.json({
            success: true,
            streamName: meditation.streamName,
            meditationId: meditation.id,
            title: meditation.title,
        });
    } catch (error) {
        console.error('Error creating meditation stream:', error);
        return NextResponse.json({ error: 'Failed to create meditation stream' }, { status: 500 });
    }
}

/**
 * Helper: Create stream in go2rtc
 */
async function createGo2rtcStream(streamName: string, filePath: string, audioFilter: string) {
    const source = `ffmpeg:${filePath}${audioFilter}`;
    const params = new URLSearchParams({ name: streamName, src: source });
    const response = await fetch(`${GO2RTC_API_URL}/api/streams?${params}`, {
        method: 'PUT',
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('go2rtc error:', errorText);
        throw new Error(`go2rtc API error: ${response.status}`);
    }
}
