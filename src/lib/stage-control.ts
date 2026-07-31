import { Prisma } from '@prisma/client';
import { TrackSource } from 'livekit-server-sdk';

import { prisma } from '@/lib/db';
import { getRoomService } from '@/lib/livekit-server';

const ACTIVE_GRANT = {
    publishGrantedAt: { not: null },
    publishRevokedAt: null,
} as const;

const PUBLISH_PERMISSION = {
    canPublish: true,
    canPublishData: false,
    canSubscribe: true,
    canPublishSources: [TrackSource.MICROPHONE, TrackSource.CAMERA],
};

const SUBSCRIBE_PERMISSION = {
    canPublish: false,
    canPublishData: false,
    canSubscribe: true,
    canPublishSources: [] as TrackSource[],
};

type StageAction = 'promote' | 'demote' | 'mute' | 'reconcile';

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
async function lockScheduledSession(
    transaction: Prisma.TransactionClient,
    scheduledSessionId: string,
): Promise<void> {
    await transaction.$queryRaw(
        Prisma.sql`
            SELECT "id"
            FROM "scheduled_sessions"
            WHERE "id"::text = ${scheduledSessionId}
            FOR UPDATE
        `,
    );
}

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
    actorUserId: string,
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

async function setLiveKitPermission(
    roomName: string,
    participantIdentity: string,
    canPublish: boolean,
): Promise<void> {
    await getRoomService().updateParticipant(
        roomName,
        participantIdentity,
        {
            permission: canPublish
                ? { ...PUBLISH_PERMISSION }
                : { ...SUBSCRIBE_PERMISSION },
        },
    );
}

async function forceMuteParticipant(
    roomName: string,
    participantIdentity: string,
): Promise<void> {
    const roomService = getRoomService();
    const participant = await roomService.getParticipant(
        roomName,
        participantIdentity,
    );
    await Promise.all(
        participant.tracks
            .filter((track) => Boolean(track.sid))
            .map((track) =>
                roomService.mutePublishedTrack(
                    roomName,
                    participantIdentity,
                    track.sid,
                    true,
                )),
    );
}

async function enforceSubscriber(
    roomName: string,
    participantIdentity: string,
): Promise<void> {
    await setLiveKitPermission(roomName, participantIdentity, false);
    await forceMuteParticipant(roomName, participantIdentity);
}

