import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { streamFile } from '@/lib/stream-file';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions/[id]/recording?track=session|beacon
 * Stream session or beacon recording to authorized users.
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

    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id },
        select: {
            id: true,
            providerId: true,
            recordingPath: true,
            beaconRecordingPath: true,
        },
    });

    if (!scheduledSession) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // Access check: provider, participant, or admin
    const isProvider = scheduledSession.providerId === user.id;
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

    const track = request.nextUrl.searchParams.get('track') || 'session';
    const filePath = track === 'beacon'
        ? scheduledSession.beaconRecordingPath
        : scheduledSession.recordingPath;

    if (!filePath) {
        return NextResponse.json({ error: 'No recording available' }, { status: 404 });
    }

    const response = streamFile(filePath, request.headers.get('range'));
    if (!response) {
        return NextResponse.json({ error: 'Recording file not found' }, { status: 404 });
    }
    return response;
}
