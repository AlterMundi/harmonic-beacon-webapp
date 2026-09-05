/**
 * Database-backed hand queue for the weekend spotlight flow (WS3-02).
 *
 * A raised hand is just `SessionParticipant.raisedAt`. The original timestamp
 * is the queue order, so raising is idempotent by construction: a second raise
 * keeps the first `raisedAt` and cannot move the attendee ahead — only an
 * explicit lower followed by a new raise sends them to the back.
 *
 * Polling, not LiveKit data messages, carries this state to the consoles. The
 * database is the only authority, which is what lets a refreshed operator page
 * and two concurrent operators all see the same queue.
 */

import { prisma } from '@/lib/db';

export class HandQueueError extends Error {
    constructor(
        public readonly code: 'session_not_found' | 'participant_not_found',
        public readonly status: 404,
        message: string,
    ) {
        super(message);
        this.name = 'HandQueueError';
    }
}

export type HandState = {
    participantId: string;
    raised: boolean;
    raisedAt: Date | null;
    queuePosition: number | null;
    canPublish: boolean;
    grantVersion: number;
};

type HandTargetInput = {
    scheduledSessionId: string;
    participantIdentity: string;
};

type RaiseInput = HandTargetInput & {
    ticketEntitlementId: string | null;
    now?: Date;
};

type LowerInput = HandTargetInput & {
    actorUserId?: string;
    reason?: string;
};

function hasActiveGrant(participant: {
    publishGrantedAt: Date | null;
    publishRevokedAt: Date | null;
}): boolean {
    return participant.publishGrantedAt !== null &&
        participant.publishRevokedAt === null;
}

/**
 * Position among the waiting hands, 1-based, ordered by original `raisedAt`.
 * Null when the hand is not raised or the attendee already holds the floor;
 * publishers leave the queue rather than blocking it.
 */
async function computeQueuePosition(
    scheduledSessionId: string,
    participant: {
        id: string;
        raisedAt: Date | null;
        publishGrantedAt: Date | null;
        publishRevokedAt: Date | null;
        grantVersion: number;
    },
): Promise<number | null> {
    if (participant.raisedAt === null || hasActiveGrant(participant)) {
        return null;
    }
    const waitingAhead = await prisma.sessionParticipant.count({
        where: {
            scheduledSessionId,
            raisedAt: { not: null, lt: participant.raisedAt },
            publishRevokedAt: null,
            // An earlier hand that already holds the floor is not ahead in the
            // queue; the count below re-checks that with a grant timestamp.
            publishGrantedAt: null,
        },
    });
    // Ties on raisedAt are broken by id for a stable order; count same-instant
    // hands with a smaller id as ahead as well.
    const tiesAhead = await prisma.sessionParticipant.count({
        where: {
            scheduledSessionId,
            raisedAt: participant.raisedAt,
            publishGrantedAt: null,
            publishRevokedAt: null,
            id: { lt: participant.id },
        },
    });
    return waitingAhead + tiesAhead + 1;
}

function toHandState(
    participant: {
        id: string;
        raisedAt: Date | null;
        publishGrantedAt: Date | null;
        publishRevokedAt: Date | null;
        grantVersion: number;
    },
    queuePosition: number | null,
): HandState {
    return {
        participantId: participant.id,
        raised: participant.raisedAt !== null,
        raisedAt: participant.raisedAt,
        queuePosition,
        canPublish: hasActiveGrant(participant),
        grantVersion: participant.grantVersion,
    };
}

/**
 * Raise the attendee's hand. Idempotent: when a hand is already up its
 * original `raisedAt` — and therefore its queue position — is preserved.
 *
 * The participant row normally exists already because the room token route
 * upserts it on join; the upsert here covers a raise that lands first.
 */
