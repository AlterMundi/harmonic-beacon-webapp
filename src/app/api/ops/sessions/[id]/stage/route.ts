import { NextRequest, NextResponse } from 'next/server';

import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import {
    demoteParticipant,
    muteParticipantTrack,
    promoteParticipant,
    reconcileParticipants,
    StageControlError,
} from '@/lib/stage-control';

export const dynamic = 'force-dynamic';

type StageRequest = {
    action?: unknown;
    participantId?: unknown;
    reason?: unknown;
    trackSid?: unknown;
    muted?: unknown;
};

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [staff, errorResponse] = await requireStaff(
        'FACILITATOR',
        'OPERATOR',
        'ADMIN',
    );
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
    if (
        staff.role === 'FACILITATOR' &&
        scheduledSession.facilitatorId !== staff.userId
    ) {
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
                typeof body.muted !== 'boolean'
            ) {
                return invalidRequest(
                    'Participant ID, track SID, and muted state are required',
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
            'Action must be promote, demote, mute, or reconcile',
        );
    } catch (error) {
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
