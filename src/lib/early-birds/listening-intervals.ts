import type { EarlyBirdListeningAccess } from './access';

export const LISTENER_INTERVAL_HEARTBEAT_GRACE_MS = 45_000;

type IntervalDelegate = {
    upsert(args: unknown): Promise<unknown>;
    updateMany(args: unknown): Promise<unknown>;
};

type IntervalClient = { earlyBirdListeningInterval?: IntervalDelegate };

export type ListenerIntervalLease = {
    id: string;
    accountId: string;
    deviceDigest: string;
    generation: number;
    presenceSequence: number;
};

export async function observeListeningInterval(input: {
    tx: IntervalClient;
    lease: ListenerIntervalLease;
    now: Date;
    accessClass: EarlyBirdListeningAccess['kind'] | 'free-for-all';
    synthetic?: boolean;
}): Promise<void> {
    const delegate = input.tx.earlyBirdListeningInterval;
    if (!delegate) return;
    await delegate.upsert({
        where: {
            leaseId_leaseGeneration_presenceSequence: {
                leaseId: input.lease.id,
                leaseGeneration: input.lease.generation,
                presenceSequence: input.lease.presenceSequence,
            },
        },
        create: {
            accountId: input.lease.accountId,
            leaseId: input.lease.id,
            leaseGeneration: input.lease.generation,
            presenceSequence: input.lease.presenceSequence,
            deviceDigest: input.lease.deviceDigest,
            startedAt: input.now,
            lastHeartbeatAt: input.now,
            accessClass: input.accessClass,
            synthetic: input.synthetic ?? false,
        },
        update: { lastHeartbeatAt: input.now },
    });
}

export async function closeListeningIntervals(input: {
    tx: IntervalClient;
    leaseIds: string[];
    now: Date;
    reason: 'idle' | 'expired' | 'evicted' | 'denied' | 'grant_failed' | 'free_for_all_cutover';
}): Promise<void> {
    const delegate = input.tx.earlyBirdListeningInterval;
    if (!delegate || input.leaseIds.length === 0) return;
    await delegate.updateMany({
        where: { leaseId: { in: input.leaseIds }, endedAt: null },
        data: { endedAt: input.now, lastHeartbeatAt: input.now, endReason: input.reason },
    });
}
