import { NextRequest, NextResponse } from 'next/server';

import { isSameOriginLiveRequest } from '@/lib/account-rp';
import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { HandQueueError, lowerParticipantHand } from '@/lib/hand-queue';
import {
    demoteParticipant,
    muteParticipantTrack,
    promoteParticipant,
    reconcileParticipants,
    StageControlError,
} from '@/lib/stage-control';
import { eventStaffPolicy } from '@/lib/staff-capabilities';

export const dynamic = 'force-dynamic';

type StageRequest = {
    action?: unknown;
    participantId?: unknown;
    reason?: unknown;
    trackSid?: unknown;
    muted?: unknown;
    expectedGrantVersion?: unknown;
};

/** Own grant snapshot only: staff do not use the attendee hand queue. */
export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [staff, errorResponse] = await requireStaff();
    if (!staff) return errorResponse;
    const { id } = await params;
    const participant = await prisma.sessionParticipant.findFirst({
        where: { scheduledSessionId: id, staffUserId: staff.userId },
        select: { grantVersion: true, publishGrantedAt: true, publishRevokedAt: true, grantReconcileNeeded: true },
    });
    if (!participant) return NextResponse.json({ error: 'participant_not_joined' }, { status: 409 });
    return NextResponse.json({
        grantVersion: participant.grantVersion,
        canPublish: participant.publishGrantedAt !== null && participant.publishRevokedAt === null && !participant.grantReconcileNeeded,
    }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [staff, errorResponse] = await requireStaff();
    if (!staff) {
        return errorResponse;
    }

    const { id } = await params;
    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id },
        select: { facilitatorId: true },
    });
    if (!scheduledSession) {
        return NextResponse.json(
            { error: 'session_not_found' },
            { status: 404 },
        );
    }
    if (!eventStaffPolicy(
        staff.role,
        scheduledSession.facilitatorId === staff.userId,
    ).canOperateEvent) {
        return NextResponse.json(
            { error: 'Insufficient permissions' },
            { status: 403 },
        );
    }

    let body: StageRequest;
    try {
        body = await request.json() as StageRequest;
    } catch {
        return invalidRequest('A JSON request body is required');
    }

    const action = typeof body.action === 'string' ? body.action : '';
    const participantId =
        typeof body.participantId === 'string' && body.participantId.trim()
            ? body.participantId
            : undefined;
    const reason = typeof body.reason === 'string' ? body.reason : undefined;

    try {
        if (action === 'self_publish' || action === 'self_leave') {
            if (!isSameOriginLiveRequest(request)) {
                return NextResponse.json({ error: 'invalid_origin' }, { status: 403 });
            }
            const participant = await prisma.sessionParticipant.findFirst({
                where: { scheduledSessionId: id, staffUserId: staff.userId }, select: { id: true },
            });
            if (!participant) return NextResponse.json({ error: 'participant_not_joined' }, { status: 409 });
            if (action === 'self_leave') {
                if (!Number.isSafeInteger(body.expectedGrantVersion) || (body.expectedGrantVersion as number) < 0) {
                    return invalidRequest('A current grant version is required');
                }
                return NextResponse.json(await demoteParticipant({
                    scheduledSessionId: id, participantId: participant.id, actorUserId: staff.userId,
                    reason: 'Staff voluntarily left the stage', auditAction: 'stage.staff.leave',
                    clearHand: true, expectedGrantVersion: body.expectedGrantVersion as number,
                }));
            }
            return NextResponse.json(await promoteParticipant({
                scheduledSessionId: id, participantId: participant.id, actorUserId: staff.userId,
                reason: 'Staff requested publication controls',
            }));
        }
        if (action === 'promote') {
            if (!participantId) {
                return invalidRequest('A participant ID is required');
            }
            const result = await promoteParticipant({
                scheduledSessionId: id,
                participantId,
                actorUserId: staff.userId,
                reason,
            });
            return NextResponse.json(result);
        }
        if (action === 'demote') {
            if (!participantId) {
                return invalidRequest('A participant ID is required');
            }
            const result = await demoteParticipant({
                scheduledSessionId: id,
                participantId,
                actorUserId: staff.userId,
                reason,
            });
            return NextResponse.json(result);
        }
        if (action === 'mute') {
            if (
                !participantId ||
                typeof body.trackSid !== 'string' ||
                body.muted !== true
            ) {
                return invalidRequest(
                    'Participant ID and track SID are required; staff may mute but cannot remotely unmute participant media',
                );
            }
            const result = await muteParticipantTrack({
                scheduledSessionId: id,
                participantId,
                actorUserId: staff.userId,
                trackSid: body.trackSid,
                muted: body.muted,
            });
            return NextResponse.json(result);
        }
        if (action === 'lower_hand') {
            if (!participantId) {
                return invalidRequest('A participant ID is required');
            }
            const result = await lowerParticipantHand({
                scheduledSessionId: id,
                participantId,
                actorUserId: staff.userId,
                reason,
            });
            return NextResponse.json({
                participantId: result.participantId,
                raised: result.raised,
                raisedAt: result.raisedAt?.toISOString() ?? null,
                queuePosition: result.queuePosition,
                canPublish: result.canPublish,
            });
        }
        if (action === 'reconcile') {
            const result = await reconcileParticipants({
                scheduledSessionId: id,
                actorUserId: staff.userId,
                participantId,
            });
            return NextResponse.json({
                ...result,
                reconcileNeeded: result.failed.length > 0,
            });
        }
        return invalidRequest(
            'Action must be self_publish, self_leave, promote, demote, mute, lower_hand, or reconcile',
        );
    } catch (error) {
        if (error instanceof HandQueueError) {
            return NextResponse.json(
                { error: error.code, message: error.message },
                { status: error.status },
            );
        }
        if (error instanceof StageControlError) {
            return NextResponse.json(
                {
                    error: error.code,
                    message: error.message,
                    ...error.details,
                },
                { status: error.status },
            );
        }
        console.error('[stage] unexpected stage control failure');
        return NextResponse.json(
            { error: 'stage_control_unavailable' },
            { status: 500 },
        );
    }
}

function invalidRequest(message: string): NextResponse {
    return NextResponse.json(
        { error: 'invalid_request', message },
        { status: 400 },
    );
}
