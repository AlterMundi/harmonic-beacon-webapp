import { NextRequest, NextResponse } from 'next/server';

import {
    getHandState,
    HandQueueError,
    lowerHand,
    raiseHand,
    type HandState,
} from '@/lib/hand-queue';
import { resolveRoomViewer } from '@/lib/room-entitlement';
import { isSameOriginLiveRequest } from '@/lib/account-rp';
import {
    declineStageInvitation,
    leaveStage,
    StageControlError,
} from '@/lib/stage-control';

export const dynamic = 'force-dynamic';

/**
 * The caller-owned hand queue, including staff using the participant view.
 * The read-only viewer gate validates the same identity/event entitlement as
 * tokens, without materializing a participant or a facilitator preflight grant.
 * Raising a hand never publishes or grants stage permission.
 */

type HandResponse = {
    participantId: string;
    raised: boolean;
    raisedAt: string | null;
    queuePosition: number | null;
    canPublish: boolean;
    grantVersion: number;
};

function serialize(state: HandState): HandResponse {
    return {
        participantId: state.participantId,
        raised: state.raised,
        raisedAt: state.raisedAt?.toISOString() ?? null,
        queuePosition: state.queuePosition,
        canPublish: state.canPublish,
        grantVersion: state.grantVersion,
    };
}

async function resolveHandOwner(request: NextRequest, sessionId: string) {
    const entitlement = await resolveRoomViewer(request, sessionId);
    if (!entitlement.ok) {
        return {
            error: NextResponse.json(
                { error: entitlement.error },
                { status: entitlement.status },
            ),
        };
    }
    const { principal } = entitlement;
    if ((!principal.ticketEntitlementId && !principal.staffUserId) ||
        principal.session.status !== 'LIVE' ||
        (principal.staffUserId && request.method !== 'GET' && !isSameOriginLiveRequest(request))) {
        return {
            error: NextResponse.json(
                { error: 'Insufficient permissions' },
                { status: 403 },
            ),
        };
    }
    return { principal };
}

function handErrorResponse(error: unknown): NextResponse {
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
    console.error('[hand] unexpected hand queue failure');
    return NextResponse.json(
        { error: 'hand_queue_unavailable' },
        { status: 500 },
    );
}

/** The caller's own queue state, polled by the room page every two seconds. */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const { principal, error } = await resolveHandOwner(request, id);
    if (!principal) {
        return error;
    }
    try {
        const state = await getHandState({
            scheduledSessionId: id,
            participantIdentity: principal.identity,
        });
        return NextResponse.json(serialize(state));
    } catch (failure) {
        return handErrorResponse(failure);
    }
}

/** Raise the hand. Repeated raises keep the original `raisedAt`. */
export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const { principal, error } = await resolveHandOwner(request, id);
    if (!principal) {
        return error;
    }
    try {
        const state = await raiseHand({
            scheduledSessionId: id,
            participantIdentity: principal.identity,
            ticketEntitlementId: principal.ticketEntitlementId,
            staffUserId: principal.staffUserId,
            displayName: principal.displayName,
        });
        return NextResponse.json(serialize(state));
    } catch (failure) {
        return handErrorResponse(failure);
    }
}

/** Lower the caller's own hand. */
export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const { principal, error } = await resolveHandOwner(request, id);
    if (!principal) {
        return error;
    }
    try {
        const state = await lowerHand({
            scheduledSessionId: id,
            participantIdentity: principal.identity,
        });
        return NextResponse.json(serialize(state));
    } catch (failure) {
        return handErrorResponse(failure);
    }
}

/** Decline the caller's own active stage invitation and release its grant. */
export async function PATCH(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const { principal, error } = await resolveHandOwner(request, id);
    if (!principal) {
        return error;
    }
    // Staff voluntary exit/decline retains the existing self_leave path, its
    // assignment exception, audited actor and version fence. No ordinary
    // attendee demotion is extended to a protected facilitator.
    if (principal.staffUserId) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

    let body: { action?: unknown; expectedGrantVersion?: unknown };
    try {
        body = await request.json() as {
            action?: unknown;
            expectedGrantVersion?: unknown;
        };
    } catch {
        return NextResponse.json(
            { error: 'invalid_request', message: 'A JSON request body is required' },
            { status: 400 },
        );
    }
    if (body.action !== 'decline_invitation' && body.action !== 'leave_stage') {
        return NextResponse.json(
            { error: 'invalid_request', message: 'Action must be decline_invitation or leave_stage' },
            { status: 400 },
        );
    }
    if (!Number.isSafeInteger(body.expectedGrantVersion) ||
        (body.expectedGrantVersion as number) < 0) {
        return NextResponse.json(
            { error: 'invalid_request', message: 'A current grant version is required' },
            { status: 400 },
        );
    }

    try {
        const changeStage = body.action === 'leave_stage'
            ? leaveStage
            : declineStageInvitation;
        const changed = await changeStage({
            scheduledSessionId: id,
            participantIdentity: principal.identity,
            expectedGrantVersion: body.expectedGrantVersion as number,
        });
        return NextResponse.json(serialize(await getHandState({
            scheduledSessionId: id,
            participantIdentity: changed.participantIdentity,
        })));
    } catch (failure) {
        return handErrorResponse(failure);
    }
}
