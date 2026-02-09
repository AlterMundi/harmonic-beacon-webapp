import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { getEgressClient } from '@/lib/livekit-server';
import { existsSync } from 'fs';

export const dynamic = 'force-dynamic';

/**
 * POST /api/provider/sessions/[id]/recording/stop
 * Stop all active track egress recordings for this session.
 */
export async function POST(
    _request: NextRequest,
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

    const activeRecordings = await prisma.sessionRecording.findMany({
        where: { sessionId: id, active: true },
    });

    if (activeRecordings.length === 0) {
        return NextResponse.json(
            { error: 'No recording in progress' },
            { status: 400 },
        );
    }

    const egressClient = getEgressClient();

    // Stop all egresses in parallel
    await Promise.allSettled(
        activeRecordings.map((r) =>
            egressClient.stopEgress(r.egressId).catch((e: unknown) => {
                console.error(`Failed to stop egress ${r.egressId}:`, e);
            }),
        ),
    );

    // Wait for egresses to finalize files
    await new Promise((r) => setTimeout(r, 2000));

    // Verify files and update records
    const now = new Date();
    const results = await Promise.all(
        activeRecordings.map(async (r) => {
            const fileExists = r.filePath && existsSync(r.filePath);
            if (fileExists) {
                return prisma.sessionRecording.update({
                    where: { id: r.id },
                    data: { active: false, stoppedAt: now },
                });
            } else {
                await prisma.sessionRecording.delete({ where: { id: r.id } });
                return null;
            }
        }),
    );

    const finalRecordings = results.filter(Boolean);

    return NextResponse.json({
        ok: true,
        recordings: finalRecordings.map((r) => ({
            id: r!.id,
            participantIdentity: r!.participantIdentity,
            category: r!.category,
        })),
    });
}
