import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';
import { TrackSource } from 'livekit-server-sdk';

import { prisma } from '@/lib/db';
import { bedRoomIdentity, getRoomService } from '@/lib/livekit-server';
import { withTimeout } from '@/lib/with-timeout';

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
            scheduledSession: { select: { roomName: true } },
        },
    });
    if (!current) throw new ParticipantGrantNotFoundError();

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
        },
        select: {
            id: true,
            participantIdentity: true,
            grantVersion: true,
        },
    });
    const disconnectParticipant = input.disconnectParticipant === true;
    const bedRoomName = disconnectParticipant
        ? process.env.LIVEKIT_ROOM_NAME || 'beacon'
        : null;
    await tx.stageGrantEffectOutbox.create({
        data: {
            scheduledSessionId: input.scheduledSessionId,
            participantId: participant.id,
            grantVersion: participant.grantVersion,
            roomName: current.scheduledSession.roomName,
            participantIdentity: participant.participantIdentity,
            canPublish: input.canPublish,
            disconnectParticipant,
            bedRoomName,
            bedIdentity: disconnectParticipant
                ? bedRoomIdentity(participant.participantIdentity)
                : null,
            tokenHorizonAt: disconnectParticipant
                ? input.tokenHorizonAt ?? new Date(input.now.getTime() + 5 * 60_000)
                : null,
            nextAttemptAt: input.now,
        },
    });
    return {
        participantId: participant.id,
        participantIdentity: participant.participantIdentity,
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
    canPublish: boolean;
    disconnectParticipant: boolean;
    bedRoomName: string | null;
    bedIdentity: string | null;
    tokenHorizonAt: Date | null;
    claimToken: string;
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
                  AND older."status" <> 'COMPLETED'
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
                canPublish: true,
                disconnectParticipant: true,
                bedRoomName: true,
                bedIdentity: true,
                tokenHorizonAt: true,
                claimToken: true,
            },
        });
        return { ...claimed, claimToken };
    });
}

async function listPresence(roomName: string, participantIdentity: string): Promise<boolean> {
    const participants = await withTimeout(
        getRoomService().listParticipants(roomName),
        LIVEKIT_TIMEOUT_MS,
        'Stage grant participant listing',
    );
    return participants.some((participant) => participant.identity === participantIdentity);
}

async function applyPermission(job: ClaimedGrantEffect): Promise<boolean> {
    try {
        await withTimeout(
            getRoomService().updateParticipant(job.roomName, job.participantIdentity, {
                permission: job.canPublish
                    ? { ...PUBLISH_PERMISSION }
                    : { ...SUBSCRIBE_PERMISSION },
            }),
            LIVEKIT_TIMEOUT_MS,
            'Stage grant permission update',
        );
        return true;
    } catch {
        return false;
    }
}

async function muteEveryTrack(job: ClaimedGrantEffect): Promise<boolean> {
    try {
        const participant = await withTimeout(
            getRoomService().getParticipant(job.roomName, job.participantIdentity),
            LIVEKIT_TIMEOUT_MS,
            'Stage grant participant read',
        );
        const results = await Promise.allSettled(
            participant.tracks
                .filter((track) => Boolean(track.sid))
                .map((track) => withTimeout(
                    getRoomService().mutePublishedTrack(
                        job.roomName,
                        job.participantIdentity,
                        track.sid,
                        true,
                    ),
                    LIVEKIT_TIMEOUT_MS,
                    'Stage grant track mute',
                )),
        );
        return results.every((result) => result.status === 'fulfilled');
    } catch {
        return false;
    }
}

async function removeIfPresent(roomName: string, identity: string): Promise<boolean> {
    const roomService = getRoomService();
    const present = await listPresence(roomName, identity);
    if (present) {
        await withTimeout(
            roomService.removeParticipant(roomName, identity),
            LIVEKIT_TIMEOUT_MS,
            'Stage grant participant removal',
        );
    }
    return !(await listPresence(roomName, identity));
}

async function applyGrantEffect(job: ClaimedGrantEffect, now: Date): Promise<boolean> {
    let stagePresent: boolean;
    try {
        stagePresent = await listPresence(job.roomName, job.participantIdentity);
    } catch {
        return false;
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

    if (!job.disconnectParticipant) return grantApplied;
    if (!job.bedRoomName || !job.bedIdentity || !job.tokenHorizonAt) return false;
    const [stageRemoved, bedRemoved] = await Promise.allSettled([
        removeIfPresent(job.roomName, job.participantIdentity),
        removeIfPresent(job.bedRoomName, job.bedIdentity),
    ]);
    const disconnected = stageRemoved.status === 'fulfilled' && stageRemoved.value &&
        bedRemoved.status === 'fulfilled' && bedRemoved.value;
    return grantApplied && disconnected && now >= job.tokenHorizonAt;
}

async function finishGrantEffect(
    job: ClaimedGrantEffect,
    complete: boolean,
    now: Date,
): Promise<void> {
    await prisma.$transaction(async (tx) => {
        const updated = await tx.stageGrantEffectOutbox.updateMany({
            where: {
                id: job.id,
                status: 'PROCESSING',
                claimToken: job.claimToken,
            },
            data: complete ? {
                status: 'COMPLETED',
                completedAt: now,
                claimToken: null,
                leaseExpiresAt: null,
                nextAttemptAt: now,
            } : {
                status: 'PENDING',
                claimToken: null,
                leaseExpiresAt: null,
                nextAttemptAt: new Date(now.getTime() + RETRY_MS),
                lastErrorCode: 'LIVEKIT_EFFECT_INCOMPLETE',
            },
        });
        if (updated.count !== 1 || !complete) return;
        const remaining = await tx.stageGrantEffectOutbox.count({
            where: {
                participantId: job.participantId,
                status: { not: 'COMPLETED' },
            },
        });
        if (remaining !== 0) return;
        await tx.sessionParticipant.updateMany({
            where: {
                id: job.participantId,
                grantVersion: job.grantVersion,
            },
            data: { grantReconcileNeeded: false },
        });
    });
}

export async function processNextStageGrantEffect(
    now = new Date(),
    participantId?: string,
): Promise<boolean> {
    const job = await claimGrantEffect(now, participantId);
    if (!job) return false;
    const complete = await applyGrantEffect(job, now);
    await finishGrantEffect(job, complete, now);
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
        where: { participantId, status: { not: 'COMPLETED' } },
    });
    return { processed, pending };
}
