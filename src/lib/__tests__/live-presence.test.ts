import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
import { observeLivePresence } from '@/lib/live-presence';

describe('durable Live presence', () => {
    beforeEach(() => vi.clearAllMocks());
    it('uses server time and advances one interval instead of accepting client duration', async () => {
        const interval = { id: 'interval-1', generation: 2 };
        const tx = {
            $queryRaw: vi.fn().mockResolvedValue([{ id: 'participant-1' }]),
            livePresenceInterval: {
                findFirst: vi.fn().mockResolvedValue(interval),
                update: vi.fn().mockResolvedValue(interval),
                create: vi.fn(),
            },
        };
        prismaMock.$transaction.mockImplementation((fn: (value: typeof tx) => unknown) => fn(tx));
        const now = new Date('2026-08-29T10:00:00Z');
        await expect(observeLivePresence({ scheduledSessionId: 'event-1', participantIdentity: 'opaque-attendee', now, reconnect: true })).resolves.toEqual(interval);
        expect(tx.livePresenceInterval.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ lastHeartbeatAt: now, reconnectCount: { increment: 1 } }),
        }));
    });
});
