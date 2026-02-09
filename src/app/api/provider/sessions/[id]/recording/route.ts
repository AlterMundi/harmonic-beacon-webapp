import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { streamFile } from '@/lib/stream-file';

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

    const response = streamFile(scheduledSession.recordingPath, request.headers.get('range'));
    if (!response) {
        return NextResponse.json({ error: 'Recording file not found' }, { status: 404 });
    }
    return response;
}
