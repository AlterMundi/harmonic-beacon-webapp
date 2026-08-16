import { beforeEach, describe, expect, it, vi } from 'vitest';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const LEASE_ID = '00000000-0000-4000-8000-000000000003';

const tx = vi.hoisted(() => ({
    earlyBirdMembershipProjection: { findUnique: vi.fn() },
    earlyBirdStreamLease: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        updateMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        findFirst: vi.fn(),
    },
}));
const prisma = vi.hoisted(() => ({
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    $queryRaw: vi.fn(),
    earlyBirdUser: { upsert: vi.fn() },
    earlyBirdStreamLease: {
        updateMany: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
    },
}));
const quotaMocks = vi.hoisted(() => ({
    lockEarlyBirdQuotaAccount: vi.fn(),
    settleLockedEarlyBirdQuota: vi.fn(),
    withLockedQuotaTransaction: vi.fn((
        _accountId: string,
        callback: (client: typeof tx, now: Date) => unknown,
    ) => callback(tx, new Date('2026-08-08T12:00:00.000Z'))),
    withQuotaTransaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
    serializeEarlyBirdQuotaSnapshot: vi.fn((value) => value),
}));

vi.mock('@/lib/db', () => ({ prisma }));
vi.mock('../quota', () => quotaMocks);

import {
    acquireEarlyBirdStreamLease,
    acquireFreeForAllStreamLease,
    authorizeEarlyBirdStreamLease,
    claimEarlyBirdStreamLease,
    EarlyBirdAccessDeniedError,
    EarlyBirdDeviceCapacityError,
    EarlyBirdLeaseRefreshRequiredError,
    EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
    EARLY_BIRD_LEASE_TTL_MS,
    heartbeatEarlyBirdStreamLease,
    prepareEarlyBirdStreamLease,
    quiescePersonalListenerLeasesForFreeForAll,
    type EarlyBirdStreamUrlIssuer,
} from '../stream';

const unstarted = {
    policy: 'personal-7-day-v1',
    status: 'not-started',
    cycleStartedAt: null,
    cycleEndsAt: null,
    baseAllowanceMs: 10_800_000,
    bonusAllowanceMs: 0,
    consumedMs: 0,
    remainingMs: 10_800_000,
    activelyConsuming: false,
    exhaustsAt: null,
    nextCycleAt: null,
};
const listening = {
    ...unstarted,
    status: 'listening',
    cycleStartedAt: NOW,
    cycleEndsAt: new Date(NOW.getTime() + 604_800_000),
    activelyConsuming: true,
    exhaustsAt: new Date(NOW.getTime() + 10_800_000),
    nextCycleAt: new Date(NOW.getTime() + 604_800_000),
};
const issuer: EarlyBirdStreamUrlIssuer = {
    issue: vi.fn().mockImplementation((request) => ({
        manifestUrl: `/api/early-birds/stream/manifest?leaseId=${request.leaseId}&leaseGeneration=${request.leaseGeneration}`,
        expiresAt: request.leaseExpiresAt,
    })),
};

beforeEach(() => {
    vi.clearAllMocks();
    tx.earlyBirdMembershipProjection.findUnique.mockResolvedValue(null);
    tx.earlyBirdStreamLease.findUnique.mockResolvedValue(null);
    tx.earlyBirdStreamLease.findMany.mockResolvedValue([]);
    tx.earlyBirdStreamLease.create.mockImplementation(({ data }) => ({
        id: LEASE_ID,
        generation: 1,
        presenceSequence: 0,
        ...data,
    }));
    tx.earlyBirdStreamLease.update.mockImplementation(({ data }) => ({
        id: LEASE_ID,
        generation: 1,
        presenceSequence: typeof data.presenceSequence === 'number' ? data.presenceSequence : 0,
        ...data,
    }));
    quotaMocks.settleLockedEarlyBirdQuota.mockResolvedValue(unstarted);
});

