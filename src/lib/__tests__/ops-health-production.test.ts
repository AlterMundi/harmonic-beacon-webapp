import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock('@/lib/db', () => ({
    prisma: {
        scheduledSession: { findFirst },
        sessionParticipant: { count: vi.fn() },
        $queryRaw: vi.fn(),
    },
}));
vi.mock('@/lib/livekit-server', () => ({ getRoomService: vi.fn() }));

import { productionDeps } from '../ops-health';

const watched = {
    id: 'event-2',
    title: 'Second event',
    status: 'LIVE',
    roomName: 'stage-2',
    maxPublishers: 6,
};

describe('production health event selection', () => {
    beforeEach(() => vi.clearAllMocks());

    it('selects the explicitly requested active event', async () => {
        findFirst.mockResolvedValue(watched);
        const selected = await productionDeps({ sessionId: 'event-2' }).getWatchedSession();

        expect(selected).toEqual(watched);
        expect(findFirst).toHaveBeenCalledOnce();
        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: 'event-2', status: { in: ['SCHEDULED', 'LIVE'] } },
        }));
    });

    it('prefers the latest LIVE event instead of the earliest historical one', async () => {
        findFirst.mockResolvedValue(watched);
        expect(await productionDeps().getWatchedSession()).toEqual(watched);
        expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({
            where: { status: 'LIVE' },
            orderBy: { scheduledAt: 'desc' },
        }));
    });

    it('falls back to an upcoming or at-most-60-minutes-late scheduled event', async () => {
        const now = new Date('2026-08-01T18:00:00Z');
        findFirst
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ ...watched, status: 'SCHEDULED' });

        const selected = await productionDeps({ now }).getWatchedSession();
        expect(selected?.status).toBe('SCHEDULED');
        expect(findFirst).toHaveBeenLastCalledWith(expect.objectContaining({
            where: {
                status: 'SCHEDULED',
                scheduledAt: { gte: new Date('2026-08-01T17:00:00Z') },
            },
            orderBy: { scheduledAt: 'asc' },
        }));
    });
});
