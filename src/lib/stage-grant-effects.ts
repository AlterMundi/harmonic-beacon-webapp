import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { TrackSource } from 'livekit-server-sdk';

import { prisma } from '@/lib/db';
import {
    bedRoomIdentity,
    getRoomService,
    rotatedRoomIdentity,
} from '@/lib/livekit-server';
import { lockGrantParticipants, lockGrantSession } from '@/lib/stage-grant-locks';

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

const CLAIM_LEASE_MS = 60_000;
const LIVEKIT_TIMEOUT_MS = 5_000;
const RETRY_MS = 10_000;
const MAX_INLINE_JOBS = 32;

export class ParticipantGrantNotFoundError extends Error {
    constructor() {
        super('Participant not found');
        this.name = 'ParticipantGrantNotFoundError';
    }
}

export type ParticipantGrantTransition = {
    participantId: string;
    participantIdentity: string;
    resultingParticipantIdentity: string;
    roomName: string;
    canPublish: boolean;
    grantVersion: number;
    reconcileNeeded: true;
};

export type TransitionParticipantGrantInput = {
    scheduledSessionId: string;
    participantId: string;
    canPublish: boolean;
    now: Date;
    actorUserId: string | null;
    reason: string;
    clearHand?: boolean;
    markLeft?: boolean;
    disconnectParticipant?: boolean;
    tokenHorizonAt?: Date | null;
};

/**
 * The only supported writer for a participant's durable publication intent.
 * The participant revision and its exact LiveKit effect are committed together.
 */
export async function transitionParticipantGrant(
    tx: Prisma.TransactionClient,
    input: TransitionParticipantGrantInput,
): Promise<ParticipantGrantTransition> {
    await tx.$queryRaw(
        Prisma.sql`
            SELECT "id"
            FROM "session_participants"
            WHERE "id"::text = ${input.participantId}
              AND "scheduled_session_id"::text = ${input.scheduledSessionId}
            FOR UPDATE
        `,
    );
    const current = await tx.sessionParticipant.findFirst({
        where: {
            id: input.participantId,
            scheduledSessionId: input.scheduledSessionId,
        },
        select: {
            id: true,
            participantIdentity: true,
            publishGrantedAt: true,
            grantVersion: true,
            maxLivekitTokenExpiresAt: true,
            scheduledSession: { select: { roomName: true } },
        },
    });
    if (!current) throw new ParticipantGrantNotFoundError();

    const nextGrantVersion = current.grantVersion + 1;
    const targetIdentity = current.participantIdentity;
    const resultingParticipantIdentity = input.canPublish
        ? targetIdentity
        : rotatedRoomIdentity(
            input.scheduledSessionId,
            current.id,
            nextGrantVersion,
        );
    const participant = await tx.sessionParticipant.update({
        where: { id: current.id },
        data: {
            publishGrantedAt: input.canPublish
                ? current.publishGrantedAt ?? input.now
                : current.publishGrantedAt,
            publishRevokedAt: input.canPublish ? null : input.now,
            ...(input.clearHand ? { raisedAt: null } : {}),
            ...(input.markLeft ? { leftAt: input.now } : {}),
            grantReconcileNeeded: true,
            grantChangedByUserId: input.actorUserId,
            grantReason: input.reason,
            grantVersion: { increment: 1 },
            participantIdentity: resultingParticipantIdentity,
            ...(!input.canPublish ? { maxLivekitTokenExpiresAt: null } : {}),
        },
        select: {
            id: true,
            participantIdentity: true,
            grantVersion: true,
        },
    });
    // Every revocation fences the previous identity. This is what makes old
    // editor JWTs and late permission RPCs harmless while the attendee can
    // immediately reconnect under resultingParticipantIdentity.
    const disconnectParticipant = input.disconnectParticipant === true || !input.canPublish;
    const bedRoomName = disconnectParticipant
        ? process.env.LIVEKIT_ROOM_NAME || 'beacon'
        : null;
    await tx.stageGrantEffectOutbox.create({
        data: {
            scheduledSessionId: input.scheduledSessionId,
            participantId: participant.id,
            grantVersion: participant.grantVersion,
            roomName: current.scheduledSession.roomName,
            participantIdentity: targetIdentity,
            resultingParticipantIdentity,
            canPublish: input.canPublish,
            disconnectParticipant,
            bedRoomName,
            bedIdentity: disconnectParticipant
                ? bedRoomIdentity(targetIdentity)
                : null,
            tokenHorizonAt: disconnectParticipant
                ? [input.tokenHorizonAt, current.maxLivekitTokenExpiresAt, input.now]
                    .filter((value): value is Date => value instanceof Date)
                    .reduce((latest, value) => value > latest ? value : latest, input.now)
                : null,
            nextAttemptAt: input.now,
        },
    });
    return {
        participantId: participant.id,
        participantIdentity: participant.participantIdentity,
        resultingParticipantIdentity,
        roomName: current.scheduledSession.roomName,
        canPublish: input.canPublish,
        grantVersion: participant.grantVersion,
        reconcileNeeded: true,
    };
}