describe('quota-aware two-connection leases', () => {
    it('makes a real play LISTENING atomically and anchors through the shared settlement', async () => {
        quotaMocks.settleLockedEarlyBirdQuota
            .mockResolvedValueOnce(unstarted)
            .mockResolvedValueOnce(listening);
        const grant = await acquireEarlyBirdStreamLease(
            'listener-1', 'device_abcdefghijklmnopqrstuvwxyz', NOW, issuer,
        );
        expect(tx.earlyBirdStreamLease.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ presence: 'LISTENING', presenceSequence: 0 }),
        });
        expect(quotaMocks.settleLockedEarlyBirdQuota).toHaveBeenLastCalledWith(
            expect.objectContaining({ observeFreeListening: true }),
        );
        expect(grant).toMatchObject({
            leaseGeneration: 1,
            presenceSequence: 0,
            accessKind: 'free-quota',
        });
        expect(grant.stream.manifestUrl).toContain('leaseGeneration=1');
    });

    it('keeps prepare and eviction-capable claim IDLE without anchoring', async () => {
        await prepareEarlyBirdStreamLease('listener-1', 'device_abcdefghijklmnopqrstuvwxy1', NOW, issuer);
        expect(tx.earlyBirdStreamLease.create).toHaveBeenLastCalledWith({
            data: expect.objectContaining({ presence: 'IDLE', lastSeenAt: new Date(0) }),
        });
        expect(quotaMocks.settleLockedEarlyBirdQuota).not.toHaveBeenCalledWith(
            expect.objectContaining({ observeFreeListening: true }),
        );

        vi.clearAllMocks();
        tx.earlyBirdMembershipProjection.findUnique.mockResolvedValue(null);
        tx.earlyBirdStreamLease.findUnique.mockResolvedValue(null);
        tx.earlyBirdStreamLease.findMany.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }]);
        tx.earlyBirdStreamLease.create.mockResolvedValue({ id: LEASE_ID, generation: 1, presenceSequence: 0 });
        quotaMocks.settleLockedEarlyBirdQuota.mockResolvedValue(unstarted);
        await claimEarlyBirdStreamLease('listener-1', 'device_abcdefghijklmnopqrstuvwxy2', NOW, issuer);
        expect(tx.earlyBirdStreamLease.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['old-1'] } },
            data: { evictedAt: NOW, presence: 'IDLE', presenceUpdatedAt: NOW },
        });
        expect(tx.earlyBirdStreamLease.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ presence: 'IDLE', lastSeenAt: NOW }),
        });
    });

    it('does not let prepare displace a third connection', async () => {
        tx.earlyBirdStreamLease.findMany.mockResolvedValue([{ id: 'old-1' }, { id: 'old-2' }]);
        await expect(prepareEarlyBirdStreamLease(
            'listener-1', 'device_abcdefghijklmnopqrstuvwxyz', NOW, issuer,
        )).rejects.toBeInstanceOf(EarlyBirdDeviceCapacityError);
        expect(tx.earlyBirdStreamLease.updateMany).not.toHaveBeenCalled();
    });

    it('revokes the exact committed lease generation if private grant issuance fails', async () => {
        quotaMocks.settleLockedEarlyBirdQuota
            .mockResolvedValueOnce(unstarted)
            .mockResolvedValueOnce(listening);
        const failingIssuer: EarlyBirdStreamUrlIssuer = { issue: vi.fn().mockRejectedValue(new Error('config')) };
        await expect(acquireEarlyBirdStreamLease(
            'listener-1', 'device_abcdefghijklmnopqrstuvwxyz', NOW, failingIssuer,
        )).rejects.toThrow('config');
        expect(prisma.earlyBirdStreamLease.updateMany).toHaveBeenCalledWith({
            where: { id: LEASE_ID, accountId: 'listener-1', generation: 1 },
            data: {
                evictedAt: NOW,
                presence: 'IDLE',
                presenceUpdatedAt: NOW,
                expiresAt: NOW,
            },
        });
    });

    it('commits exhausted settlement before denying manifest authorization', async () => {
        quotaMocks.settleLockedEarlyBirdQuota.mockResolvedValue({
            ...listening,
            status: 'exhausted',
            remainingMs: 0,
            activelyConsuming: false,
            exhaustsAt: null,
        });
        await expect(authorizeEarlyBirdStreamLease(
            'listener-1', LEASE_ID, 1, NOW,
        )).rejects.toBeInstanceOf(EarlyBirdAccessDeniedError);
        expect(quotaMocks.settleLockedEarlyBirdQuota).toHaveBeenCalledOnce();
    });

    it('rejects stale post-stop LISTENING sequence without reviving presence', async () => {
        quotaMocks.settleLockedEarlyBirdQuota.mockResolvedValue(listening);
        tx.earlyBirdStreamLease.findFirst.mockResolvedValue({
            id: LEASE_ID,
            generation: 4,
            presenceSequence: 8,
            presence: 'IDLE',
            evictedAt: null,
            expiresAt: new Date(NOW.getTime() + 60_000),
        });
        await expect(heartbeatEarlyBirdStreamLease(
            'listener-1', LEASE_ID, 4, 7, NOW, issuer, true,
            { state: 'LISTENING', macroRegion: 'UNKNOWN' },
        )).rejects.toBeInstanceOf(EarlyBirdLeaseRefreshRequiredError);
        expect(tx.earlyBirdStreamLease.update).not.toHaveBeenCalled();
    });

    it('settles and persists IDLE before reporting exhausted access', async () => {
        const exhausted = { ...listening, status: 'exhausted', remainingMs: 0, activelyConsuming: false, exhaustsAt: null };
        quotaMocks.settleLockedEarlyBirdQuota
            .mockResolvedValueOnce(exhausted)
            .mockResolvedValueOnce(exhausted);
        tx.earlyBirdStreamLease.findFirst.mockResolvedValue({
            id: LEASE_ID,
            generation: 2,
            presenceSequence: 1,
            presence: 'LISTENING',
            evictedAt: null,
            expiresAt: new Date(NOW.getTime() + 60_000),
        });
        await expect(heartbeatEarlyBirdStreamLease(
            'listener-1', LEASE_ID, 2, 2, NOW, issuer, false,
            { state: 'IDLE', macroRegion: 'UNKNOWN' },
        )).rejects.toBeInstanceOf(EarlyBirdAccessDeniedError);
        expect(tx.earlyBirdStreamLease.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ presence: 'IDLE', presenceSequence: 2 }),
        }));
    });

    it('keeps Free for All on its separate technical account without quota state', async () => {
        prisma.earlyBirdStreamLease.upsert.mockResolvedValue({
            id: LEASE_ID,
            generation: 3,
            presenceSequence: 0,
        });
        const grant = await acquireFreeForAllStreamLease(
            'device_abcdefghijklmnopqrstuvwxyz', NOW, issuer,
        );
        expect(prisma.earlyBirdUser.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID },
        }));
        expect(grant).toMatchObject({ accessKind: 'free-for-all', quota: null, leaseGeneration: 3 });
        expect(quotaMocks.settleLockedEarlyBirdQuota).not.toHaveBeenCalled();
        expect(grant.leaseExpiresAt.getTime() - NOW.getTime()).toBe(EARLY_BIRD_LEASE_TTL_MS);
    });

    it('settles personal LISTENING leases before an operator FFA cutover evicts them', async () => {
        prisma.$queryRaw.mockResolvedValue([{ accountId: 'listener-1' }]);
        tx.earlyBirdMembershipProjection.findUnique.mockResolvedValue(null);
        quotaMocks.settleLockedEarlyBirdQuota.mockResolvedValue(listening);
        await expect(quiescePersonalListenerLeasesForFreeForAll()).resolves.toEqual({
            accountsSettled: 1,
        });
        expect(quotaMocks.settleLockedEarlyBirdQuota).toHaveBeenCalledWith(expect.objectContaining({
            accountId: 'listener-1',
            now: NOW,
        }));
        expect(tx.earlyBirdStreamLease.updateMany).toHaveBeenCalledWith({
            where: {
                accountId: 'listener-1',
                evictedAt: null,
                expiresAt: { gt: NOW },
            },
            data: {
                presence: 'IDLE',
                presenceUpdatedAt: NOW,
                evictedAt: NOW,
            },
        });
    });
});
