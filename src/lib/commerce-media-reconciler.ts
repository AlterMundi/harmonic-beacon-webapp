import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';
import { getRoomService } from '@/lib/livekit-server';
import { withTimeout } from '@/lib/with-timeout';

const BED_ROOM_NAME = process.env.LIVEKIT_ROOM_NAME || 'beacon';
const RETRY_SECONDS = 10;
const CLAIM_TIMEOUT_SECONDS = 60;
const LIVEKIT_TIMEOUT_MS = 5_000;

type ClaimedJob = {
    id: string;
    commerceEntitlementId: string;
    provisionRevision: number;
    stageRoomName: string;
    participantIdentity: string;
    bedIdentity: string;
    tokenHorizonAt: Date;
};

async function claim(now: Date): Promise<ClaimedJob | null> {
    return prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id"
            FROM "commerce_media_outbox"
            WHERE (
                ("status" = 'PENDING' AND "next_attempt_at" <= ${now})
                OR
                ("status" = 'PROCESSING' AND "last_attempt_at" < ${new Date(now.getTime() - CLAIM_TIMEOUT_SECONDS * 1000)})
            )
            ORDER BY "next_attempt_at" ASC, "created_at" ASC
            FOR UPDATE SKIP LOCKED
            LIMIT 1
        `);
        if (!rows[0]) return null;
        return tx.commerceMediaOutbox.update({
            where: { id: rows[0].id },
            data: {
                status: 'PROCESSING',
                attempts: { increment: 1 },
                lastAttemptAt: now,
                lastErrorCode: null,
            },
            select: {
                id: true,
                commerceEntitlementId: true,
                provisionRevision: true,
                stageRoomName: true,
                participantIdentity: true,
                bedIdentity: true,
                tokenHorizonAt: true,
            },
        });
    });
}

async function removeIfPresent(
    room: string,
    identity: string,
): Promise<{ removed: number; absent: boolean }> {
    const roomService = getRoomService();
    const before = await withTimeout(
        roomService.listParticipants(room),
        LIVEKIT_TIMEOUT_MS,
        'Commerce LiveKit participant listing',
    );
    const present = before.some((participant) => participant.identity === identity);
    if (present) {
        await withTimeout(
            roomService.removeParticipant(room, identity),
            LIVEKIT_TIMEOUT_MS,
            'Commerce LiveKit participant removal',
        );
    }
    const after = await withTimeout(
        roomService.listParticipants(room),
        LIVEKIT_TIMEOUT_MS,
        'Commerce LiveKit participant verification',
    );
    return {
        removed: present ? 1 : 0,
        absent: !after.some((participant) => participant.identity === identity),
    };
}

export async function processNextCommerceMediaJob(now = new Date()): Promise<boolean> {
    const job = await claim(now);
    if (!job) return false;

    try {
        const [stage, bed] = await Promise.all([
            removeIfPresent(job.stageRoomName, job.participantIdentity),
            removeIfPresent(BED_ROOM_NAME, job.bedIdentity),
        ]);
        const horizonPassed = now >= job.tokenHorizonAt;
        const complete = horizonPassed && stage.absent && bed.absent;
        await prisma.$transaction(async (tx) => {
            await tx.commerceMediaOutbox.update({
                where: { id: job.id },
                data: complete ? {
                    status: 'COMPLETED',
                    completedAt: now,
                    nextAttemptAt: now,
                    stageRemoved: { increment: stage.removed },
                    bedRemoved: { increment: bed.removed },
                } : {
                    status: 'PENDING',
                    nextAttemptAt: new Date(now.getTime() + RETRY_SECONDS * 1000),
                    stageRemoved: { increment: stage.removed },
                    bedRemoved: { increment: bed.removed },
                },
            });
            const remaining = complete
                ? await tx.commerceMediaOutbox.count({
                    where: {
                        commerceEntitlementId: job.commerceEntitlementId,
                        id: { not: job.id },
                        status: { not: 'COMPLETED' },
                    },
                })
                : 1;
            // A newer provider command may supersede this job while it still
            // removes an old, versioned identity. Never let that historical
            // work overwrite the current revision's reconciliation snapshot.
            await tx.commerceEntitlement.updateMany({
                where: {
                    id: job.commerceEntitlementId,
                    provisionRevision: job.provisionRevision,
                },
                data: {
                    mediaStatus: complete && remaining === 0
                        ? 'DISCONNECTED'
                        : 'RECONCILIATION_REQUIRED',
                },
            });
        });
    } catch {
        await prisma.$transaction([
            prisma.commerceMediaOutbox.update({
                where: { id: job.id },
                data: {
                    status: 'PENDING',
                    lastErrorCode: 'LIVEKIT_UNAVAILABLE',
                    nextAttemptAt: new Date(now.getTime() + RETRY_SECONDS * 1000),
                },
            }),
            prisma.commerceEntitlement.updateMany({
                where: {
                    id: job.commerceEntitlementId,
                    provisionRevision: job.provisionRevision,
                },
                data: { mediaStatus: 'RECONCILIATION_REQUIRED' },
            }),
        ]);
    }
    return true;
}
