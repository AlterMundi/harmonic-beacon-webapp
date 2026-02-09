import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireAuth } from '@/lib/auth';
import { createSessionToken } from '@/lib/livekit-server';

export const dynamic = 'force-dynamic';

/**
 * GET /api/scheduled-sessions/[id]/token
 * Get a LiveKit token to join a scheduled session room.
 * Provider gets canPublish=true; listeners get canPublish=false.
 * Optionally pass ?invite=CODE to validate invite and track usage.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [session, errorResponse] = await requireAuth();
    if (!session) return errorResponse;

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const inviteCode = searchParams.get('invite');

    const user = await prisma.user.findUnique({
        where: { zitadelId: session.user.id },
        select: { id: true, name: true, email: true },
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

    const isProvider = scheduledSession.providerId === user.id;

    // Providers can connect to SCHEDULED sessions (to set up before going live)
    // Listeners can only connect to LIVE sessions
    if (isProvider) {
        if (scheduledSession.status !== 'LIVE' && scheduledSession.status !== 'SCHEDULED') {
            return NextResponse.json(
                { error: 'Session is not active' },
                { status: 400 },
            );
        }
    } else {
        if (scheduledSession.status !== 'LIVE') {
            return NextResponse.json(
                { error: 'Session is not live yet' },
                { status: 400 },
            );
        }
    }

    let canPublish = isProvider;

    // Check if user is already a participant (reconnect / page refresh)
    const existingParticipant = await prisma.sessionParticipant.findUnique({
        where: {
            sessionId_userId: { sessionId: id, userId: user.id },
        },
    });

    // Validate invite code if provided
    if (inviteCode && !isProvider) {
        const invite = await prisma.sessionInvite.findUnique({
            where: { code: inviteCode },
        });

        if (!invite || invite.sessionId !== id) {
            return NextResponse.json({ error: 'Invalid invite code' }, { status: 400 });
        }

        if (invite.expiresAt && invite.expiresAt < new Date()) {
            return NextResponse.json({ error: 'Invite has expired' }, { status: 400 });
        }

        if (invite.maxUses > 0 && invite.usedCount >= invite.maxUses) {
            return NextResponse.json({ error: 'Invite usage limit reached' }, { status: 400 });
        }

        if (invite.canPublish) {
            canPublish = true;
        }

        // Only increment usage for new participants (not reconnects)
        if (!existingParticipant) {
            const updated = await prisma.sessionInvite.updateMany({
                where: {
                    id: invite.id,
                    OR: [
                        { maxUses: 0 },
                        { usedCount: { lt: invite.maxUses } },
                    ],
                },
                data: { usedCount: { increment: 1 } },
            });

            if (updated.count === 0) {
                return NextResponse.json({ error: 'Invite usage limit reached' }, { status: 400 });
            }
        }
    }

    // Track participant (upsert: reset leftAt on reconnect)
    await prisma.sessionParticipant.upsert({
        where: {
            sessionId_userId: { sessionId: id, userId: user.id },
        },
        create: { sessionId: id, userId: user.id },
        update: { leftAt: null, durationSeconds: null },
    });

    const identity = `user-${user.id}`;
    const name = user.name || user.email;

    const token = await createSessionToken(
        scheduledSession.roomName,
        identity,
        name,
        canPublish,
    );

    // Check if recording is active
    const activeRecording = await prisma.sessionRecording.findFirst({
        where: { sessionId: id, active: true },
        select: { id: true },
    });

    return NextResponse.json({
        token,
        identity,
        room: scheduledSession.roomName,
        canPublish,
        session: {
            id: scheduledSession.id,
            title: scheduledSession.title,
            status: scheduledSession.status,
            startedAt: scheduledSession.startedAt?.toISOString() ?? null,
            isRecording: !!activeRecording,
        },
    });
}
