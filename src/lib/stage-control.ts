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

type ParticipantSnapshot = {
    id: string;
    participantIdentity: string;
    publishGrantedAt: Date | null;
    publishRevokedAt: Date | null;
    raisedAt: Date | null;
};

type GrantEffectSnapshot = {
    id: string;
    participantIdentity: string;
    roomName: string;
    publishGrantedAt: Date | null;
    publishRevokedAt: Date | null;
    grantVersion: number;
};

const MAX_GRANT_SYNC_PASSES = 16;

class GrantEffectApplyError extends Error {
    constructor(
        public readonly snapshot: GrantEffectSnapshot,
    ) {
        super('LiveKit grant effect failed for the current durable version');
        this.name = 'GrantEffectApplyError';
    }
}

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

type DemoteInput = Omit<GrantInput, 'actorUserId'> & {
    actorUserId: string | null;
    auditAction?: 'stage.demote' | 'stage.invitation.decline' | 'stage.attendee.leave';
    clearHand?: boolean;
};

type DeclineInvitationInput = {
    scheduledSessionId: string;
    participantIdentity: string;
    now?: Date;
};

type LeaveStageInput = DeclineInvitationInput;

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

async function readGrantEffectSnapshot(
    scheduledSessionId: string,
    participantId: string,
): Promise<GrantEffectSnapshot> {
    const participant = await prisma.sessionParticipant.findFirst({
        where: { id: participantId, scheduledSessionId },
        select: {
            id: true,
            participantIdentity: true,
            publishGrantedAt: true,
            publishRevokedAt: true,
            grantVersion: true,
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
    return {
        id: participant.id,
        participantIdentity: participant.participantIdentity,
        roomName: participant.scheduledSession.roomName,
        publishGrantedAt: participant.publishGrantedAt,
        publishRevokedAt: participant.publishRevokedAt,
        grantVersion: participant.grantVersion,
    };
}

function grantResult(
    snapshot: GrantEffectSnapshot,
    reconcileNeeded: boolean,
): StageGrantResult {
    return {
        participantId: snapshot.id,
        participantIdentity: snapshot.participantIdentity,
        canPublish: hasActiveGrant({ ...snapshot, raisedAt: null }),
        reconcileNeeded,
        grantVersion: snapshot.grantVersion,
    };
}

/**
 * Apply the newest durable grant version and clear its pending marker only
 * with a compare-by-version update. If a newer transition commits while an
 * older LiveKit request is in flight, the older caller loops and reapplies the
 * new state so an obsolete effect can never be the final effect.
 */
async function synchronizeLatestGrantEffect(
    scheduledSessionId: string,
    participantId: string,
): Promise<StageGrantResult> {
    let lastSnapshot: GrantEffectSnapshot | null = null;
    for (let pass = 0; pass < MAX_GRANT_SYNC_PASSES; pass += 1) {
        const snapshot = await readGrantEffectSnapshot(scheduledSessionId, participantId);
        lastSnapshot = snapshot;
        const canPublish = hasActiveGrant({ ...snapshot, raisedAt: null });
        try {
            if (canPublish) {
                await setLiveKitPermission(
                    snapshot.roomName,
                    snapshot.participantIdentity,
                    true,
                );
            } else {
                await enforceSubscriber(
                    snapshot.roomName,
                    snapshot.participantIdentity,
                );
            }
        } catch {
            const latest = await readGrantEffectSnapshot(scheduledSessionId, participantId);
            if (latest.grantVersion !== snapshot.grantVersion) continue;
            throw new GrantEffectApplyError(snapshot);
        }

        const cleared = await prisma.sessionParticipant.updateMany({
            where: {
                id: snapshot.id,
                scheduledSessionId,
                grantVersion: snapshot.grantVersion,
            },
            data: { grantReconcileNeeded: false },
        });
        if (cleared.count === 1) return grantResult(snapshot, false);
    }

    throw new GrantEffectApplyError(lastSnapshot ??
        await readGrantEffectSnapshot(scheduledSessionId, participantId));
}

async function clearDisconnectedGrantMarker(
    scheduledSessionId: string,
    participantId: string,
): Promise<boolean> {
    for (let pass = 0; pass < MAX_GRANT_SYNC_PASSES; pass += 1) {
        const snapshot = await readGrantEffectSnapshot(scheduledSessionId, participantId);
        const cleared = await prisma.sessionParticipant.updateMany({
            where: {
                id: snapshot.id,
                scheduledSessionId,
                grantVersion: snapshot.grantVersion,
            },
            data: { grantReconcileNeeded: false },
        });
        if (cleared.count === 1) return true;
    }
    return false;
}

async function recordGrantEffectFailureIfCurrent(input: {
    scheduledSessionId: string;
    participantId: string;
    expectedVersion: number;
    actorUserId: string | null;
    action: string;
    reason: string;
}): Promise<boolean> {
    return prisma.$transaction(async (transaction) => {
        await lockScheduledSession(transaction, input.scheduledSessionId);
        const participant = await transaction.sessionParticipant.findFirst({
            where: {
                id: input.participantId,
                scheduledSessionId: input.scheduledSessionId,
            },
            select: { grantVersion: true },
        });
        if (!participant || participant.grantVersion !== input.expectedVersion) return false;
        await transaction.sessionParticipant.update({
            where: { id: input.participantId },
            data: { grantReconcileNeeded: true },
        });
        await audit(
            transaction,
            input.actorUserId,
            `${input.action}.livekit_failed`,
            input.participantId,
            input.reason,
            { grantVersion: input.expectedVersion, reconcileNeeded: true },
        );
        return true;
    });
}

async function compensatePromotionFailureIfCurrent(input: {
    scheduledSessionId: string;
    participantId: string;
    expectedVersion: number;
    actorUserId: string;
    now: Date;
}): Promise<boolean> {
    return prisma.$transaction(async (transaction) => {
        await lockScheduledSession(transaction, input.scheduledSessionId);
        const current = await transaction.sessionParticipant.findFirst({
            where: {
                id: input.participantId,
                scheduledSessionId: input.scheduledSessionId,
            },
            select: {
                id: true,
                publishGrantedAt: true,
                publishRevokedAt: true,
                grantVersion: true,
            },
        });
        if (
            !current ||
            current.grantVersion !== input.expectedVersion ||
            !hasActiveGrant({
                ...current,
                participantIdentity: '',
                raisedAt: null,
            })
        ) {
            return false;
        }

        const compensated = await transaction.sessionParticipant.update({
            where: { id: current.id },
            data: {
                publishRevokedAt: input.now,
                grantReconcileNeeded: true,
                grantVersion: { increment: 1 },
            },
            select: { grantVersion: true },
        });
        await audit(
            transaction,
            input.actorUserId,
            'stage.promote.livekit_failed',
            current.id,
            'LiveKit promotion failed; durable grant revoked',
            {
                failedGrantVersion: input.expectedVersion,
                grantVersion: compensated.grantVersion,
                reconcileNeeded: true,
            },
        );
        return true;
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
                grantReconcileNeeded: true,
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
        return await synchronizeLatestGrantEffect(
            input.scheduledSessionId,
            input.participantId,
        );
    } catch (failure) {
        if (!(failure instanceof GrantEffectApplyError)) throw failure;
        const compensated = await compensatePromotionFailureIfCurrent({
            scheduledSessionId: input.scheduledSessionId,
            participantId: input.participantId,
            expectedVersion: reservation.grantVersion,
            actorUserId: input.actorUserId,
            now,
        });

        if (!compensated) {
            // A newer transition superseded the failed effect before its
            // compensation could commit. Converge to that version and report
            // the current truth instead of revoking it from this stale caller.
            return synchronizeLatestGrantEffect(
                input.scheduledSessionId,
                input.participantId,
            );
        }

        let reconcileNeeded = true;
        try {
            await synchronizeLatestGrantEffect(
                input.scheduledSessionId,
                input.participantId,
            );
            reconcileNeeded = false;
        } catch {
            // The compensated durable state is subscriber-only and remains
            // marked until a later reconciliation can enforce it in LiveKit.
        }
        throw new StageControlError(
            'livekit_failed',
            502,
            'LiveKit promotion failed',
            { reconcileNeeded },
        );
    }
}

export async function demoteParticipant(
    input: DemoteInput,
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
            select: {
                id: true,
                participantIdentity: true,
                staffUserId: true,
                raisedAt: true,
                publishGrantedAt: true,
                publishRevokedAt: true,
                grantVersion: true,
            },
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
        const activeGrant = target.publishGrantedAt !== null && target.publishRevokedAt === null;
        if (!activeGrant && (!input.clearHand || target.raisedAt === null)) {
            return {
                id: target.id,
                participantIdentity: target.participantIdentity,
                grantVersion: target.grantVersion,
                roomName: scheduledSession.roomName,
            };
        }

        const participant = await transaction.sessionParticipant.update({
            where: { id: target.id },
            data: {
                ...(activeGrant ? { publishRevokedAt: now } : {}),
                ...(input.clearHand ? { raisedAt: null } : {}),
                grantReconcileNeeded: true,
                grantChangedByUserId: input.actorUserId,
                grantReason: input.reason?.trim() || 'Demoted from stage',
                ...(activeGrant ? { grantVersion: { increment: 1 } } : {}),
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
            input.auditAction ?? 'stage.demote',
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
        return await synchronizeLatestGrantEffect(
            input.scheduledSessionId,
            input.participantId,
        );
    } catch (failure) {
        if (!(failure instanceof GrantEffectApplyError)) throw failure;
        const failureIsCurrent = await recordGrantEffectFailureIfCurrent({
            scheduledSessionId: input.scheduledSessionId,
            participantId: input.participantId,
            expectedVersion: failure.snapshot.grantVersion,
            actorUserId: input.actorUserId,
            action: input.auditAction ?? 'stage.demote',
            reason: 'LiveKit demotion or forced mute failed',
        });
        if (!failureIsCurrent) {
            return synchronizeLatestGrantEffect(
                input.scheduledSessionId,
                input.participantId,
            );
        }
        throw new StageControlError(
            'livekit_failed',
            502,
            'LiveKit demotion failed',
            { reconcileNeeded: true },
        );
    }
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

/**
 * Return an attendee from the stage to the audience using only their resolved
 * opaque room identity. Repeated requests and a simultaneous staff demotion
 * converge on the same revoked grant without allocating a new version.
 */
export async function leaveStage(
    input: LeaveStageInput,
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
        reason: 'Attendee voluntarily left the stage',
        auditAction: 'stage.attendee.leave',
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
    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id: input.scheduledSessionId },
        select: {
            roomName: true,
            participants: {
                where: input.participantId ? { id: input.participantId } : {},
                select: {
                    id: true,
                    participantIdentity: true,
                    grantVersion: true,
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
            await prisma.sessionParticipant.updateMany({
                where: {
                    id: participant.id,
                    scheduledSessionId: input.scheduledSessionId,
                    grantVersion: participant.grantVersion,
                },
                data: { grantReconcileNeeded: true },
            });
            continue;
        }
        // A disconnected identity has no live permission or tracks to disagree
        // with the database. Its next token is minted from the durable grant.
        if (!connectedIdentities.has(participant.participantIdentity)) {
            if (await clearDisconnectedGrantMarker(
                input.scheduledSessionId,
                participant.id,
            )) {
                reconciled.push(participant.id);
            } else {
                failed.push(participant.id);
            }
            continue;
        }
        try {
            await synchronizeLatestGrantEffect(
                input.scheduledSessionId,
                participant.id,
            );
            reconciled.push(participant.id);
        } catch (failure) {
            const snapshot = failure instanceof GrantEffectApplyError
                ? failure.snapshot
                : await readGrantEffectSnapshot(input.scheduledSessionId, participant.id);
            await prisma.sessionParticipant.updateMany({
                where: {
                    id: participant.id,
                    scheduledSessionId: input.scheduledSessionId,
                    grantVersion: snapshot.grantVersion,
                },
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
