import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    upsert: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
    auditCreate: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
    prisma: {
        sessionParticipant: {
            upsert: mocks.upsert,
            findUnique: mocks.findUnique,
            findFirst: mocks.findFirst,
            update: mocks.update,
            count: mocks.count,
        },
        auditLog: { create: mocks.auditCreate },
    },
}));

const firstRaise = new Date('2026-08-01T15:10:00Z');

function participant(overrides: Record<string, unknown> = {}) {
    return {
        id: 'participant-1',
        raisedAt: firstRaise,
        publishGrantedAt: null,
        publishRevokedAt: null,
        ...overrides,
    };
}

describe('hand queue', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.upsert.mockResolvedValue(participant());
        mocks.findUnique.mockResolvedValue(participant());
        mocks.findFirst.mockResolvedValue({ participantIdentity: 'opaque-1' });
        mocks.update.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
            participant({ raisedAt: data.raisedAt ?? null }),
        );
        mocks.count.mockResolvedValue(0);
        mocks.auditCreate.mockResolvedValue({});
    });

    it('raises through an upsert that never overwrites the original raisedAt', async () => {
        const { raiseHand } = await import('../hand-queue');
        const now = new Date('2026-08-01T15:12:00Z');

        const state = await raiseHand({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-1',
            ticketEntitlementId: 'ticket-1',
            now,
        });

        // The empty update is the idempotency contract: a repeated raise hits
        // the existing row and keeps its first raisedAt, so nobody can move
        // ahead by raising twice.
        expect(mocks.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: expect.objectContaining({ raisedAt: now }),
                update: {},
            }),
        );
        expect(state).toMatchObject({
            raised: true,
            raisedAt: firstRaise,
            queuePosition: 1,
            canPublish: false,
        });
    });

    it('positions the hand behind every earlier waiting hand but not behind publishers', async () => {
        mocks.count
            .mockResolvedValueOnce(2) // earlier waiting hands
            .mockResolvedValueOnce(0); // same-instant ties
        const { raiseHand } = await import('../hand-queue');

        const state = await raiseHand({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-1',
            ticketEntitlementId: 'ticket-1',
        });

        expect(state.queuePosition).toBe(3);
        expect(mocks.count).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                where: expect.objectContaining({
                    raisedAt: { not: null, lt: firstRaise },
                    publishGrantedAt: null,
                    publishRevokedAt: null,
                }),
            }),
        );
    });

    it('treats a raised hand with an active grant as on stage, not in the queue', async () => {
        mocks.findUnique.mockResolvedValue(participant({
            publishGrantedAt: new Date('2026-08-01T15:11:00Z'),
        }));
        const { getHandState } = await import('../hand-queue');

        const state = await getHandState({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-1',
        });

        expect(state.queuePosition).toBeNull();
        expect(state.canPublish).toBe(true);
        expect(mocks.count).not.toHaveBeenCalled();
    });

    it('lowers a raised hand and is idempotent when no hand is up', async () => {
        const { lowerHand } = await import('../hand-queue');

        const lowered = await lowerHand({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-1',
        });
        expect(lowered.raised).toBe(false);
        expect(mocks.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: { raisedAt: null } }),
        );

        mocks.findUnique.mockResolvedValue(participant({ raisedAt: null }));
        mocks.update.mockClear();
        const alreadyDown = await lowerHand({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-1',
        });
        expect(alreadyDown.raised).toBe(false);
        expect(mocks.update).not.toHaveBeenCalled();
    });

    it('audits staff removal without PII and skips audit for self-lowering', async () => {
        const { lowerHand, lowerParticipantHand } = await import('../hand-queue');

        await lowerParticipantHand({
            scheduledSessionId: 'event-1',
            participantId: 'participant-1',
            actorUserId: 'operator-1',
            reason: 'Duplicate hand',
        });

        expect(mocks.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'participant-1', scheduledSessionId: 'event-1' },
            }),
        );
        expect(mocks.auditCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                actorUserId: 'operator-1',
                action: 'stage.hand_lower',
                targetType: 'SESSION_PARTICIPANT',
                targetId: 'participant-1',
            }),
        });
        expect(JSON.stringify(mocks.auditCreate.mock.calls[0][0])).not.toMatch(
            /email|code/i,
        );

        mocks.auditCreate.mockClear();
        await lowerHand({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-1',
        });
        expect(mocks.auditCreate).not.toHaveBeenCalled();
    });

    it('fails closed when the participant row does not exist', async () => {
        mocks.findUnique.mockResolvedValue(null);
        mocks.findFirst.mockResolvedValue(null);
        const { getHandState, lowerParticipantHand, HandQueueError } =
            await import('../hand-queue');

        await expect(getHandState({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-1',
        })).rejects.toMatchObject({
            code: 'participant_not_found',
            status: 404,
        });
        await expect(lowerParticipantHand({
            scheduledSessionId: 'event-1',
            participantId: 'missing',
            actorUserId: 'operator-1',
        })).rejects.toBeInstanceOf(HandQueueError);
    });
});
