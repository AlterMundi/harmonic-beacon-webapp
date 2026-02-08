import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { createReadStream, statSync } from 'fs';
import { Readable } from 'stream';

export const dynamic = 'force-dynamic';

/**
 * GET /api/provider/sessions/[id]/recording
 * Stream the session recording file (OGG) to the provider.
 * Supports Range requests for seeking.
 */
export async function GET(
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

    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id },
    });

    if (!scheduledSession) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (scheduledSession.providerId !== user.id) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (!scheduledSession.recordingPath) {
        return NextResponse.json({ error: 'No recording available' }, { status: 404 });
    }

    let stat;
    try {
        stat = statSync(scheduledSession.recordingPath);
    } catch {
        return NextResponse.json({ error: 'Recording file not found' }, { status: 404 });
    }

    const fileSize = stat.size;
    const rangeHeader = request.headers.get('range');

    if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
            const start = parseInt(match[1], 10);
            const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            const stream = createReadStream(scheduledSession.recordingPath, { start, end });
            const webStream = Readable.toWeb(stream) as ReadableStream;

            return new Response(webStream, {
                status: 206,
                headers: {
                    'Content-Type': 'audio/ogg',
                    'Content-Length': String(chunkSize),
                    'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                    'Accept-Ranges': 'bytes',
                    'Cache-Control': 'private, max-age=3600',
                },
            });
        }
    }

    const stream = createReadStream(scheduledSession.recordingPath);
    const webStream = Readable.toWeb(stream) as ReadableStream;

    return new Response(webStream, {
        status: 200,
        headers: {
            'Content-Type': 'audio/ogg',
            'Content-Length': String(fileSize),
            'Accept-Ranges': 'bytes',
            'Cache-Control': 'private, max-age=3600',
        },
    });
}