async function markReconcileNeeded(
    scheduledSessionId: string,
    participantId: string,
    actorUserId: string,
    action: StageAction,
    now: Date,
): Promise<StageGrantResult> {
    return prisma.$transaction(async (transaction) => {
        await lockScheduledSession(transaction, scheduledSessionId);
        const participant = await transaction.sessionParticipant.update({
            where: { id: participantId },
            data: {
                publishRevokedAt: now,
                grantReconcileNeeded: true,
                grantVersion: { increment: 1 },
            },
            select: {
                id: true,
                participantIdentity: true,
                grantVersion: true,
            },
        });
        await audit(
            transaction,
            actorUserId,
            `stage.${action}.livekit_failed`,
            participantId,
            'LiveKit update failed; durable grant revoked',
            { reconcileNeeded: true },
        );
        return {
            participantId: participant.id,
            participantIdentity: participant.participantIdentity,
            canPublish: false,
            reconcileNeeded: true,
            grantVersion: participant.grantVersion,
        };
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
        await lockScheduledSession(transaction, input.scheduledSessionId);
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

        const participants = await transaction.sessionParticipant.findMany({
            where: { scheduledSessionId: input.scheduledSessionId },
            select: {
                id: true,
                participantIdentity: true,
                publishGrantedAt: true,
                publishRevokedAt: true,
                raisedAt: true,
                staffUserId: true,
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

        const participant = await transaction.sessionParticipant.update({
            where: { id: target.id },
            data: {
                publishGrantedAt: hasActiveGrant(target)
                    ? target.publishGrantedAt
                    : now,
                publishRevokedAt: null,
                grantReconcileNeeded: false,
                grantChangedByUserId: input.actorUserId,
                grantReason: input.reason?.trim() || 'Promoted to stage',
                grantVersion: { increment: 1 },
            },
            select: {
                id: true,
                participantIdentity: true,
                grantVersion: true,
            },
        });
        await audit(
            transaction,
            input.actorUserId,
            'stage.promote',
            participant.id,
            input.reason,
            { grantVersion: participant.grantVersion },
        );
        return {
            ...participant,
            roomName: scheduledSession.roomName,
        };
    });

    try {
        await setLiveKitPermission(
            reservation.roomName,
            reservation.participantIdentity,
            true,
        );
        return {
            participantId: reservation.id,
            participantIdentity: reservation.participantIdentity,
            canPublish: true,
            reconcileNeeded: false,
            grantVersion: reservation.grantVersion,
        };
    } catch {
        const compensated = await markReconcileNeeded(
            input.scheduledSessionId,
            input.participantId,
            input.actorUserId,
            'promote',
            now,
        );
        try {
            await enforceSubscriber(
                reservation.roomName,
                reservation.participantIdentity,
            );
        } catch {
            // The durable state is already safe. Reconcile retries both the
            // negative permission update and forced track mute.
        }
        throw new StageControlError(
            'livekit_failed',
            502,
            'LiveKit promotion failed',
            { reconcileNeeded: compensated.reconcileNeeded },
        );
    }
}

export async function demoteParticipant(
    input: GrantInput,
): Promise<StageGrantResult> {
    const now = input.now ?? new Date();
    const revocation = await prisma.$transaction(async (transaction) => {
        await lockScheduledSession(transaction, input.scheduledSessionId);
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
            select: { id: true, participantIdentity: true, staffUserId: true },
        });
        if (!target) {
            throw new StageControlError(
                'participant_not_found',
                404,
                'Participant not found',
            );
        }
        if (target.staffUserId === scheduledSession.facilitatorId) {
            throw new StageControlError(
                'facilitator_required',
                409,
                'The assigned facilitator holds the reserved stage slot and cannot be demoted',
            );
        }
        const participant = await transaction.sessionParticipant.update({
            where: { id: target.id },
            data: {
                publishRevokedAt: now,
                grantReconcileNeeded: false,
                grantChangedByUserId: input.actorUserId,
                grantReason: input.reason?.trim() || 'Demoted from stage',
                grantVersion: { increment: 1 },
            },
            select: {
                id: true,
                participantIdentity: true,
                grantVersion: true,
            },
        });
        await audit(
            transaction,
            input.actorUserId,
            'stage.demote',
            participant.id,
            input.reason,
            { grantVersion: participant.grantVersion },
        );
        return {
            ...participant,
            roomName: scheduledSession.roomName,
        };
    });

    try {
        await enforceSubscriber(
            revocation.roomName,
            revocation.participantIdentity,
        );
        return {
            participantId: revocation.id,
            participantIdentity: revocation.participantIdentity,
            canPublish: false,
            reconcileNeeded: false,
            grantVersion: revocation.grantVersion,
        };
    } catch {
        await prisma.$transaction(async (transaction) => {
            await lockScheduledSession(transaction, input.scheduledSessionId);
            await transaction.sessionParticipant.update({
                where: { id: input.participantId },
                data: { grantReconcileNeeded: true },
            });
            await audit(
                transaction,
                input.actorUserId,
                'stage.demote.livekit_failed',
                input.participantId,
                'LiveKit demotion or forced mute failed',
                { reconcileNeeded: true },
            );
        });
        throw new StageControlError(
            'livekit_failed',
            502,
            'LiveKit demotion failed',
            { reconcileNeeded: true },
        );
    }
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
    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id: input.scheduledSessionId },
        select: {
            roomName: true,
            participants: {
                where: input.participantId ? { id: input.participantId } : {},
                select: {
                    id: true,
                    participantIdentity: true,
                    publishGrantedAt: true,
                    publishRevokedAt: true,
                },
            },
        },
    });
    if (!scheduledSession) {
        throw new StageControlError(
            'session_not_found',
            404,
            'Session not found',
        );
    }
    if (input.participantId && scheduledSession.participants.length === 0) {
        throw new StageControlError(
            'participant_not_found',
            404,
            'Participant not found',
        );
    }

    const reconciled: string[] = [];
    const failed: string[] = [];
    let connectedIdentities: Set<string>;
    try {
        connectedIdentities = new Set(
            (await getRoomService().listParticipants(scheduledSession.roomName))
                .map((participant) => participant.identity),
        );
    } catch {
        connectedIdentities = new Set();
        failed.push(
            ...scheduledSession.participants.map((participant) => participant.id),
        );
    }
    for (const participant of scheduledSession.participants) {
        if (failed.includes(participant.id)) {
            await prisma.sessionParticipant.update({
                where: { id: participant.id },
                data: { grantReconcileNeeded: true },
            });
            continue;
        }
        // A disconnected identity has no live permission or tracks to disagree
        // with the database. Its next token is minted from the durable grant.
        if (!connectedIdentities.has(participant.participantIdentity)) {
            await prisma.sessionParticipant.update({
                where: { id: participant.id },
                data: { grantReconcileNeeded: false },
            });
            reconciled.push(participant.id);
            continue;
        }
        const canPublish = hasActiveGrant({
            ...participant,
            raisedAt: null,
        });
        try {
            if (canPublish) {
                await setLiveKitPermission(
                    scheduledSession.roomName,
                    participant.participantIdentity,
                    true,
                );
            } else {
                await enforceSubscriber(
                    scheduledSession.roomName,
                    participant.participantIdentity,
                );
            }
            await prisma.sessionParticipant.update({
                where: { id: participant.id },
                data: { grantReconcileNeeded: false },
            });
            reconciled.push(participant.id);
        } catch {
            await prisma.sessionParticipant.update({
                where: { id: participant.id },
                data: { grantReconcileNeeded: true },
            });
            failed.push(participant.id);
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
