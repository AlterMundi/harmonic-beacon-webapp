import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({
    $queryRaw: vi.fn(),
    earlyBirdMembershipProjection: { findUnique: vi.fn() },
    earlyBirdFreeSchedule: { findUnique: vi.fn() },
    earlyBirdWelcomeAccess: { findUnique: vi.fn() },
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
    earlyBirdUser: { upsert: vi.fn() },
    earlyBirdStreamLease: {
        updateMany: vi.fn(),
        findFirst: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
    },
    earlyBirdMembershipProjection: { findUnique: vi.fn() },
    earlyBirdFreeSchedule: { findUnique: vi.fn() },
    earlyBirdWelcomeAccess: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

import {
    acquireEarlyBirdStreamLease,
    acquireFreeForAllStreamLease,
    authorizeFreeForAllStreamLease,
    authorizeEarlyBirdStreamLease,
    EarlyBirdAccessDeniedError,
    EarlyBirdDeviceCapacityError,
    earlyBirdDeviceDigest,
    EARLY_BIRD_LEASE_TTL_MS,
    heartbeatEarlyBirdStreamLease,
    prepareEarlyBirdStreamLease,
    EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
    type EarlyBirdStreamUrlIssuer,
} from '../stream';

const NOW = new Date('2026-08-06T12:00:00.000Z');

describe('EarlyBird two-device leases', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tx.$queryRaw.mockResolvedValue([{ id: 'listener-1' }]);
        tx.earlyBirdMembershipProjection.findUnique.mockResolvedValue({
            state: 'ACTIVE',
            paidThrough: null,
        });
        tx.earlyBirdFreeSchedule.findUnique.mockResolvedValue(null);
        prisma.earlyBirdFreeSchedule.findUnique.mockResolvedValue(null);
        tx.earlyBirdWelcomeAccess.findUnique.mockResolvedValue(null);
        prisma.earlyBirdWelcomeAccess.findUnique.mockResolvedValue(null);
        tx.earlyBirdStreamLease.findUnique.mockResolvedValue(null);
        tx.earlyBirdStreamLease.updateMany.mockResolvedValue({ count: 1 });
        prisma.earlyBirdStreamLease.updateMany.mockResolvedValue({ count: 1 });
    });

    it('never persists a raw browser device identifier', () => {
        const raw = 'device_abcdefghijklmnopqrstuvwxyz';
        const digest = earlyBirdDeviceDigest(raw, 'p'.repeat(32));
        expect(digest).toMatch(/^[0-9a-f]{64}$/);
        expect(digest).not.toContain(raw);
    });

    it('evicts the oldest lease when a third distinct device enters', async () => {
        tx.earlyBirdStreamLease.findMany.mockResolvedValue([
            { id: '00000000-0000-4000-8000-000000000001' },
            { id: '00000000-0000-4000-8000-000000000002' },
        ]);
        tx.earlyBirdStreamLease.create.mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000003',
        });
        const issuer: EarlyBirdStreamUrlIssuer = {
            issue: vi.fn().mockResolvedValue({
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=3',
                expiresAt: new Date(NOW.getTime() + EARLY_BIRD_LEASE_TTL_MS),
            }),
        };

        const result = await acquireEarlyBirdStreamLease(
            'listener-1',
            'device_abcdefghijklmnopqrstuvwxyz',
            NOW,
            issuer,
        );

        expect(tx.earlyBirdStreamLease.updateMany).toHaveBeenCalledWith({
            where: { id: { in: ['00000000-0000-4000-8000-000000000001'] } },
            data: { evictedAt: NOW },
        });
        expect(result.evictedLeaseId).toBe('00000000-0000-4000-8000-000000000001');
        expect(result.leaseId).toBe('00000000-0000-4000-8000-000000000003');
        expect(issuer.issue).toHaveBeenCalledOnce();
    });

    it('never evicts an active listener merely to prepare a third device', async () => {
        tx.earlyBirdStreamLease.findMany.mockResolvedValue([
            { id: '00000000-0000-4000-8000-000000000001' },
            { id: '00000000-0000-4000-8000-000000000002' },
        ]);
        const issuer: EarlyBirdStreamUrlIssuer = { issue: vi.fn() };

        await expect(prepareEarlyBirdStreamLease(
            'listener-1',
            'device_abcdefghijklmnopqrstuvwxyz',
            NOW,
            issuer,
        )).rejects.toBeInstanceOf(EarlyBirdDeviceCapacityError);

        expect(tx.earlyBirdStreamLease.updateMany).not.toHaveBeenCalled();
        expect(tx.earlyBirdStreamLease.create).not.toHaveBeenCalled();
        expect(issuer.issue).not.toHaveBeenCalled();
    });

    it('gives a prepared source lower eviction priority than real playback', async () => {
        tx.earlyBirdStreamLease.findMany.mockResolvedValue([]);
        tx.earlyBirdStreamLease.create.mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000003',
        });
        const issuer: EarlyBirdStreamUrlIssuer = {
            issue: vi.fn().mockResolvedValue({
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=3',
                expiresAt: new Date(NOW.getTime() + EARLY_BIRD_LEASE_TTL_MS),
            }),
        };

        await prepareEarlyBirdStreamLease(
            'listener-1',
            'device_abcdefghijklmnopqrstuvwxyz',
            NOW,
            issuer,
        );

        expect(tx.earlyBirdStreamLease.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ lastSeenAt: new Date(0) }),
        });
    });

    it('caps a Free lease at the exact listening-window boundary', async () => {
        tx.earlyBirdMembershipProjection.findUnique.mockResolvedValue(null);
        tx.earlyBirdFreeSchedule.findUnique.mockResolvedValue({
            timeZone: 'UTC',
            localStartMinute: 11 * 60,
            selectedAt: new Date('2026-08-01T00:00:00.000Z'),
            changeAllowedAt: new Date('2026-08-08T00:00:00.000Z'),
        });
        tx.earlyBirdStreamLease.findMany.mockResolvedValue([]);
        tx.earlyBirdStreamLease.create.mockImplementation(({ data }) => ({
            id: '00000000-0000-4000-8000-000000000003',
            ...data,
        }));
        const issuer: EarlyBirdStreamUrlIssuer = {
            issue: vi.fn().mockImplementation(({ leaseExpiresAt }) => ({
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=3',
                expiresAt: leaseExpiresAt,
            })),
        };

        const nearBoundary = new Date('2026-08-06T12:59:00.000Z');
        const result = await acquireEarlyBirdStreamLease(
            'listener-1',
            'device_abcdefghijklmnopqrstuvwxyz',
            nearBoundary,
            issuer,
        );

        expect(result.leaseExpiresAt).toEqual(new Date('2026-08-06T13:00:00.000Z'));
        expect(tx.earlyBirdStreamLease.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ expiresAt: new Date('2026-08-06T13:00:00.000Z') }),
        });
    });

    it('caps a welcome lease at the exact thirty-minute boundary', async () => {
        tx.earlyBirdMembershipProjection.findUnique.mockResolvedValue(null);
        tx.earlyBirdFreeSchedule.findUnique.mockResolvedValue(null);
        tx.earlyBirdWelcomeAccess.findUnique.mockResolvedValue({
            accountId: 'listener-1',
            startedAt: new Date('2026-08-06T11:32:00.000Z'),
            endsAt: new Date('2026-08-06T12:02:00.000Z'),
            activationRequestId: '00000000-0000-4000-8000-000000000004',
        });
        tx.earlyBirdStreamLease.findMany.mockResolvedValue([]);
        tx.earlyBirdStreamLease.create.mockImplementation(({ data }) => ({
            id: '00000000-0000-4000-8000-000000000003',
            ...data,
        }));
        const issuer: EarlyBirdStreamUrlIssuer = {
            issue: vi.fn().mockImplementation(({ leaseExpiresAt }) => ({
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=3',
                expiresAt: leaseExpiresAt,
            })),
        };

        const result = await acquireEarlyBirdStreamLease(
            'listener-1',
            'device_abcdefghijklmnopqrstuvwxyz',
            NOW,
            issuer,
        );

        expect(result.leaseExpiresAt).toEqual(new Date('2026-08-06T12:02:00.000Z'));
    });

    it('rechecks active welcome access before authorizing a manifest', async () => {
        prisma.earlyBirdMembershipProjection.findUnique.mockResolvedValue(null);
        prisma.earlyBirdFreeSchedule.findUnique.mockResolvedValue(null);
        prisma.earlyBirdWelcomeAccess.findUnique.mockResolvedValue({
            accountId: 'listener-1',
            startedAt: new Date('2026-08-06T11:30:00.000Z'),
            endsAt: new Date('2026-08-06T12:00:00.000Z'),
        });
        prisma.earlyBirdStreamLease.findFirst.mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000003',
            evictedAt: null,
            expiresAt: new Date('2026-08-06T12:03:00.000Z'),
        });

        await expect(authorizeEarlyBirdStreamLease(
            'listener-1',
            '00000000-0000-4000-8000-000000000003',
            NOW,
        )).rejects.toBeInstanceOf(EarlyBirdAccessDeniedError);
    });

    it('renews an idle prepared lease without raising its eviction priority', async () => {
        tx.earlyBirdStreamLease.findFirst.mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000003',
            evictedAt: null,
            expiresAt: new Date('2026-08-06T12:03:00.000Z'),
        });
        tx.earlyBirdStreamLease.update.mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000003',
        });
        const issuer: EarlyBirdStreamUrlIssuer = {
            issue: vi.fn().mockResolvedValue({
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=3',
                expiresAt: new Date(NOW.getTime() + EARLY_BIRD_LEASE_TTL_MS),
            }),
        };

        await heartbeatEarlyBirdStreamLease(
            'listener-1',
            '00000000-0000-4000-8000-000000000003',
            NOW,
            issuer,
            false,
        );

        expect(tx.earlyBirdStreamLease.update).toHaveBeenCalledWith({
            where: { id: '00000000-0000-4000-8000-000000000003' },
            data: { expiresAt: new Date(NOW.getTime() + EARLY_BIRD_LEASE_TTL_MS) },
        });
    });

    it('marks a just-created lease inactive if URL issuance fails closed', async () => {
        tx.earlyBirdStreamLease.findMany.mockResolvedValue([]);
        tx.earlyBirdStreamLease.create.mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000004',
        });
        const issuer: EarlyBirdStreamUrlIssuer = {
            issue: vi.fn().mockRejectedValue(new Error('origin unavailable')),
        };

        await expect(acquireEarlyBirdStreamLease(
            'listener-1',
            'device_abcdefghijklmnopqrstuvwxyz',
            NOW,
            issuer,
        )).rejects.toThrow('origin unavailable');
        expect(prisma.earlyBirdStreamLease.updateMany).toHaveBeenCalledWith({
            where: { id: '00000000-0000-4000-8000-000000000004', accountId: 'listener-1' },
            data: { evictedAt: NOW },
        });
    });

    it('distinguishes eviction from ordinary expiry during heartbeat authorization', async () => {
        tx.earlyBirdStreamLease.findFirst.mockResolvedValueOnce({
            id: '00000000-0000-4000-8000-000000000001',
            evictedAt: new Date('2026-08-06T11:59:00.000Z'),
            expiresAt: new Date('2026-08-06T12:03:00.000Z'),
        });
        await expect(heartbeatEarlyBirdStreamLease('listener-1',
            '00000000-0000-4000-8000-000000000001', NOW))
            .rejects.toMatchObject({ reason: 'evicted' });

        tx.earlyBirdStreamLease.findFirst.mockResolvedValueOnce({
            id: '00000000-0000-4000-8000-000000000002',
            evictedAt: null,
            expiresAt: new Date('2026-08-06T12:00:00.000Z'),
        });
        await expect(heartbeatEarlyBirdStreamLease('listener-1',
            '00000000-0000-4000-8000-000000000002', NOW))
            .rejects.toMatchObject({ reason: 'expired' });
    });

    it('creates a non-PII technical account and an unlimited public device lease', async () => {
        prisma.earlyBirdStreamLease.upsert.mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000005',
        });
        const issuer: EarlyBirdStreamUrlIssuer = {
            issue: vi.fn().mockResolvedValue({
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=5',
                expiresAt: new Date(NOW.getTime() + EARLY_BIRD_LEASE_TTL_MS),
            }),
        };

        const result = await acquireFreeForAllStreamLease(
            'device_abcdefghijklmnopqrstuvwxyz',
            NOW,
            issuer,
        );

        expect(prisma.earlyBirdUser.upsert).toHaveBeenCalledWith({
            where: { id: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID },
            create: expect.objectContaining({
                id: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
                email: 'public-listener@free.invalid',
            }),
            update: {},
        });
        expect(prisma.earlyBirdStreamLease.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { accountId_deviceDigest: expect.objectContaining({
                accountId: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
            }) },
        }));
        expect(result.evictedLeaseId).toBeNull();
        expect(tx.earlyBirdMembershipProjection.findUnique).not.toHaveBeenCalled();
    });

    it('authorizes public leases by technical account and still enforces expiry', async () => {
        prisma.earlyBirdStreamLease.findFirst.mockResolvedValueOnce({
            id: '00000000-0000-4000-8000-000000000005',
            evictedAt: null,
            expiresAt: new Date('2026-08-06T12:03:00.000Z'),
        });
        await expect(authorizeFreeForAllStreamLease(
            '00000000-0000-4000-8000-000000000005',
            NOW,
        )).resolves.toMatchObject({ id: '00000000-0000-4000-8000-000000000005' });
        expect(prisma.earlyBirdStreamLease.findFirst).toHaveBeenCalledWith({
            where: {
                id: '00000000-0000-4000-8000-000000000005',
                accountId: EARLY_BIRD_FREE_FOR_ALL_ACCOUNT_ID,
            },
        });

        prisma.earlyBirdStreamLease.findFirst.mockResolvedValueOnce({
            id: '00000000-0000-4000-8000-000000000005',
            evictedAt: null,
            expiresAt: NOW,
        });
        await expect(authorizeFreeForAllStreamLease(
            '00000000-0000-4000-8000-000000000005',
            NOW,
        )).rejects.toMatchObject({ reason: 'expired' });
    });
});
