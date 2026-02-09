import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { getEgressClient } from '@/lib/livekit-server';
import { existsSync } from 'fs';

export const dynamic = 'force-dynamic';

/**
 * GET /api/provider/sessions/[id]
 * Get session detail with invites, participants, and recordings.
 */
export async function GET(
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
        include: {
            invites: {
                orderBy: { createdAt: 'desc' },
            },
            participants: {
                include: {
                    user: { select: { id: true, name: true, email: true } },
                },
                orderBy: { joinedAt: 'desc' },
            },
            recordings: {
                select: {
                    id: true,
                    participantIdentity: true,
                    category: true,
                    active: true,
                    egressId: true,
                },
            },
            _count: {
                select: { participants: true },
            },
        },
    });

    if (!scheduledSession) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    if (scheduledSession.providerId !== user.id) {
        return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
    }

    return NextResponse.json({ session: scheduledSession });
}

/**
 * PATCH /api/provider/sessions/[id]
 * Update session status: start, end, or cancel.
 */
export async function PATCH(
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

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const { action } = body;

    if (action === 'start') {
        if (scheduledSession.status !== 'SCHEDULED') {
            return NextResponse.json(
                { error: 'Can only start a SCHEDULED session' },
                { status: 400 },
            );
        }
        const updated = await prisma.scheduledSession.update({
            where: { id },
            data: { status: 'LIVE', startedAt: new Date() },
        });
        return NextResponse.json({ session: updated });
    }

    if (action === 'end') {
        if (scheduledSession.status !== 'LIVE') {
            return NextResponse.json(
                { error: 'Can only end a LIVE session' },
                { status: 400 },
            );
        }

        // Stop active recordings if any
        const activeRecordings = await prisma.sessionRecording.findMany({
            where: { sessionId: id, active: true },
        });

        if (activeRecordings.length > 0) {
            const egressClient = getEgressClient();
            await Promise.allSettled(
                activeRecordings.map((r) =>
                    egressClient.stopEgress(r.egressId).catch((e: unknown) => {
                        console.error(`Failed to stop egress ${r.egressId} on end:`, e);
                    }),
                ),
            );
            // Wait for egresses to finalize files
            await new Promise((r) => setTimeout(r, 2000));

            // Verify files and update records
            const now = new Date();
            await Promise.all(
                activeRecordings.map(async (r) => {
                    const fileExists = r.filePath && existsSync(r.filePath);
                    if (fileExists) {
                        await prisma.sessionRecording.update({
                            where: { id: r.id },
                            data: { active: false, stoppedAt: now },
                        });
                    } else {
                        await prisma.sessionRecording.delete({ where: { id: r.id } });
                    }
                }),
            );
        }

        const now = new Date();
        const durationSeconds = scheduledSession.startedAt
            ? Math.floor((now.getTime() - scheduledSession.startedAt.getTime()) / 1000)
            : 0;

        const updated = await prisma.scheduledSession.update({
            where: { id },
            data: {
                status: 'ENDED',
                endedAt: now,
                durationSeconds,
            },
        });
        return NextResponse.json({ session: updated });
    }

    if (action === 'cancel') {
        if (scheduledSession.status === 'ENDED' || scheduledSession.status === 'CANCELLED') {
            return NextResponse.json(
                { error: 'Session is already ended or cancelled' },
                { status: 400 },
            );
        }
        const updated = await prisma.scheduledSession.update({
            where: { id },
            data: { status: 'CANCELLED', endedAt: new Date() },
        });
        return NextResponse.json({ session: updated });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
}