export async function raiseHand(input: RaiseInput): Promise<HandState> {
    const now = input.now ?? new Date();
    // Upsert creates the row with raisedAt for a first-time raiser.
    const participant = await prisma.sessionParticipant.upsert({
        where: {
            scheduledSessionId_participantIdentity: {
                scheduledSessionId: input.scheduledSessionId,
                participantIdentity: input.participantIdentity,
            },
        },
        create: {
            scheduledSessionId: input.scheduledSessionId,
            participantIdentity: input.participantIdentity,
            ticketEntitlementId: input.ticketEntitlementId,
            raisedAt: now,
        },
        // Empty update: an existing row keeps its original raisedAt.
        update: {},
        select: {
            id: true,
            raisedAt: true,
            publishGrantedAt: true,
            publishRevokedAt: true,
            grantVersion: true,
        },
    });
    // The upsert above matches on identity, so an existing row that has not
    // yet raised (created by the token route without raisedAt) needs the
    // raise applied explicitly. A no-op when the hand is already up.
    if (participant.raisedAt === null) {
        await prisma.sessionParticipant.update({
            where: { id: participant.id },
            data: { raisedAt: now },
        });
        participant.raisedAt = now;
    }
    const queuePosition = await computeQueuePosition(
        input.scheduledSessionId,
        participant,
    );
    return toHandState(participant, queuePosition);
}

/**
 * Lower a hand. Idempotent — lowering a hand that is not up is a no-op.
 *
 * Used both by the attendee lowering their own hand (no actor) and by staff
 * removing a hand from the console; the staff path is audited like every
 * other operator mutation, without PII.
 */
export async function lowerHand(input: LowerInput): Promise<HandState> {
    const participant = await prisma.sessionParticipant.findUnique({
        where: {
            scheduledSessionId_participantIdentity: {
                scheduledSessionId: input.scheduledSessionId,
                participantIdentity: input.participantIdentity,
            },
        },
        select: {
            id: true,
            raisedAt: true,
            publishGrantedAt: true,
            publishRevokedAt: true,
            grantVersion: true,
        },
    });
    if (!participant) {
        throw new HandQueueError(
            'participant_not_found',
            404,
            'Participant not found',
        );
    }

    const updated = participant.raisedAt === null
        ? participant
        : await prisma.sessionParticipant.update({
            where: { id: participant.id },
            data: { raisedAt: null },
            select: {
                id: true,
                raisedAt: true,
                publishGrantedAt: true,
                publishRevokedAt: true,
                grantVersion: true,
            },
        });

    if (input.actorUserId && participant.raisedAt !== null) {
        await prisma.auditLog.create({
            data: {
                actorUserId: input.actorUserId,
                action: 'stage.hand_lower',
                targetType: 'SESSION_PARTICIPANT',
                targetId: participant.id,
                reason: input.reason?.trim() || null,
            },
        });
    }
    return toHandState(updated, null);
}

/**
 * Staff-side removal keyed by the participant row id, which is what the
 * console's give/take floor actions already carry around.
 */
export async function lowerParticipantHand(input: {
    scheduledSessionId: string;
    participantId: string;
    actorUserId: string;
    reason?: string;
}): Promise<HandState> {
    const participant = await prisma.sessionParticipant.findFirst({
        where: {
            id: input.participantId,
            scheduledSessionId: input.scheduledSessionId,
        },
        select: { participantIdentity: true },
    });
    if (!participant) {
        throw new HandQueueError(
            'participant_not_found',
            404,
            'Participant not found',
        );
    }
    return lowerHand({
        scheduledSessionId: input.scheduledSessionId,
        participantIdentity: participant.participantIdentity,
        actorUserId: input.actorUserId,
        reason: input.reason,
    });
}

/** Read the caller's own hand state for the room-page polling loop. */
export async function getHandState(
    input: HandTargetInput,
): Promise<HandState> {
    const participant = await prisma.sessionParticipant.findUnique({
        where: {
            scheduledSessionId_participantIdentity: {
                scheduledSessionId: input.scheduledSessionId,
                participantIdentity: input.participantIdentity,
            },
        },
        select: {
            id: true,
            raisedAt: true,
            publishGrantedAt: true,
            publishRevokedAt: true,
            grantVersion: true,
        },
    });
    if (!participant) {
        throw new HandQueueError(
            'participant_not_found',
            404,
            'Participant not found',
        );
    }
    const queuePosition = await computeQueuePosition(
        input.scheduledSessionId,
        participant,
    );
    return toHandState(participant, queuePosition);
}
