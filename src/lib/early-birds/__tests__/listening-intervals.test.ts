import { describe, expect, it, vi } from 'vitest';

import { listeningSeconds } from '@/lib/listener/profile-summary';
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
            data: { endedAt: now, endReason: 'evicted' },
        });
    });
    it('does not turn a delayed eviction into two hours of recorded listening', async () => {
        const interval = { startedAt: new Date('2026-10-26T10:00:00Z'), lastHeartbeatAt: new Date('2026-10-26T10:05:00Z'), endedAt: null as Date | null };
        const updateMany = vi.fn().mockImplementation(async ({ data }) => { Object.assign(interval, data); return { count: 1 }; });
        const now = new Date('2026-10-26T12:00:00Z');
        await closeListeningIntervals({ tx: { earlyBirdListeningInterval: { upsert: vi.fn(), updateMany } }, leaseIds: ['own-lease'], now, reason: 'evicted' });
        expect(interval.lastHeartbeatAt).toEqual(new Date('2026-10-26T10:05:00Z'));
        expect(listeningSeconds([interval], now)).toBe(345);
    });

});
