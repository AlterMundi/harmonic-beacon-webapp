import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({ $transaction: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: prismaMock }));
import { observeLivePresence } from '@/lib/live-presence';

describe('durable Live presence', () => {
    beforeEach(() => vi.clearAllMocks());
    it('uses server time and advances one interval instead of accepting client duration', async () => {
        const interval = { id: 'interval-1', generation: 2, lastHeartbeatAt: new Date('2026-08-29T09:59:50Z') };
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

    it('closes a heartbeat gap at the grace boundary and starts a new generation', async () => {
        const open = { id: 'interval-1', generation: 2, lastHeartbeatAt: new Date('2026-08-29T09:58:00Z') };
        const next = { id: 'interval-2', generation: 3 };
        const tx = {
            $queryRaw: vi.fn().mockResolvedValue([{ id: 'participant-1' }]),
            livePresenceInterval: {
                findFirst: vi.fn().mockResolvedValue(open),
                update: vi.fn().mockResolvedValue(open),
                create: vi.fn().mockResolvedValue(next),
            },
        };
        prismaMock.$transaction.mockImplementation((fn: (value: typeof tx) => unknown) => fn(tx));
        const now = new Date('2026-08-29T10:00:00Z');
        await expect(observeLivePresence({
            scheduledSessionId: 'event-1', participantIdentity: 'opaque-attendee', now, reconnect: true,
        })).resolves.toEqual(next);
        expect(tx.livePresenceInterval.update).toHaveBeenCalledWith({
            where: { id: open.id },
            data: { endedAt: new Date('2026-08-29T09:58:45Z'), endReason: 'heartbeat_timeout' },
        });
        expect(tx.livePresenceInterval.create).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                generation: 3, startedAt: now, lastHeartbeatAt: now, reconnectCount: 1,
            }),
        }));
    });
});
