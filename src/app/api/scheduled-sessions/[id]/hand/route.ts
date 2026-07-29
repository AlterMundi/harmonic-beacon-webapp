import { NextRequest, NextResponse } from 'next/server';

import {
    getHandState,
    HandQueueError,
    lowerHand,
    raiseHand,
    type HandState,
} from '@/lib/hand-queue';
import { resolveRoomPrincipal } from '@/lib/room-entitlement';

export const dynamic = 'force-dynamic';

/**
 * The attendee side of the WS3-02 hand queue. `resolveRoomPrincipal` is the
 * same entitlement gate the token route uses, so only the entitled attendee
 * of this event can touch their own hand — staff and other sessions' tickets
 * are rejected there. The response carries no PII, matching the console.
 */

type HandResponse = {
    participantId: string;
    raised: boolean;
    raisedAt: string | null;
    queuePosition: number | null;
    canPublish: boolean;
};

function serialize(state: HandState): HandResponse {
    return {
        participantId: state.participantId,
        raised: state.raised,
        raisedAt: state.raisedAt?.toISOString() ?? null,
        queuePosition: state.queuePosition,
        canPublish: state.canPublish,
    };
}

async function resolveAttendee(request: NextRequest, sessionId: string) {
    const entitlement = await resolveRoomPrincipal(request, sessionId);
    if (!entitlement.ok) {
        return {
            error: NextResponse.json(
                { error: entitlement.error },
                { status: entitlement.status },
            ),
        };
    }
    // Hands are an attendee control; staff operate the queue from the console.
    if (!entitlement.principal.ticketEntitlementId) {
        return {
            error: NextResponse.json(
                { error: 'Insufficient permissions' },
                { status: 403 },
            ),
        };
    }
    return { principal: entitlement.principal };
}

function handErrorResponse(error: unknown): NextResponse {
    if (error instanceof HandQueueError) {
        return NextResponse.json(
            { error: error.code, message: error.message },
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
    const { principal, error } = await resolveAttendee(request, id);
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
    const { principal, error } = await resolveAttendee(request, id);
    if (!principal) {
        return error;
    }
    try {
        const state = await raiseHand({
            scheduledSessionId: id,
            participantIdentity: principal.identity,
            ticketEntitlementId: principal.ticketEntitlementId,
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
    const { principal, error } = await resolveAttendee(request, id);
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
