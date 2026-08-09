import { beforeEach, describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as string[]);
const tx = vi.hoisted(() => ({
    $queryRaw: vi.fn(),
    earlyBirdListenerAuthorityPolicy: { findUnique: vi.fn() },
    earlyBirdListeningBonusGrant: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
    earlyBirdListeningQuotaCursor: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    earlyBirdStreamLease: { findMany: vi.fn() },
}));
const prisma = vi.hoisted(() => ({
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
}));

vi.mock('@/lib/db', () => ({ prisma }));

import {
    earlyBirdQuotaBonusRequestHash,
    EarlyBirdQuotaGrantConflictError,
    grantEarlyBirdQuotaBonus,
    settleLockedEarlyBirdQuota,
    withLockedQuotaTransaction,
    withQuotaTransaction,
    type EarlyBirdQuotaBonusGrantInput,
} from '../quota';

const NOW = new Date('2026-08-08T12:00:00.000Z');
const input: EarlyBirdQuotaBonusGrantInput = {
    accountId: 'listener-1',
    amountMs: 60_000,
    issuerCode: 'QUEST_SYSTEM',
    sourceCode: 'COLLABORATION_QUEST',
    reasonCode: 'QUEST_COMPLETED',
    idempotencyKey: 'quest:completion:0001',
    availableFrom: NOW,
    expiresAt: null,
};

beforeEach(() => {
    vi.clearAllMocks();
    calls.length = 0;
    tx.$queryRaw.mockImplementation((query: { sql?: string }) => {
        const sql = query.sql ?? '';
        if (sql.includes('FOR UPDATE')) {
            calls.push('lock');
            return [{ id: 'listener-1' }];
        }
        calls.push('clock');
        return [{ now: NOW }];
    });
    tx.earlyBirdListenerAuthorityPolicy.findUnique.mockResolvedValue({
        id: 1,
        policyVersion: 'personal-7-day-v1',
    });
});

describe('quota persistence boundaries', () => {
    it('takes the account lock before observing PostgreSQL time', async () => {
        await withLockedQuotaTransaction('listener-1', async () => {
            calls.push('callback');
        });
        expect(calls).toEqual(['lock', 'clock', 'callback']);
    });

    it('retries a bounded Serializable P2034 conflict', async () => {
        prisma.$transaction
            .mockRejectedValueOnce(Object.assign(new Error('serialization'), { code: 'P2034' }))
            .mockImplementationOnce((callback: (client: typeof tx) => unknown) => callback(tx));
        await expect(withQuotaTransaction(async () => 'ok')).resolves.toBe('ok');
        expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    });

    it('makes an exact bonus replay inert and rejects a conflicting replay', async () => {
        const existing = {
            id: '00000000-0000-4000-8000-000000000001',
            ...input,
            requestHash: earlyBirdQuotaBonusRequestHash(input),
            grantedAt: NOW,
            createdAt: NOW,
        };
        tx.earlyBirdListeningBonusGrant.findUnique.mockResolvedValue(existing);
        await expect(grantEarlyBirdQuotaBonus(input)).resolves.toEqual({ grant: existing, replayed: true });
        expect(tx.earlyBirdListeningBonusGrant.create).not.toHaveBeenCalled();

        tx.earlyBirdListeningBonusGrant.findUnique.mockResolvedValue({
            ...existing,
            requestHash: 'f'.repeat(64),
        });
        await expect(grantEarlyBirdQuotaBonus(input)).rejects.toBeInstanceOf(
            EarlyBirdQuotaGrantConflictError,
        );
    });

    it('bounds the hot lease scan after the compact settlement cursor', async () => {
        const settledThrough = new Date('2026-08-08T11:59:00.000Z');
        const cursor = {
            accountId: 'listener-1',
            policyVersion: 'personal-7-day-v1',
            cycleAnchorAt: new Date('2026-08-01T12:00:00.000Z'),
            cycleStartedAt: new Date('2026-08-08T12:00:00.000Z'),
            cycleEndsAt: new Date('2026-08-15T12:00:00.000Z'),
            baseConsumedMs: 0,
            settledThrough,
        };
        tx.earlyBirdListeningQuotaCursor.findUnique.mockResolvedValue(cursor);
        tx.earlyBirdStreamLease.findMany.mockResolvedValue([]);
        tx.earlyBirdListeningBonusGrant.findMany.mockResolvedValue([]);
        tx.earlyBirdListeningQuotaCursor.update.mockImplementation(({ data }) => ({ ...cursor, ...data }));
        await settleLockedEarlyBirdQuota({
            tx: tx as never,
            accountId: 'listener-1',
            projection: null,
            now: NOW,
        });
        expect(tx.earlyBirdStreamLease.findMany).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ expiresAt: { gt: settledThrough } }),
        }));
    });

    it('does not create quota state for an active canonical membership', async () => {
        tx.earlyBirdListeningQuotaCursor.findUnique.mockResolvedValue(null);
        tx.earlyBirdStreamLease.findMany.mockResolvedValue([{
            presenceUpdatedAt: new Date(NOW.getTime() - 1_000),
            expiresAt: new Date(NOW.getTime() + 1_000),
        }]);
        tx.earlyBirdListeningBonusGrant.findMany.mockResolvedValue([]);
        const snapshot = await settleLockedEarlyBirdQuota({
            tx: tx as never,
            accountId: 'listener-1',
            projection: {
                state: 'ACTIVE',
                paidThrough: null,
            } as never,
            now: NOW,
            observeFreeListening: true,
        });
        expect(snapshot.status).toBe('not-started');
        expect(tx.earlyBirdListeningQuotaCursor.upsert).not.toHaveBeenCalled();
    });

});
