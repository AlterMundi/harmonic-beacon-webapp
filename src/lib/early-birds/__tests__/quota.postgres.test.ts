import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '@prisma/client';

import {
    EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
    EARLY_BIRD_QUOTA_CYCLE_MS,
    EarlyBirdQuotaGrantConflictError,
    grantEarlyBirdQuotaBonus,
    lockEarlyBirdQuotaAccount,
    settleLockedEarlyBirdQuota,
} from '../quota';
import {
    acquireEarlyBirdStreamLease,
    authorizeEarlyBirdStreamLease,
    EarlyBirdAccessDeniedError,
    EarlyBirdLeaseRefreshRequiredError,
    heartbeatEarlyBirdStreamLease,
    type EarlyBirdStreamUrlIssuer,
} from '../stream';

const listenerDatabaseUrl = process.env.LISTENER_TEST_DATABASE_URL;
if (listenerDatabaseUrl) process.env.DATABASE_URL = listenerDatabaseUrl;
const postgres = listenerDatabaseUrl ? describe : describe.skip;
let prisma: PrismaClient;
const suffix = randomUUID().slice(0, 8);
const accounts = {
    anchor: `listener-quota-pg-anchor-${suffix}`,
    overlap: `listener-quota-pg-overlap-${suffix}`,
    final: `listener-quota-pg-final-${suffix}`,
    grant: `listener-quota-pg-grant-${suffix}`,
    cascade: `listener-quota-pg-cascade-${suffix}`,
};
const accountIds = Object.values(accounts);
const T0 = new Date('2026-08-08T12:00:00.000Z');

const issuer: EarlyBirdStreamUrlIssuer = {
    async issue(request) {
        return {
            manifestUrl: `/api/early-birds/stream/manifest?leaseId=${request.leaseId}&leaseGeneration=${request.leaseGeneration}`,
            expiresAt: request.leaseExpiresAt,
        };
    },
};

function simultaneous(count: number) {
    let arrived = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { release = resolve; });
    return async () => {
        arrived += 1;
        if (arrived === count) release();
        await ready;
    };
}

async function settleAt(accountId: string, now: Date) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await prisma.$transaction(async (tx) => {
                await lockEarlyBirdQuotaAccount(tx, accountId);
                const projection = await tx.earlyBirdMembershipProjection.findUnique({ where: { accountId } });
                return settleLockedEarlyBirdQuota({ tx, accountId, projection, now });
            }, { isolationLevel: 'Serializable' });
        } catch (error) {
            if (!(typeof error === 'object' && error !== null && 'code' in error
                && (error as { code?: unknown }).code === 'P2034') || attempt === 2) throw error;
        }
    }
    throw new Error('unreachable settlement retry');
}

