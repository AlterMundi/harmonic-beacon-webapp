import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { getRoomService } from '@/lib/livekit-server';
import {
    processParticipantGrantEffects,
    transitionParticipantGrant,
} from '@/lib/stage-grant-effects';
import {
    lockGrantParticipants,
    lockGrantSession,
    lockGrantStaff,
    lockGrantTickets,
} from '@/lib/stage-grant-locks';
import { eventStaffPolicy } from '@/lib/staff-capabilities';

const ACTIVE_GRANT = {
    publishGrantedAt: { not: null },
    publishRevokedAt: null,
} as const;

type ParticipantSnapshot = {
    id: string;
    participantIdentity: string;
    publishGrantedAt: Date | null;
    publishRevokedAt: Date | null;
    raisedAt: Date | null;
};

export class StageControlError extends Error {
    constructor(
        public readonly code:
            | 'session_not_found'
            | 'participant_not_found'
            | 'participant_not_connected'
            | 'stage_full'
            | 'entitlement_inactive'
            | 'not_publisher'
            | 'facilitator_required'
            | 'invalid_request'
            | 'livekit_failed',
        public readonly status: 400 | 404 | 409 | 502,
        message: string,
        public readonly details: {
            queuePosition?: number;
            reconcileNeeded?: boolean;
        } = {},
    ) {
        super(message);
        this.name = 'StageControlError';
    }
}

export type StageGrantResult = {
    participantId: string;
    participantIdentity: string;
    canPublish: boolean;
    reconcileNeeded: boolean;
    grantVersion: number;
};

export type TrackMuteResult = {
    participantId: string;
    trackSid: string;
    muted: boolean;
};

export type ReconcileResult = {
    reconciled: string[];
    failed: string[];
};

type GrantInput = {
    scheduledSessionId: string;
    participantId: string;
    actorUserId: string;
    reason?: string;
    now?: Date;
};

type DemoteInput = Omit<GrantInput, 'actorUserId'> & {
    actorUserId: string | null;
    auditAction?: 'stage.demote' | 'stage.invitation.decline';
    clearHand?: boolean;
};

type DeclineInvitationInput = {
    scheduledSessionId: string;
    participantIdentity: string;
    now?: Date;
};

type MuteInput = {
    scheduledSessionId: string;
    participantId: string;
    actorUserId: string;
    trackSid: string;
    muted: boolean;
};

async function requireConnectedParticipant(input: GrantInput): Promise<void> {
    const participant = await prisma.sessionParticipant.findFirst({
        where: {
            id: input.participantId,
            scheduledSessionId: input.scheduledSessionId,
        },
        select: {
            participantIdentity: true,
            scheduledSession: { select: { roomName: true } },
        },
    });
    if (!participant) {
        throw new StageControlError(
            'participant_not_found',
            404,
            'Participant not found',
        );
    }

    let connected: boolean;
    try {
        connected = (await getRoomService().listParticipants(
            participant.scheduledSession.roomName,
        )).some((liveParticipant) =>
            liveParticipant.identity === participant.participantIdentity);
    } catch {
        throw new StageControlError(
            'livekit_failed',
            502,
            'LiveKit participant state is unavailable; no grant was changed',
        );
    }
    if (!connected) {
        throw new StageControlError(
            'participant_not_connected',
            409,
            'This participant is not connected. Wait for them to rejoin before giving the floor.',
        );
    }
}

/**
 * Lock the ScheduledSession row before reading or changing grants. PostgreSQL
 * holds this lock until the surrounding transaction ends, making the count and
 * reservation one serialized operation across every app process.
 */
function hasActiveGrant(participant: ParticipantSnapshot): boolean {
    return participant.publishGrantedAt !== null &&
        participant.publishRevokedAt === null;
}

function queuePosition(
    target: ParticipantSnapshot,
    participants: ParticipantSnapshot[],
): number {
    const waiting = participants
        .filter((participant) =>
            participant.raisedAt !== null && !hasActiveGrant(participant))
        .sort((left, right) => {
            const timeDifference =
                left.raisedAt!.getTime() - right.raisedAt!.getTime();
            return timeDifference || left.id.localeCompare(right.id);
        });
    const index = waiting.findIndex((participant) => participant.id === target.id);
    return index === -1 ? waiting.length + 1 : index + 1;
}

