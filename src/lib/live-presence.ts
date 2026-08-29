import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

export const LIVE_PRESENCE_HEARTBEAT_MS = 20_000;
export const LIVE_PRESENCE_GRACE_MS = 45_000;

export async function observeLivePresence(input: {
    scheduledSessionId: string;
    participantIdentity: string;
    reconnect?: boolean;
    now?: Date;
}): Promise<{ id: string; generation: number } | null> {
    const now = input.now ?? new Date();
    return prisma.$transaction(async (tx) => {
        const participants = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT "id" FROM "session_participants"
            WHERE "scheduled_session_id"=${input.scheduledSessionId}::uuid
              AND "participant_identity"=${input.participantIdentity}
            FOR UPDATE
        `);
        const participant = participants[0];
        if (!participant) return null;
        const open = await tx.livePresenceInterval.findFirst({
            where: { participantId: participant.id, endedAt: null },
            orderBy: { generation: 'desc' },
            select: { id: true, generation: true, lastHeartbeatAt: true },
        });
        if (open) {
            const graceEndedAt = new Date(open.lastHeartbeatAt.getTime() + LIVE_PRESENCE_GRACE_MS);
            if (graceEndedAt < now) {
                await tx.livePresenceInterval.update({
                    where: { id: open.id },
                    data: { endedAt: graceEndedAt, endReason: 'heartbeat_timeout' },
                });
                return tx.livePresenceInterval.create({
                    data: {
                        scheduledSessionId: input.scheduledSessionId,
                        participantId: participant.id,
                        generation: open.generation + 1,
                        startedAt: now,
                        lastHeartbeatAt: now,
                        reconnectCount: input.reconnect ? 1 : 0,
                    },
                    select: { id: true, generation: true },
                });
            }
            return tx.livePresenceInterval.update({
                where: { id: open.id },
                data: {
                    lastHeartbeatAt: now,
                    ...(input.reconnect ? { reconnectCount: { increment: 1 } } : {}),
                },
                select: { id: true, generation: true },
            });
        }
        const latest = await tx.livePresenceInterval.findFirst({
            where: { participantId: participant.id }, orderBy: { generation: 'desc' }, select: { generation: true },
        });
        return tx.livePresenceInterval.create({
            data: {
                scheduledSessionId: input.scheduledSessionId,
                participantId: participant.id,
                generation: (latest?.generation ?? 0) + 1,
                startedAt: now,
                lastHeartbeatAt: now,
            },
            select: { id: true, generation: true },
        });
    }, { isolationLevel: 'Serializable' });
}

export async function closeLivePresence(input: {
    scheduledSessionId: string;
    participantIdentity: string;
    reason: 'left' | 'event_closed' | 'logout';
    now?: Date;
}): Promise<number> {
    const now = input.now ?? new Date();
    const result = await prisma.livePresenceInterval.updateMany({
        where: {
            scheduledSessionId: input.scheduledSessionId,
            endedAt: null,
            participant: { participantIdentity: input.participantIdentity },
        },
        data: { endedAt: now, lastHeartbeatAt: now, endReason: input.reason },
    });
    return result.count;
}

export async function closeSessionPresence(
    scheduledSessionId: string,
    now = new Date(),
): Promise<number> {
    const delegate = (prisma as unknown as { livePresenceInterval?: {
        updateMany(args: unknown): Promise<{ count: number }>;
    } }).livePresenceInterval;
    if (!delegate) return 0;
    const result = await delegate.updateMany({
        where: { scheduledSessionId, endedAt: null },
        data: { endedAt: now, lastHeartbeatAt: now, endReason: 'event_closed' },
    });
    return result.count;
}