type ClaimedGrantEffect = {
    id: string;
    participantId: string;
    grantVersion: number;
    roomName: string;
    participantIdentity: string;
    resultingParticipantIdentity: string;
    canPublish: boolean;
    disconnectParticipant: boolean;
    bedRoomName: string | null;
    bedIdentity: string | null;
    tokenHorizonAt: Date | null;
    claimToken: string;
    attempts: number;
    grantAppliedAt: Date | null;
};

async function claimGrantEffect(
    now: Date,
    participantId?: string,
): Promise<ClaimedGrantEffect | null> {
    const claimToken = randomUUID();
    return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT candidate."id"
            FROM "stage_grant_effect_outbox" candidate
            WHERE (${participantId ?? null}::text IS NULL OR candidate."participant_id"::text = ${participantId ?? null})
              AND (
                (candidate."status" = 'PENDING' AND candidate."next_attempt_at" <= ${now})
                OR
                (candidate."status" = 'PROCESSING' AND candidate."lease_expires_at" <= ${now})
              )
              AND NOT EXISTS (
                SELECT 1
                FROM "stage_grant_effect_outbox" older
                WHERE older."participant_id" = candidate."participant_id"
                  AND older."grant_version" < candidate."grant_version"
                  AND older."status" <> 'SUPERSEDED'
                  AND older."grant_applied_at" IS NULL
              )
            ORDER BY candidate."next_attempt_at" ASC, candidate."created_at" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        `);
        if (!rows[0]) return null;
        const claimed = await tx.stageGrantEffectOutbox.update({
            where: { id: rows[0].id },
            data: {
                status: 'PROCESSING',
                attempts: { increment: 1 },
                claimToken,
                claimedAt: now,
                leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
                lastErrorCode: null,
            },
            select: {
                id: true,
                participantId: true,
                grantVersion: true,
                roomName: true,
                participantIdentity: true,
                resultingParticipantIdentity: true,
                canPublish: true,
                disconnectParticipant: true,
                bedRoomName: true,
                bedIdentity: true,
                tokenHorizonAt: true,
                claimToken: true,
                attempts: true,
                grantAppliedAt: true,
            },
        });
        return { ...claimed, claimToken };
    });
}

async function listPresence(roomName: string, participantIdentity: string): Promise<boolean> {
    const participants = await getRoomService(LIVEKIT_TIMEOUT_MS / 1_000)
        .listParticipants(roomName);
    return participants.some((participant) => participant.identity === participantIdentity);
}

async function applyPermission(job: ClaimedGrantEffect): Promise<boolean> {
    try {
        await getRoomService(LIVEKIT_TIMEOUT_MS / 1_000)
            .updateParticipant(job.roomName, job.participantIdentity, {
                permission: job.canPublish
                    ? { ...PUBLISH_PERMISSION }
                    : { ...SUBSCRIBE_PERMISSION },
            });
        return true;
    } catch {
        return false;
    }
}

async function muteEveryTrack(job: ClaimedGrantEffect): Promise<boolean> {
    try {
        const roomService = getRoomService(LIVEKIT_TIMEOUT_MS / 1_000);
        const participant = await roomService.getParticipant(
            job.roomName,
            job.participantIdentity,
        );
        const results = await Promise.allSettled(
            participant.tracks
                .filter((track) => Boolean(track.sid))
                .map((track) => roomService.mutePublishedTrack(
                        job.roomName,
                        job.participantIdentity,
                        track.sid,
                        true,
                    )),
        );
        return results.every((result) => result.status === 'fulfilled');
    } catch {
        return false;
    }
}

async function removeIfPresent(roomName: string, identity: string): Promise<boolean> {
    const roomService = getRoomService(LIVEKIT_TIMEOUT_MS / 1_000);
    const present = await listPresence(roomName, identity);
    if (present) {
        await roomService.removeParticipant(roomName, identity);
    }
    return !(await listPresence(roomName, identity));
}

type GrantEffectOutcome = {
    complete: boolean;
    grantApplied: boolean;
    errorCode: 'LIVEKIT_EFFECT_INCOMPLETE' | 'TOKEN_HORIZON_ACTIVE' | null;
};

async function applyGrantEffect(
    job: ClaimedGrantEffect,
    now: Date,
): Promise<GrantEffectOutcome> {
    let stagePresent: boolean;
    try {
        stagePresent = await listPresence(job.roomName, job.participantIdentity);
    } catch {
        return { complete: false, grantApplied: false, errorCode: 'LIVEKIT_EFFECT_INCOMPLETE' };
    }

    let grantApplied = !stagePresent;
    if (stagePresent) {
        if (job.canPublish) {
            grantApplied = await applyPermission(job);
        } else {
            const [permissionApplied, tracksMuted] = await Promise.all([
                applyPermission(job),
                muteEveryTrack(job),
            ]);
            grantApplied = permissionApplied && tracksMuted;
        }
    }

    if (!job.disconnectParticipant) {
        return {
            complete: grantApplied,
            grantApplied,
            errorCode: grantApplied ? null : 'LIVEKIT_EFFECT_INCOMPLETE',
        };
    }
    if (!job.bedRoomName || !job.bedIdentity || !job.tokenHorizonAt) {
        return { complete: false, grantApplied: false, errorCode: 'LIVEKIT_EFFECT_INCOMPLETE' };
    }
    const [stageRemoved, bedRemoved] = await Promise.allSettled([
        removeIfPresent(job.roomName, job.participantIdentity),
        removeIfPresent(job.bedRoomName, job.bedIdentity),
    ]);
    const disconnected = stageRemoved.status === 'fulfilled' && stageRemoved.value &&
        bedRemoved.status === 'fulfilled' && bedRemoved.value;
    const initialGrantApplied = grantApplied && disconnected;
    if (!initialGrantApplied) {
        return { complete: false, grantApplied: false, errorCode: 'LIVEKIT_EFFECT_INCOMPLETE' };
    }
    const complete = now >= job.tokenHorizonAt;
    return {
        complete,
        grantApplied: true,
        errorCode: complete ? null : 'TOKEN_HORIZON_ACTIVE',
    };
}

async function finishGrantEffect(
    job: ClaimedGrantEffect,
    outcome: GrantEffectOutcome,
    now: Date,
): Promise<void> {
    await prisma.$transaction(async (tx) => {
        const updated = await tx.stageGrantEffectOutbox.updateMany({
            where: {
                id: job.id,
                status: 'PROCESSING',
                claimToken: job.claimToken,
            },
            data: outcome.complete ? {
                status: 'COMPLETED',
                completedAt: now,
                grantAppliedAt: job.grantAppliedAt ?? (outcome.grantApplied ? now : null),
                claimToken: null,
                leaseExpiresAt: null,
                nextAttemptAt: now,
            } : {
                status: 'PENDING',
                claimToken: null,
                leaseExpiresAt: null,
                nextAttemptAt: new Date(now.getTime() + RETRY_MS),
                grantAppliedAt: job.grantAppliedAt ?? (outcome.grantApplied ? now : null),
                lastErrorCode: outcome.errorCode,
            },
        });
        if (updated.count !== 1 || (!outcome.grantApplied && !job.grantAppliedAt)) return;
        const remaining = await tx.stageGrantEffectOutbox.count({
            where: {
                participantId: job.participantId,
                status: { not: 'SUPERSEDED' },
                grantAppliedAt: null,
            },
        });
        if (remaining !== 0) return;
        await tx.sessionParticipant.updateMany({
            where: {
                id: job.participantId,
                grantVersion: job.grantVersion,
                participantIdentity: job.resultingParticipantIdentity,
            },
            data: { grantReconcileNeeded: false },
        });
    });
    if (!outcome.complete && outcome.errorCode !== 'TOKEN_HORIZON_ACTIVE') {
        console.warn(JSON.stringify({
            event: 'stage_grant_effect_retry',
            jobId: job.id,
            participantId: job.participantId,
            grantVersion: job.grantVersion,
            attempts: job.attempts,
            errorCode: outcome.errorCode,
        }));
    }
}

export async function processNextStageGrantEffect(
    now = new Date(),
    participantId?: string,
): Promise<boolean> {
    const job = await claimGrantEffect(now, participantId);
    if (!job) return false;
    const outcome = await applyGrantEffect(job, now);
    await finishGrantEffect(job, outcome, now);
    return true;
}

export async function processParticipantGrantEffects(
    participantId: string,
): Promise<{ processed: number; pending: number }> {
    let processed = 0;
    while (processed < MAX_INLINE_JOBS) {
        const didProcess = await processNextStageGrantEffect(new Date(), participantId);
        if (!didProcess) break;
        processed += 1;
    }
    const pending = await prisma.stageGrantEffectOutbox.count({
        where: {
            participantId,
            status: { not: 'SUPERSEDED' },
            grantAppliedAt: null,
        },
    });
    return { processed, pending };
}

/**
 * Compatibility fence for a forward deploy after a legacy application
 * rollback. Legacy code can mutate durable grant columns without appending an
 * outbox row. Before processing any old job, the worker detects one uncovered
 * participant, supersedes only unleased work, and appends the current desired
 * state as a fresh revision. This prevents a stale pre-rollback job from being
 * the last remote write after the forward deploy.
 */
export async function repairNextUncoveredGrantEffect(now = new Date()): Promise<boolean> {
    const candidates = await prisma.$queryRaw<Array<{
        id: string;
        scheduled_session_id: string;
    }>>(Prisma.sql`
        SELECT participant."id", participant."scheduled_session_id"
        FROM "session_participants" participant
        LEFT JOIN LATERAL (
            SELECT effect."id", effect."grant_version", effect."can_publish",
                   effect."resulting_participant_identity"
            FROM "stage_grant_effect_outbox" effect
            WHERE effect."participant_id" = participant."id"
            ORDER BY effect."grant_version" DESC
            LIMIT 1
        ) tail ON true
        WHERE (
            (tail."id" IS NULL AND participant."grant_reconcile_needed" = true)
            OR
            (tail."id" IS NOT NULL AND (
                tail."grant_version" <> participant."grant_version"
                OR tail."can_publish" <> (
                    participant."publish_granted_at" IS NOT NULL
                    AND participant."publish_revoked_at" IS NULL
                )
                OR tail."resulting_participant_identity" <> participant."participant_identity"
            ))
        )
          AND NOT EXISTS (
            SELECT 1
            FROM "stage_grant_effect_outbox" active
            WHERE active."participant_id" = participant."id"
              AND active."status" = 'PROCESSING'
              AND active."lease_expires_at" > ${now}
          )
        ORDER BY participant."updated_at" ASC, participant."id" ASC
        LIMIT 1
    `);
    const candidate = candidates[0];
    if (!candidate) return false;

    const repaired = await prisma.$transaction(async (tx) => {
        await lockGrantSession(tx, candidate.scheduled_session_id);
        await lockGrantParticipants(tx, [candidate.id]);
        const participant = await tx.sessionParticipant.findUnique({
            where: { id: candidate.id },
            select: {
                id: true,
                scheduledSessionId: true,
                participantIdentity: true,
                publishGrantedAt: true,
                publishRevokedAt: true,
                grantVersion: true,
            },
        });
        if (!participant) return null;
        const desiredCanPublish = participant.publishGrantedAt !== null &&
            participant.publishRevokedAt === null;
        const tail = await tx.stageGrantEffectOutbox.findFirst({
            where: { participantId: participant.id },
            orderBy: { grantVersion: 'desc' },
            select: {
                grantVersion: true,
                canPublish: true,
                resultingParticipantIdentity: true,
            },
        });
        if (
            tail?.grantVersion === participant.grantVersion &&
            tail.canPublish === desiredCanPublish &&
            tail.resultingParticipantIdentity === participant.participantIdentity
        ) return null;

        await tx.stageGrantEffectOutbox.updateMany({
            where: {
                participantId: participant.id,
                OR: [
                    { status: 'PENDING' },
                    { status: 'PROCESSING', leaseExpiresAt: { lte: now } },
                ],
            },
            data: {
                status: 'SUPERSEDED',
                completedAt: now,
                claimToken: null,
                leaseExpiresAt: null,
                lastErrorCode: 'SUPERSEDED_BY_FORWARD_REPAIR',
            },
        });
        return transitionParticipantGrant(tx, {
            scheduledSessionId: participant.scheduledSessionId,
            participantId: participant.id,
            canPublish: desiredCanPublish,
            now,
            actorUserId: null,
            reason: 'Forward repair after uncovered grant mutation',
        });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    if (repaired) {
        console.warn(JSON.stringify({
            event: 'stage_grant_forward_repair',
            participantId: repaired.participantId,
            grantVersion: repaired.grantVersion,
        }));
    }
    return repaired !== null;
}
