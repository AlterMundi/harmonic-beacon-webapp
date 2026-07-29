import { beforeEach, describe, expect, it, vi } from 'vitest';

const update = vi.fn();
const deleteRoom = vi.fn();

vi.mock('@/lib/db', () => ({
    prisma: {
        scheduledSession: { update },
    },
}));
vi.mock('@/lib/livekit-server', () => ({
    getRoomService: () => ({ deleteRoom }),
}));

describe('endLiveSession with recording disabled', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        update.mockResolvedValue({ id: 'event-1', status: 'ENDED' });
        deleteRoom.mockResolvedValue(undefined);
    });

    it('ends the database session and room without an egress operation', async () => {
        const { endLiveSession } = await import('../session-lifecycle');
        const result = await endLiveSession(
            'event-1',
            new Date('2026-08-01T15:00:00Z'),
            'weekend-stage',
        );

        expect(update).toHaveBeenCalledWith({
            where: { id: 'event-1' },
            data: {
                status: 'ENDED',
                endedAt: expect.any(Date),
            },
        });
        expect(deleteRoom).toHaveBeenCalledWith('weekend-stage');
        expect(result.recordingsStopped).toBe(0);
    });
});