async function audit(
    transaction: Prisma.TransactionClient,
    actorUserId: string | null,
    action: string,
    participantId: string,
    reason: string | undefined,
    metadata?: Record<string, string | number | boolean | null>,
): Promise<void> {
    await transaction.auditLog.create({
        data: {
            actorUserId,
            action,
            targetType: 'SESSION_PARTICIPANT',
            targetId: participantId,
            reason: reason?.trim() || null,
            metadata,
        },
    });
}

export async function promoteParticipant(
    input: GrantInput,
): Promise<StageGrantResult> {
    // Updating permissions for a disconnected LiveKit identity always fails.
    // Reject before reserving a durable slot so a stale hand cannot create a
    // false reconciliation incident or occupy the stage after a long absence.
    await requireConnectedParticipant(input);
    const now = input.now ?? new Date();
    const reservation = await prisma.$transaction(async (transaction) => {
        await lockGrantSession(transaction, input.scheduledSessionId);
        const scheduledSession = await transaction.scheduledSession.findUnique({
            where: { id: input.scheduledSessionId },
            select: {
                id: true,
                roomName: true,
                maxPublishers: true,
                facilitatorId: true,
            },
        });
        if (!scheduledSession) {
            throw new StageControlError(
                'session_not_found',
                404,
                'Session not found',
            );
        }

        const targetKeys = await transaction.sessionParticipant.findFirst({
            where: {
                id: input.participantId,
                scheduledSessionId: input.scheduledSessionId,
            },
            select: { id: true, ticketEntitlementId: true, staffUserId: true },
        });
        if (!targetKeys) {
            throw new StageControlError('participant_not_found', 404, 'Participant not found');
        }
        await lockGrantTickets(
            transaction,
            targetKeys.ticketEntitlementId ? [targetKeys.ticketEntitlementId] : [],
        );
        await lockGrantStaff(
            transaction,
            targetKeys.staffUserId ? [targetKeys.staffUserId] : [],
        );
        await lockGrantParticipants(transaction, [targetKeys.id]);

        // Authorization is deliberately reread only after the complete lock
        // scope is held; the earlier lookup supplied immutable lock keys only.
        const participants = await transaction.sessionParticipant.findMany({
            where: { scheduledSessionId: input.scheduledSessionId },
            select: {
                id: true,
                participantIdentity: true,
                publishGrantedAt: true,
                publishRevokedAt: true,
                raisedAt: true,
                staffUserId: true,
                staffUser: { select: { role: true, disabledAt: true } },
                ticketEntitlementId: true,
                ticketEntitlement: {
                    select: {
                        state: true,
                        revokedAt: true,
                        expiresAt: true,
                        commerceEntitlement: {
                            select: {
                                providerState: true,
                                administrativeState: true,
                            },
                        },
                    },
                },
            },
        });
        const target = participants.find(
            (participant) => participant.id === input.participantId,
        );
        if (!target) {
            throw new StageControlError(
                'participant_not_found',
                404,
                'Participant not found',
            );
        }

        const ticket = target.ticketEntitlement;
        const hasActiveEntitlement = target.ticketEntitlementId !== null &&
            target.ticketEntitlementId !== undefined &&
            ticket !== null &&
            ticket !== undefined &&
            ticket.state === 'BOUND' &&
            ticket.revokedAt === null &&
            ticket.expiresAt > now &&
            (ticket.commerceEntitlement === null || (
                ticket.commerceEntitlement.providerState === 'ACTIVE' &&
                ticket.commerceEntitlement.administrativeState === 'CLEAR'
            ));
        const isAuthorizedStaff = target.staffUserId !== null &&
            target.staffUserId !== undefined &&
            target.staffUser !== null &&
            target.staffUser !== undefined &&
            target.staffUser.disabledAt === null &&
            eventStaffPolicy(
                target.staffUser.role,
                target.staffUserId === scheduledSession.facilitatorId,
            ).canOperateEvent;
        if (!hasActiveEntitlement && !isAuthorizedStaff) {
            throw new StageControlError(
                'entitlement_inactive',
                409,
                'This attendee no longer has active event access',
            );
        }

        if (
            !hasActiveGrant(target) &&
            target.staffUserId !== scheduledSession.facilitatorId
        ) {
            // Julián owns one slot even before preflight creates his participant
            // row. Excluding his row here avoids counting that reserved slot
            // twice once he has joined.
            const activeNonFacilitators = participants.filter(
                (participant) =>
                    participant.staffUserId !== scheduledSession.facilitatorId &&
                    hasActiveGrant(participant),
            ).length;
            const occupiedPublishers = 1 + activeNonFacilitators;
            if (occupiedPublishers >= scheduledSession.maxPublishers) {
                throw new StageControlError(
                    'stage_full',
                    409,
                    'The stage is full',
                    { queuePosition: queuePosition(target, participants) },
                );
            }
        }

        const participant = await transitionParticipantGrant(transaction, {
            scheduledSessionId: input.scheduledSessionId,
            participantId: target.id,
            canPublish: true,
            now,
            actorUserId: input.actorUserId,
            reason: input.reason?.trim() || 'Promoted to stage',
        });
        await audit(
            transaction,
            input.actorUserId,
            'stage.promote',
            participant.participantId,
            input.reason,
            { grantVersion: participant.grantVersion },
        );
        return participant;
    });

    const delivery = await processParticipantGrantEffects(reservation.participantId);
    if (delivery.pending > 0) {
        throw new StageControlError(
            'livekit_failed',
            502,
            'LiveKit promotion failed',
            { reconcileNeeded: true },
        );
    }
    return { ...reservation, reconcileNeeded: false };
}

