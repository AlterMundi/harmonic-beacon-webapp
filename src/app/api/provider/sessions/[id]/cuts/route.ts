import { NextRequest, NextResponse } from 'next/server';
import { join } from 'path';
import { unlink, mkdir } from 'fs/promises';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { renderMixdown } from '@/lib/ffmpeg-mix';
import type { MixTrack } from '@/lib/ffmpeg-mix';

export const dynamic = 'force-dynamic';

const UPLOADS_PATH = process.env.UPLOADS_PATH || join(process.cwd(), 'uploads');

/**
 * POST /api/provider/sessions/[id]/cuts
 * Render a mixdown cut from session recordings and create a PENDING meditation.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [session, errorResponse] = await requireRole('PROVIDER', 'ADMIN');
    if (!session) return errorResponse;

    const { id } = await params;

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Fetch session with ownership check
    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id },
        select: { id: true, providerId: true, status: true },
    });

    if (!scheduledSession) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (scheduledSession.providerId !== user.id) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (scheduledSession.status !== 'ENDED') {
        return NextResponse.json({ error: 'Session must be ENDED to create cuts' }, { status: 400 });
    }

    // Fetch completed recordings
    const recordings = await prisma.sessionRecording.findMany({
        where: { sessionId: id, active: false, filePath: { not: null } },
        select: { filePath: true, category: true },
    });

    if (recordings.length === 0) {
        return NextResponse.json({ error: 'No completed recordings found' }, { status: 400 });
    }

    // Parse and validate body
    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { inSeconds, outSeconds, mix, title, description, tagIds } = body;

    if (!title || typeof title !== 'string' || !title.trim()) {
        return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    if (typeof inSeconds !== 'number' || typeof outSeconds !== 'number' || inSeconds >= outSeconds) {
        return NextResponse.json({ error: 'Invalid in/out range' }, { status: 400 });
    }

    if (typeof mix !== 'number' || mix < 0 || mix > 1) {
        return NextResponse.json({ error: 'Mix must be between 0 and 1' }, { status: 400 });
    }

    // Generate filename + streamName (same pattern as meditations/upload)
    const safeTitle = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const timestamp = Date.now();
    const fileName = `${safeTitle}_${timestamp}.ogg`;
    const streamName = `meditation-${safeTitle}_${timestamp}`;

    // Build tracks list
    const tracks: MixTrack[] = recordings.map((r) => ({
        filePath: r.filePath!,
        category: r.category as 'SESSION' | 'BEACON',
    }));

    const outputPath = join(UPLOADS_PATH, fileName);

    try {
        await mkdir(UPLOADS_PATH, { recursive: true });

        await renderMixdown({
            tracks,
            inSeconds,
            outSeconds,
            mix,
            outputPath,
        });

        // Create meditation record
        const parsedTagIds: string[] = Array.isArray(tagIds) ? tagIds : [];

        const meditation = await prisma.meditation.create({
            data: {
                title: title.trim(),
                description: description?.trim() || null,
                durationSeconds: Math.floor(outSeconds - inSeconds),
                filePath: fileName,
                originalPath: `session:${id}`,
                streamName,
                defaultMix: mix,
                providerId: user.id,
                status: 'PENDING',
                isPublished: false,
                tags: parsedTagIds.length > 0 ? {
                    create: parsedTagIds.map((tagId: string) => ({ tagId })),
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
    } catch (err) {
        // Clean up partial file on failure
        try {
            await unlink(outputPath);
        } catch {
            // File may not exist
        }

        console.error('Cut creation failed:', err);
        return NextResponse.json(
            { error: 'Failed to render mixdown' },
            { status: 500 },
        );
    }
}
