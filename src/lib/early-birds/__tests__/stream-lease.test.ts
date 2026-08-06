import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({
    $queryRaw: vi.fn(),
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
    earlyBirdStreamLease: { updateMany: vi.fn(), findFirst: vi.fn() },
    earlyBirdMembershipProjection: { findUnique: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

import {
    acquireEarlyBirdStreamLease,
    EarlyBirdDeviceCapacityError,
    earlyBirdDeviceDigest,
    EARLY_BIRD_LEASE_TTL_MS,
    heartbeatEarlyBirdStreamLease,
    prepareEarlyBirdStreamLease,
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
});