export async function demoteParticipant(
    input: DemoteInput,
): Promise<StageGrantResult> {
    const now = input.now ?? new Date();
    const revocation = await prisma.$transaction(async (transaction) => {
        await lockGrantSession(transaction, input.scheduledSessionId);
        const scheduledSession = await transaction.scheduledSession.findUnique({
            where: { id: input.scheduledSessionId },
            select: { roomName: true, facilitatorId: true },
        });
        if (!scheduledSession) {
            throw new StageControlError(
                'session_not_found',
                404,
                'Session not found',
            );
        }
        const target = await transaction.sessionParticipant.findFirst({
            where: {
                id: input.participantId,
                scheduledSessionId: input.scheduledSessionId,
            },
            select: {
                id: true,
                participantIdentity: true,
                staffUserId: true,
                staffUser: { select: { disabledAt: true } },
            },
        });
        if (!target) {
            throw new StageControlError(
                'participant_not_found',
                404,
                'Participant not found',
            );
        }
        if (
            target.staffUserId === scheduledSession.facilitatorId &&
            target.staffUser?.disabledAt === null
        ) {
            throw new StageControlError(
                'facilitator_required',
                409,
                'The assigned facilitator holds the reserved stage slot and cannot be demoted',
            );
        }
        const participant = await transitionParticipantGrant(transaction, {
            scheduledSessionId: input.scheduledSessionId,
            participantId: target.id,
            canPublish: false,
            now,
            actorUserId: input.actorUserId,
            reason: input.reason?.trim() || 'Demoted from stage',
            clearHand: input.clearHand,
        });
        await audit(
            transaction,
            input.actorUserId,
            input.auditAction ?? 'stage.demote',
            participant.participantId,
            input.reason,
            { grantVersion: participant.grantVersion },
        );
        return participant;
    });

    const delivery = await processParticipantGrantEffects(revocation.participantId);
    if (delivery.pending > 0) {
        throw new StageControlError(
            'livekit_failed',
            502,
            'LiveKit demotion failed',
            { reconcileNeeded: true },
        );
    }
    return { ...revocation, reconcileNeeded: false };
}

/**
 * Let an entitled attendee refuse a stage invitation for their own opaque
 * event identity. The caller is resolved by the room entitlement route; this
 * lookup deliberately accepts ticket-backed rows only and never a participant
 * id supplied by the browser.
 */
