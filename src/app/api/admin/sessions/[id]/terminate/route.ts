import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { requireRole } from '@/lib/auth';
import { logAdminAction } from '@/lib/audit';
import { endLiveSession } from '@/lib/session-lifecycle';
import { redactErrorDetail } from '@/lib/redact';

export const dynamic = 'force-dynamic';

/** Long enough to be an account of what happened, short of an essay. */
const MIN_REASON_LENGTH = 8;
const MAX_REASON_LENGTH = 1000;

/**
 * POST /api/admin/sessions/[id]/terminate
 * The Session Kill Switch — TRUST_AND_SAFETY.md §4. ADMIN only.
 * Body: { reason }
 *
 * Until this existed the only way a live session stopped was the hosting Provider
 * ending their own, so a compromised or abusive host was uncontrollable. This
 * gives an Admin a way in, and the mandatory `reason` plus the audit entry are
 * what stop that from being an unaccountable power over someone else's session —
 * §4 is explicit that the control and the log ship together or the control ships
 * unaccountable.
 *
 * What it does, in order: stop egress and move the session to ENDED (shared with
 * the Provider's own end path, src/lib/session-lifecycle.ts), then delete the
 * LiveKit room to disconnect every participant.
 */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [session, errorResponse] = await requireRole('ADMIN');
    if (!session) return errorResponse;

    const { id } = await params;

    let body;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const { reason } = body as { reason?: unknown };

    // Mandatory, and checked before anything is touched. An Admin ending someone
    // else's live session without recording why is precisely the act the audit log
    // exists to prevent, so a missing reason is a refusal and not a default.
    if (typeof reason !== 'string' || reason.trim().length < MIN_REASON_LENGTH) {
        return NextResponse.json(
            { error: `reason is required and must be at least ${MIN_REASON_LENGTH} characters` },
            { status: 400 },
        );
    }

    if (reason.length > MAX_REASON_LENGTH) {
        return NextResponse.json(
            { error: `reason must be ${MAX_REASON_LENGTH} characters or fewer` },
            { status: 400 },
        );
    }

    const declaredReason = reason.trim();

    try {
        const scheduledSession = await prisma.scheduledSession.findUnique({
            where: { id },
            select: {
                id: true,
                roomName: true,
                providerId: true,
                status: true,
                startedAt: true,
            },
        });

        if (!scheduledSession) {
            return NextResponse.json({ error: 'Session not found' }, { status: 404 });
        }

        if (scheduledSession.status !== 'LIVE') {
            return NextResponse.json(
                { error: 'Can only terminate a LIVE session' },
                { status: 400 },
            );
        }

        // Participant count is read before the room goes away, for the incident
        // snapshot TRUST_AND_SAFETY.md §4.4 asks for.
        const participantCount = await prisma.sessionParticipant.count({
            where: { sessionId: id, leftAt: null },
        });

        // Stops the recordings, moves the row to ENDED, and disconnects everyone
        // still connected. Room closure moved into endLiveSession so the Provider's
        // own end path gets it too — see the note there.
        const { session: ended, recordingsStopped, roomDeleted } = await endLiveSession(
            id,
            scheduledSession.startedAt,
            scheduledSession.roomName,
        );

        await logAdminAction(session, {
            action: 'session.terminate',
            targetType: 'SESSION',
            targetId: id,
            metadata: {
                reason: declaredReason,
                roomName: scheduledSession.roomName,
                providerId: scheduledSession.providerId,
                participantsAtTermination: participantCount,
                recordingsStopped,
                roomDeleted,
                durationSeconds: ended.durationSeconds ?? 0,
            },
        });

        return NextResponse.json({
            terminated: true,
            roomDeleted,
            session: {
                id: ended.id,
                status: ended.status,
                endedAt: ended.endedAt?.toISOString() ?? null,
                durationSeconds: ended.durationSeconds,
            },
            recordingsStopped,
            participantsAtTermination: participantCount,
        });
    } catch (error) {
        console.error('Failed to terminate session:', redactErrorDetail(error));
        return NextResponse.json({ error: 'Failed to terminate session' }, { status: 500 });
    }
}
