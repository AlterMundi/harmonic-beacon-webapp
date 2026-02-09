import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { streamFile } from '@/lib/stream-file';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions/[id]/recording?recordingId=UUID
 * Stream a specific recording track to authorized users.
 * Access: provider, session participant, or admin.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    const { id } = await params;

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true, role: true },
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
            session: { select: { id: true, providerId: true } },
        },
    });

    if (!recording || recording.sessionId !== id) {
        return NextResponse.json({ error: 'Recording not found' }, { status: 404 });
    }

    // Access check: provider, participant, or admin
    const isProvider = recording.session.providerId === user.id;
    const isAdmin = user.role === 'ADMIN';

    if (!isProvider && !isAdmin) {
        const participant = await prisma.sessionParticipant.findUnique({
            where: {
                sessionId_userId: { sessionId: id, userId: user.id },
            },
            select: { id: true },
        });
        if (!participant) {
            return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
        }
    }

    if (!recording.filePath) {
        return NextResponse.json({ error: 'No recording available' }, { status: 404 });
    }

    const response = streamFile(recording.filePath, request.headers.get('range'));
    if (!response) {
        return NextResponse.json({ error: 'Recording file not found' }, { status: 404 });
    }
    return response;
}
