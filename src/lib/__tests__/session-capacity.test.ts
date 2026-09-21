import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    transaction: vi.fn(),
    queryRaw: vi.fn(),
    sessionFindUnique: vi.fn(),
    sessionUpdate: vi.fn(),
    participantCount: vi.fn(),
    auditCreate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: { $transaction: mocks.transaction },
}));

describe('session scene capacity service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        const tx = {
            $queryRaw: mocks.queryRaw,
            scheduledSession: {
                findUnique: mocks.sessionFindUnique,
                update: mocks.sessionUpdate,
            },
            sessionParticipant: { count: mocks.participantCount },
            auditLog: { create: mocks.auditCreate },
        };
        mocks.transaction.mockImplementation(
            <T>(callback: (transaction: typeof tx) => Promise<T>) => callback(tx),
        );
        mocks.queryRaw.mockResolvedValue([{ id: 'event-1' }]);
        mocks.sessionFindUnique.mockResolvedValue({
            id: 'event-1',
            facilitatorId: 'facilitator-1',
            maxPublishers: 6,
        });
        mocks.participantCount.mockResolvedValue(5);
        mocks.sessionUpdate.mockResolvedValue({ maxPublishers: 12 });
        mocks.auditCreate.mockResolvedValue({});
    });

    it('locks the session, raises capacity, and audits actor/session/old/new/time', async () => {
        const now = new Date('2026-09-16T01:00:00.000Z');
        const { setSessionSceneCapacity } = await import('../session-capacity');

        await expect(setSessionSceneCapacity({
            scheduledSessionId: 'event-1',
            actorUserId: 'operator-1',
            actorRole: 'ADMIN',
            maxPublishers: 12,
            now,
        })).resolves.toEqual({
            scheduledSessionId: 'event-1',
            previousMaxPublishers: 6,
            maxPublishers: 12,
            activePublisherGrants: 5,
            changedAt: now,
        });

        expect(mocks.queryRaw).toHaveBeenCalledBefore(mocks.sessionFindUnique);
        expect(mocks.sessionUpdate).toHaveBeenCalledWith({
            where: { id: 'event-1' },
            data: { maxPublishers: 12 },
            select: { maxPublishers: true },
        });
        expect(mocks.auditCreate).toHaveBeenCalledWith({
            data: {
                actorUserId: 'operator-1',
                actorRole: 'ADMIN',
                action: 'session.scene_capacity.change',
                targetType: 'SCHEDULED_SESSION',
                targetId: 'event-1',
                reason: null,
                metadata: {
                    previousMaxPublishers: 6,
                    maxPublishers: 12,
                    activePublisherGrants: 5,
                },
                createdAt: now,
            },
        });
    });

    it('rejects lowering below the actual active grant count without mutation', async () => {
        mocks.sessionFindUnique.mockResolvedValue({
            id: 'event-1',
            facilitatorId: 'facilitator-1',
            maxPublishers: 12,
        });
        mocks.participantCount.mockResolvedValue(8);
        const { setSessionSceneCapacity } = await import('../session-capacity');

        await expect(setSessionSceneCapacity({
            scheduledSessionId: 'event-1',
            actorUserId: 'operator-1',
            actorRole: 'ADMIN',
            maxPublishers: 6,
        })).rejects.toMatchObject({
            code: 'capacity_below_active_grants',
            status: 409,
            details: { activePublisherGrants: 8, requestedMaxPublishers: 6 },
        });
        expect(mocks.sessionUpdate).not.toHaveBeenCalled();
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });

    it('rejects unsupported capacities before starting a transaction', async () => {
        const { setSessionSceneCapacity } = await import('../session-capacity');
        await expect(setSessionSceneCapacity({
            scheduledSessionId: 'event-1',
            actorUserId: 'operator-1',
            actorRole: 'ADMIN',
            maxPublishers: 7,
        })).rejects.toMatchObject({ code: 'invalid_capacity', status: 400 });
        expect(mocks.transaction).not.toHaveBeenCalled();
    });

    it('rejects staff without system-administration authority', async () => {
        const { setSessionSceneCapacity } = await import('../session-capacity');
        await expect(setSessionSceneCapacity({
            scheduledSessionId: 'event-1',
            actorUserId: 'operator-1',
            actorRole: 'OPERATOR',
            maxPublishers: 9,
        })).rejects.toMatchObject({ code: 'forbidden', status: 403 });
        expect(mocks.sessionUpdate).not.toHaveBeenCalled();
    });

    it('allows six attendee grants when the facilitator is not publishing', async () => {
        mocks.sessionFindUnique.mockResolvedValue({
            id: 'event-1',
            facilitatorId: 'facilitator-1',
            maxPublishers: 12,
        });
        mocks.participantCount.mockResolvedValue(6);
        const { setSessionSceneCapacity } = await import('../session-capacity');

        await expect(setSessionSceneCapacity({
            scheduledSessionId: 'event-1',
            actorUserId: 'operator-1',
            actorRole: 'ADMIN',
            maxPublishers: 6,
        })).resolves.toMatchObject({ activePublisherGrants: 6, maxPublishers: 6 });
    });

    it('counts every active grant, including the facilitator only when publishing', async () => {
        const { setSessionSceneCapacity } = await import('../session-capacity');
        await setSessionSceneCapacity({
            scheduledSessionId: 'event-1',
            actorUserId: 'operator-1',
            actorRole: 'ADMIN',
            maxPublishers: 12,
        });

        expect(mocks.participantCount).toHaveBeenCalledWith({
            where: {
                scheduledSessionId: 'event-1',
                publishGrantedAt: { not: null },
                publishRevokedAt: null,
            },
        });
    });
});
