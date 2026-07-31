import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
    const queryRaw = vi.fn();
    const findUnique = vi.fn();
    const update = vi.fn();
    const auditCreate = vi.fn();
    const tx = {
        $queryRaw: queryRaw,
        scheduledSession: { findUnique, update },
        auditLog: { create: auditCreate },
    };
    return {
        queryRaw,
        findUnique,
        update,
        auditCreate,
        transaction: vi.fn(async (run: (client: typeof tx) => unknown) => run(tx)),
    };
});

vi.mock('@/lib/db', () => ({
    prisma: { $transaction: mocks.transaction },
}));

import { transitionScheduledSession } from '../session-lifecycle';

describe('transitionScheduledSession transaction', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findUnique.mockResolvedValue({
            id: 'event-1',
            status: 'SCHEDULED',
            scheduledAt: new Date('2026-08-01T18:00:00Z'),
            facilitatorId: 'facilitator-1',
            startedAt: null,
            endedAt: null,
        });
        mocks.update.mockResolvedValue({
            status: 'LIVE',
            startedAt: new Date('2026-08-01T18:00:00Z'),
            endedAt: null,
        });
        mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
    });

    it('locks, mutates and audits atomically in that order', async () => {
        const result = await transitionScheduledSession({
            sessionId: 'event-1',
            actor: { id: 'facilitator-1', role: 'FACILITATOR' },
            targetStatus: 'LIVE',
            now: new Date('2026-08-01T18:00:00Z'),
        });

        expect(result).toMatchObject({
            changed: true,
            previousStatus: 'SCHEDULED',
            status: 'LIVE',
        });
        expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.findUnique.mock.invocationCallOrder[0],
        );
        expect(mocks.findUnique.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.update.mock.invocationCallOrder[0],
        );
        expect(mocks.update.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.auditCreate.mock.invocationCallOrder[0],
        );
        expect(mocks.auditCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                actorUserId: 'facilitator-1',
                action: 'session.lifecycle_transition',
                targetType: 'SCHEDULED_SESSION',
                targetId: 'event-1',
                reason: 'Doors opened',
                metadata: {
                    previousStatus: 'SCHEDULED',
                    newStatus: 'LIVE',
                    adminOverride: false,
                },
            }),
        });
    });

    it('makes a concurrent retry harmless after it observes the locked new state', async () => {
        mocks.findUnique.mockResolvedValue({
            id: 'event-1',
            status: 'LIVE',
            scheduledAt: new Date('2026-08-01T18:00:00Z'),
            facilitatorId: 'facilitator-1',
            startedAt: new Date('2026-08-01T18:00:00Z'),
            endedAt: null,
        });

        const result = await transitionScheduledSession({
            sessionId: 'event-1',
            actor: { id: 'facilitator-1', role: 'FACILITATOR' },
            targetStatus: 'LIVE',
        });

        expect(result).toMatchObject({ changed: false, status: 'LIVE' });
        expect(mocks.update).not.toHaveBeenCalled();
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });

    it('rolls audit failure through the enclosing transaction', async () => {
        mocks.auditCreate.mockRejectedValue(new Error('audit unavailable'));
        await expect(transitionScheduledSession({
            sessionId: 'event-1',
            actor: { id: 'facilitator-1', role: 'FACILITATOR' },
            targetStatus: 'LIVE',
            now: new Date('2026-08-01T18:00:00Z'),
        })).rejects.toThrow('audit unavailable');
    });
});
