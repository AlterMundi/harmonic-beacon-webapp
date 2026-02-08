import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const UPLOADS_PATH = process.env.MEDITATIONS_STORAGE_PATH || join(process.cwd(), 'public/audio/meditations');

/**
 * POST /api/meditations/upload
 * Provider upload — multipart form with audio file
 * Body: FormData { file: audio, title: string, description?: string, tagIds: string (JSON array) }
 */
export async function POST(request: NextRequest) {
    const [session, errorResponse] = await requireRole('PROVIDER', 'ADMIN');
    if (!session) return errorResponse;

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const title = formData.get('title') as string | null;
    const description = formData.get('description') as string | null;
    const tagIdsRaw = formData.get('tagIds') as string | null;

    if (!file) {
        return NextResponse.json({ error: 'Audio file is required' }, { status: 400 });
    }
    if (!title?.trim()) {
        return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    // Validate file type
    const allowedTypes = ['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/m4a', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/webm'];
    if (!allowedTypes.includes(file.type) && !file.name.match(/\.(mp3|ogg|m4a|wav|webm)$/i)) {
        return NextResponse.json({ error: 'Invalid audio file type' }, { status: 400 });
    }

    // Parse tag IDs
    let tagIds: string[] = [];
    if (tagIdsRaw) {
        try {
            tagIds = JSON.parse(tagIdsRaw);
        } catch {
            return NextResponse.json({ error: 'Invalid tagIds format' }, { status: 400 });
        }
    }

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Generate safe filename
    const ext = extname(file.name) || '.ogg';
    const safeTitle = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const timestamp = Date.now();
    const fileName = `${safeTitle}_${timestamp}${ext}`;
    const streamName = `meditation-${safeTitle}_${timestamp}`;

    // Ensure upload directory exists
    await mkdir(UPLOADS_PATH, { recursive: true });

    // Write file
    const bytes = await file.arrayBuffer();
    const filePath = join(UPLOADS_PATH, fileName);
    await writeFile(filePath, Buffer.from(bytes));

    // Estimate duration (0 for now — could use ffprobe in future)
    const durationSeconds = 0;

    // Create meditation record
    const meditation = await prisma.meditation.create({
        data: {
            title: title.trim(),
            description: description?.trim() || null,
            durationSeconds,
            filePath: fileName,
            originalPath: file.name,
            streamName,
            providerId: user.id,
            status: 'PENDING',
            isPublished: false,
            tags: tagIds.length > 0 ? {
                create: tagIds.map((tagId) => ({
                    tagId,
                })),
            } : undefined,
        },
    });

    return NextResponse.json({
        meditation: {
            id: meditation.id,
            title: meditation.title,
            status: meditation.status,
        },
    });
}
