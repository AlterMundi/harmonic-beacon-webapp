import { NextRequest, NextResponse } from 'next/server';
import { join, extname } from 'path';
import { prisma } from '@/lib/db';
import { streamFile } from '@/lib/stream-file';

export const dynamic = 'force-dynamic';

const MEDITATIONS_PATH = process.env.MEDITATIONS_STORAGE_PATH || join(process.cwd(), 'public/audio/meditations');

const MIME_TYPES: Record<string, string> = {
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.flac': 'audio/flac',
};

/**
 * GET /api/meditations/[id]/audio
 * Stream a published meditation audio file. No auth required.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;

    const meditation = await prisma.meditation.findUnique({
        where: { id },
        select: { filePath: true, isPublished: true, status: true, isHidden: true },
    });

    // `isHidden` belongs in this check, not just in the catalogue query: a
    // takedown that leaves the file streamable to anyone holding the id — a
    // favourite, a bookmark, a cached page — has not taken anything down.
    // BUSINESS_RULES.md §2.1 makes `isHidden` the one flag a visibility filter
    // consults, and this is a visibility filter.
    if (!meditation || !meditation.isPublished || meditation.status !== 'APPROVED' || meditation.isHidden) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const filePath = join(MEDITATIONS_PATH, meditation.filePath);
    const ext = extname(meditation.filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'audio/ogg';

    const response = streamFile(filePath, request.headers.get('range'), contentType);
    if (!response) {
        return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    return response;
}
