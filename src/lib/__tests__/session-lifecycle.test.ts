import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Covers the logic extracted out of the Provider's own end path so the Admin kill
 * switch could reuse it rather than reimplement it. Tested directly because both
 * callers depend on the same guarantees: no egress left running, no recording row
 * pointing at a file that never landed, and a duration that is not measured from
 * the epoch.
 */

function mockAll(options: {
    recordings?: Record<string, unknown>[];
    fileExists?: boolean;
    stopEgressFails?: boolean;
} = {}) {
    const { recordings = [], fileExists = true, stopEgressFails = false } = options;

    const mockPrisma = {
        sessionRecording: {
            findMany: vi.fn().mockResolvedValue(recordings),
            update: vi.fn().mockResolvedValue({}),
            delete: vi.fn().mockResolvedValue({}),
        },
        scheduledSession: {
            update: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: 'sess-1', ...data })),
        },
    };

    const mockStopEgress = stopEgressFails
        ? vi.fn().mockRejectedValue(new Error('egress already gone'))
        : vi.fn().mockResolvedValue({});

    vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
    vi.doMock('@/lib/livekit-server', () => ({
        getEgressClient: vi.fn().mockReturnValue({ stopEgress: mockStopEgress }),
    }));
    vi.doMock('fs', () => ({ existsSync: vi.fn().mockReturnValue(fileExists) }));

    return { mockPrisma, mockStopEgress };
}

describe('stopActiveRecordings', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('does no LiveKit work and no waiting when there are no active recordings', async () => {
        const { mockStopEgress } = mockAll();

        const { stopActiveRecordings } = await import('../session-lifecycle');
        const started = Date.now();
        const count = await stopActiveRecordings('sess-1');

        expect(count).toBe(0);
        expect(mockStopEgress).not.toHaveBeenCalled();
        // The 2s finalize wait is skipped entirely on the empty path.
        expect(Date.now() - started).toBeLessThan(500);
    });

    it('stops every active egress and marks the rows stopped', async () => {
        const { mockPrisma, mockStopEgress } = mockAll({
            recordings: [
                { id: 'rec-1', egressId: 'e-1', filePath: '/data/a.ogg', active: true },
                { id: 'rec-2', egressId: 'e-2', filePath: '/data/b.ogg', active: true },
            ],
        });

        const { stopActiveRecordings } = await import('../session-lifecycle');
        const count = await stopActiveRecordings('sess-1');

        expect(count).toBe(2);
        expect(mockStopEgress).toHaveBeenCalledWith('e-1');
        expect(mockStopEgress).toHaveBeenCalledWith('e-2');
        expect(mockPrisma.sessionRecording.update).toHaveBeenCalledTimes(2);
        expect(mockPrisma.sessionRecording.findMany).toHaveBeenCalledWith({
            where: { sessionId: 'sess-1', active: true },
        });
    }, 10000);

    it('deletes a row whose file never appeared', async () => {
        const { mockPrisma } = mockAll({
            recordings: [{ id: 'rec-1', egressId: 'e-1', filePath: '/data/a.ogg', active: true }],
            fileExists: false,
        });

        const { stopActiveRecordings } = await import('../session-lifecycle');
        await stopActiveRecordings('sess-1');

        expect(mockPrisma.sessionRecording.delete).toHaveBeenCalledWith({ where: { id: 'rec-1' } });
    }, 10000);

    it('carries on when an egress refuses to stop', async () => {
        const { mockPrisma } = mockAll({
            recordings: [{ id: 'rec-1', egressId: 'e-1', filePath: '/data/a.ogg', active: true }],
            stopEgressFails: true,
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { stopActiveRecordings } = await import('../session-lifecycle');
        await expect(stopActiveRecordings('sess-1')).resolves.toBe(1);

        expect(mockPrisma.sessionRecording.update).toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    }, 10000);
});

describe('endLiveSession', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('sets ENDED with a duration measured from startedAt', async () => {
        const { mockPrisma } = mockAll();

        const { endLiveSession } = await import('../session-lifecycle');
        const startedAt = new Date(Date.now() - 3600 * 1000);
        const { session, recordingsStopped } = await endLiveSession('sess-1', startedAt);

        expect(recordingsStopped).toBe(0);
        expect(session.status).toBe('ENDED');
        const call = mockPrisma.scheduledSession.update.mock.calls[0][0];
        expect(call.where).toEqual({ id: 'sess-1' });
        expect(call.data.status).toBe('ENDED');
        expect(call.data.endedAt).toBeInstanceOf(Date);
        expect(call.data.durationSeconds).toBeGreaterThan(3500);
        expect(call.data.durationSeconds).toBeLessThan(3700);
    });

    it('records duration 0 rather than a duration measured from the epoch', async () => {
        const { mockPrisma } = mockAll();

        const { endLiveSession } = await import('../session-lifecycle');
        await endLiveSession('sess-1', null);

        expect(mockPrisma.scheduledSession.update.mock.calls[0][0].data.durationSeconds).toBe(0);
    });
});
