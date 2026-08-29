import { describe, expect, it, vi } from 'vitest';

import { closeListeningIntervals, observeListeningInterval } from '../listening-intervals';

describe('durable Listener intervals', () => {
    it('uses lease generation and ordered presence sequence as its idempotency key', async () => {
        const upsert = vi.fn().mockResolvedValue({});
        const now = new Date('2026-08-29T12:00:00Z');
        await observeListeningInterval({
            tx: { earlyBirdListeningInterval: { upsert, updateMany: vi.fn() } },
            lease: { id: 'lease', accountId: 'account', deviceDigest: 'd'.repeat(64), generation: 4, presenceSequence: 9 },
            now, accessClass: 'membership',
        });
        expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { leaseId_leaseGeneration_presenceSequence: { leaseId: 'lease', leaseGeneration: 4, presenceSequence: 9 } },
            update: { lastHeartbeatAt: now },
        }));
    });

    it('closes every open span for a displaced lease at server time', async () => {
        const updateMany = vi.fn().mockResolvedValue({ count: 2 });
        const now = new Date('2026-08-29T12:01:00Z');
        await closeListeningIntervals({
            tx: { earlyBirdListeningInterval: { upsert: vi.fn(), updateMany } },
            leaseIds: ['one', 'two'], now, reason: 'evicted',
        });
        expect(updateMany).toHaveBeenCalledWith({
            where: { leaseId: { in: ['one', 'two'] }, endedAt: null },
            data: { endedAt: now, lastHeartbeatAt: now, endReason: 'evicted' },
        });
    });
});
