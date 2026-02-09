import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { streamFile } from '@/lib/stream-file';

export const dynamic = 'force-dynamic';

/**
 * GET /api/provider/sessions/[id]/recording?recordingId=UUID
 * Stream a specific recording track file (OGG) to the provider.
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

    const recordingId = request.nextUrl.searchParams.get('recordingId');
    if (!recordingId) {
        return NextResponse.json({ error: 'recordingId required' }, { status: 400 });
    }

    const recording = await prisma.sessionRecording.findUnique({
        where: { id: recordingId },
        include: {
            session: { select: { providerId: true } },
        },
    });

    if (!recording || recording.sessionId !== id) {
        return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    if (recording.session.providerId !== user.id) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    if (!recording.filePath) {
        return NextResponse.json({ error: 'No recording file available' }, { status: 404 });
    }

    const response = streamFile(recording.filePath, request.headers.get('range'));
    if (!response) {
        return NextResponse.json({ error: 'Recording file not found' }, { status: 404 });
    }
    return response;
}