export async function declineStageInvitation(
    input: DeclineInvitationInput,
): Promise<StageGrantResult> {
    const participant = await prisma.sessionParticipant.findFirst({
        where: {
            scheduledSessionId: input.scheduledSessionId,
            participantIdentity: input.participantIdentity,
            ticketEntitlementId: { not: null },
        },
        select: { id: true },
    });
    if (!participant) {
        throw new StageControlError(
            'participant_not_found',
            404,
            'Participant not found',
        );
    }

    return demoteParticipant({
        scheduledSessionId: input.scheduledSessionId,
        participantId: participant.id,
        actorUserId: null,
        reason: 'Attendee declined stage invitation',
        auditAction: 'stage.invitation.decline',
        clearHand: true,
        now: input.now,
    });
}

export async function muteParticipantTrack(
    input: MuteInput,
): Promise<TrackMuteResult> {
    if (!input.muted) {
        throw new StageControlError(
            'invalid_request',
            400,
            'Staff may mute participant media, but the participant must re-enable it',
        );
    }
    if (!input.trackSid.trim()) {
        throw new StageControlError(
            'invalid_request',
            400,
            'A track SID is required',
        );
    }
    const participant = await prisma.sessionParticipant.findFirst({
        where: {
            id: input.participantId,
            scheduledSessionId: input.scheduledSessionId,
            ...ACTIVE_GRANT,
        },
        select: {
            id: true,
            participantIdentity: true,
            scheduledSession: { select: { roomName: true } },
        },
    });
    if (!participant) {
        throw new StageControlError(
            'not_publisher',
            409,
            'Participant does not have an active publish grant',
        );
    }

    try {
        await getRoomService().mutePublishedTrack(
            participant.scheduledSession.roomName,
            participant.participantIdentity,
            input.trackSid,
            true,
        );
    } catch {
        throw new StageControlError(
            'livekit_failed',
            502,
            'LiveKit track mute failed',
        );
    }

    await prisma.auditLog.create({
        data: {
            actorUserId: input.actorUserId,
            action: 'stage.mute',
            targetType: 'SESSION_PARTICIPANT',
            targetId: participant.id,
            metadata: { trackSid: input.trackSid },
        },
    });
    return {
        participantId: participant.id,
        trackSid: input.trackSid,
        muted: true,
    };
}

export async function reconcileParticipants(input: {
    scheduledSessionId: string;
    actorUserId: string;
    participantId?: string;
}): Promise<ReconcileResult> {
    const participantIds = await prisma.$transaction(async (transaction) => {
        await lockGrantSession(transaction, input.scheduledSessionId);
        const scheduledSession = await transaction.scheduledSession.findUnique({
            where: { id: input.scheduledSessionId },
            select: { id: true },
        });
        if (!scheduledSession) {
            throw new StageControlError(
                'session_not_found',
                404,
                'Session not found',
            );
        }
        await transaction.$queryRaw(Prisma.sql`
            SELECT "id"
            FROM "session_participants"
            WHERE "scheduled_session_id"::text = ${input.scheduledSessionId}
              AND (${input.participantId ?? null}::text IS NULL OR "id"::text = ${input.participantId ?? null})
            ORDER BY "id"
            FOR UPDATE
        `);
        const participants = await transaction.sessionParticipant.findMany({
            where: {
                scheduledSessionId: input.scheduledSessionId,
                ...(input.participantId ? { id: input.participantId } : {}),
            },
            select: {
                id: true,
                publishGrantedAt: true,
                publishRevokedAt: true,
            },
        });
        if (input.participantId && participants.length === 0) {
            throw new StageControlError(
                'participant_not_found',
                404,
                'Participant not found',
            );
        }
        return participants.map((participant) => participant.id);
    });

    const reconciled: string[] = [];
    const failed: string[] = [];
    for (const participantId of participantIds) {
        const delivery = await processParticipantGrantEffects(participantId);
        if (delivery.pending === 0) {
            reconciled.push(participantId);
        } else {
            failed.push(participantId);
        }
    }

    await prisma.auditLog.create({
        data: {
            actorUserId: input.actorUserId,
            action: 'stage.reconcile',
            targetType: 'SCHEDULED_SESSION',
            targetId: input.scheduledSessionId,
            metadata: {
                reconciled: reconciled.length,
                failed: failed.length,
            },
        },
    });
    return { reconciled, failed };
}