postgres('Listener quota PostgreSQL serialization', () => {
    beforeAll(async () => {
        ({ prisma } = await import('@/lib/db'));
        await prisma.earlyBirdUser.createMany({
            data: accountIds.map((id, index) => ({
                id,
                name: `Quota Test ${index}`,
                email: `quota-${suffix}-${index}@example.invalid`,
                emailVerified: true,
            })),
        });
    });

    afterAll(async () => {
        await prisma.earlyBirdUser.deleteMany({ where: { id: { in: accountIds } } });
        await prisma.$disconnect();
    });

    it('converges simultaneous first play to one immutable anchor', async () => {
        const barrier = simultaneous(2);
        await Promise.all([
            (async () => {
                await barrier();
                return acquireEarlyBirdStreamLease(
                    accounts.anchor, 'device_pg_anchor_aaaaaaaaaaaaaaa1', T0, issuer,
                );
            })(),
            (async () => {
                await barrier();
                return acquireEarlyBirdStreamLease(
                    accounts.anchor, 'device_pg_anchor_aaaaaaaaaaaaaaa2', T0, issuer,
                );
            })(),
        ]);
        const cursor = await prisma.earlyBirdListeningQuotaCursor.findUniqueOrThrow({
            where: { accountId: accounts.anchor },
        });
        expect(cursor.cycleAnchorAt).toEqual(T0);
        expect(cursor.cycleStartedAt).toEqual(T0);
        expect(cursor.baseConsumedMs).toBe(0);
    });

    it('charges two overlapping LISTENING leases as one union under concurrent reconciliation', async () => {
        await prisma.earlyBirdListeningQuotaCursor.create({
            data: {
                accountId: accounts.overlap,
                policyVersion: 'personal-7-day-v1',
                cycleAnchorAt: T0,
                cycleStartedAt: T0,
                cycleEndsAt: new Date(T0.getTime() + EARLY_BIRD_QUOTA_CYCLE_MS),
                settledThrough: T0,
            },
        });
        await prisma.earlyBirdStreamLease.createMany({
            data: [1, 2].map((index) => ({
                accountId: accounts.overlap,
                deviceDigest: String(index).repeat(64),
                presence: 'LISTENING' as const,
                macroRegion: 'UNKNOWN' as const,
                presenceUpdatedAt: T0,
                lastSeenAt: T0,
                expiresAt: new Date(T0.getTime() + 10_000),
            })),
        });
        const barrier = simultaneous(2);
        await Promise.all([1, 2].map(async () => {
            await barrier();
            return settleAt(accounts.overlap, new Date(T0.getTime() + 1_000));
        }));
        const cursor = await prisma.earlyBirdListeningQuotaCursor.findUniqueOrThrow({
            where: { accountId: accounts.overlap },
        });
        expect(cursor.baseConsumedMs).toBe(1_000);
    });

    it('rejects a delayed pre-stop LISTENING heartbeat by generation sequence CAS', async () => {
        const lease = await prisma.earlyBirdStreamLease.findFirstOrThrow({
            where: { accountId: accounts.anchor },
            orderBy: { createdAt: 'asc' },
        });
        await heartbeatEarlyBirdStreamLease(
            accounts.anchor,
            lease.id,
            lease.generation,
            1,
            new Date(T0.getTime() + 100),
            issuer,
            false,
            { state: 'IDLE', macroRegion: 'UNKNOWN' },
        );
        await expect(heartbeatEarlyBirdStreamLease(
            accounts.anchor,
            lease.id,
            lease.generation,
            0,
            new Date(T0.getTime() + 101),
            issuer,
            true,
            { state: 'LISTENING', macroRegion: 'UNKNOWN' },
        )).rejects.toBeInstanceOf(EarlyBirdLeaseRefreshRequiredError);
        expect(await prisma.earlyBirdStreamLease.findUniqueOrThrow({ where: { id: lease.id } }))
            .toMatchObject({ presence: 'IDLE', presenceSequence: 1 });
    });

    it('never overruns the final quota millisecond under a concurrent race', async () => {
        await prisma.earlyBirdListeningQuotaCursor.create({
            data: {
                accountId: accounts.final,
                policyVersion: 'personal-7-day-v1',
                cycleAnchorAt: T0,
                cycleStartedAt: T0,
                cycleEndsAt: new Date(T0.getTime() + EARLY_BIRD_QUOTA_CYCLE_MS),
                baseConsumedMs: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS - 1,
                settledThrough: T0,
            },
        });
        await prisma.earlyBirdStreamLease.createMany({
            data: [3, 4].map((index) => ({
                accountId: accounts.final,
                deviceDigest: String(index).repeat(64),
                presence: 'LISTENING' as const,
                macroRegion: 'UNKNOWN' as const,
                presenceUpdatedAt: T0,
                lastSeenAt: T0,
                expiresAt: new Date(T0.getTime() + 10_000),
            })),
        });
        const barrier = simultaneous(2);
        await Promise.all([1, 2].map(async () => {
            await barrier();
            return settleAt(accounts.final, new Date(T0.getTime() + 1));
        }));
        const cursor = await prisma.earlyBirdListeningQuotaCursor.findUniqueOrThrow({
            where: { accountId: accounts.final },
        });
        expect(cursor.baseConsumedMs).toBe(EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS);
        const lease = await prisma.earlyBirdStreamLease.findFirstOrThrow({
            where: { accountId: accounts.final },
        });
        await expect(authorizeEarlyBirdStreamLease(
            accounts.final,
            lease.id,
            lease.generation,
            new Date(T0.getTime() + 1),
        )).rejects.toBeInstanceOf(EarlyBirdAccessDeniedError);
    });

    it('converges exact grant replay and rejects a conflicting request', async () => {
        const input = {
            accountId: accounts.grant,
            amountMs: 60_000,
            issuerCode: 'QUEST_SYSTEM' as const,
            sourceCode: 'COLLABORATION_QUEST' as const,
            reasonCode: 'QUEST_COMPLETED' as const,
            idempotencyKey: `quest:${suffix}:completion`,
            availableFrom: T0,
            expiresAt: null,
        };
        const barrier = simultaneous(2);
        const results = await Promise.all([1, 2].map(async () => {
            await barrier();
            return grantEarlyBirdQuotaBonus(input);
        }));
        expect(results.map(({ replayed }) => replayed).sort()).toEqual([false, true]);
        await expect(grantEarlyBirdQuotaBonus({ ...input, amountMs: 60_001 }))
            .rejects.toBeInstanceOf(EarlyBirdQuotaGrantConflictError);
        expect(await prisma.earlyBirdListeningBonusGrant.count({
            where: { accountId: accounts.grant },
        })).toBe(1);
    });

    it('enforces immutable anchor and grant facts in PostgreSQL triggers', async () => {
        await expect(prisma.earlyBirdListeningQuotaCursor.update({
            where: { accountId: accounts.anchor },
            data: { cycleAnchorAt: new Date(T0.getTime() + 1) },
        })).rejects.toThrow();
        const grant = await prisma.earlyBirdListeningBonusGrant.findFirstOrThrow({
            where: { accountId: accounts.grant },
        });
        await expect(prisma.earlyBirdListeningBonusGrant.update({
            where: { id: grant.id },
            data: { amountMs: grant.amountMs + 1 },
        })).rejects.toThrow();
    });

    it('cascades the bounded cursor and audited grants when the owning account is deleted', async () => {
        await grantEarlyBirdQuotaBonus({
            accountId: accounts.cascade,
            amountMs: 1,
            issuerCode: 'SUPPORT',
            sourceCode: 'MANUAL_REMEDIATION',
            reasonCode: 'RESTORE_ACCESS',
            idempotencyKey: `cascade:${suffix}`,
            availableFrom: T0,
        });
        await prisma.earlyBirdUser.delete({ where: { id: accounts.cascade } });
        expect(await prisma.earlyBirdListeningBonusGrant.count({
            where: { accountId: accounts.cascade },
        })).toBe(0);
    });
});
