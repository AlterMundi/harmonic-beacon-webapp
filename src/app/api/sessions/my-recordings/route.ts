import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/sessions/my-recordings
 * List ended sessions with recordings that the user participated in or provided.
 */
export async function GET() {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true },
    });

    if (!user) {
        return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    const sessions = await prisma.scheduledSession.findMany({
        where: {
            status: 'ENDED',
            recordingPath: { not: null },
            OR: [
                { providerId: user.id },
                { participants: { some: { userId: user.id } } },
            ],
        },
        select: {
            id: true,
            title: true,
            endedAt: true,
            durationSeconds: true,
            beaconRecordingPath: true,
            provider: { select: { name: true } },
        },
        orderBy: { endedAt: 'desc' },
        take: 20,
    });

    return NextResponse.json({
        sessions: sessions.map((s) => ({
            id: s.id,
            title: s.title,
            providerName: s.provider.name,
            endedAt: s.endedAt?.toISOString() ?? null,
            durationSeconds: s.durationSeconds,
            hasBeaconRecording: !!s.beaconRecordingPath,
        })),
    });
}
