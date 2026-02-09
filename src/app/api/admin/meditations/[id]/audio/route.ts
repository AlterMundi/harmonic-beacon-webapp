import { NextRequest } from 'next/server';
import { readFile, access } from 'fs/promises';
import { join } from 'path';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

const UPLOADS_PATH = process.env.UPLOADS_PATH || join(process.cwd(), 'uploads');
const MEDITATIONS_PATH = process.env.MEDITATIONS_STORAGE_PATH || join(process.cwd(), 'public/audio/meditations');

/**
 * GET /api/admin/meditations/[id]/audio
 * Stream meditation audio file for admin preview.
 * Resolves file from MEDITATIONS_PATH (approved) or UPLOADS_PATH (pending/rejected).
 * Auth: ADMIN only
 */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const [, errorResponse] = await requireRole('ADMIN');
    if (errorResponse) return errorResponse;

    const { id } = await params;

    const meditation = await prisma.meditation.findUnique({ where: { id } });
    if (!meditation) {
        return new Response('Not found', { status: 404 });
    }

    const filePath = meditation.status === 'APPROVED'
        ? join(MEDITATIONS_PATH, meditation.filePath)
        : join(UPLOADS_PATH, meditation.filePath);

    try {
        await access(filePath);
    } catch {
        return new Response('File not found', { status: 404 });
    }

    const data = await readFile(filePath);

    return new Response(data, {
        headers: {
            'Content-Type': 'audio/ogg',
            'Content-Length': data.byteLength.toString(),
        },
    });
}
