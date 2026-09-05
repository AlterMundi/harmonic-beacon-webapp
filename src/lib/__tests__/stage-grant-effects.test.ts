import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    transaction: vi.fn(),
    queryRaw: vi.fn(),
    participantFindFirst: vi.fn(),
    participantUpdate: vi.fn(),
    participantUpdateMany: vi.fn(),
    outboxCreate: vi.fn(),
    outboxUpdate: vi.fn(),
    outboxUpdateMany: vi.fn(),
    outboxCount: vi.fn(),
    listParticipants: vi.fn(),
    updateParticipant: vi.fn(),
    getParticipant: vi.fn(),
    mutePublishedTrack: vi.fn(),
    removeParticipant: vi.fn(),
}));

const transactionClient = {
    $queryRaw: mocks.queryRaw,
    sessionParticipant: {
        findFirst: mocks.participantFindFirst,
        update: mocks.participantUpdate,
        updateMany: mocks.participantUpdateMany,
    },
    stageGrantEffectOutbox: {
        create: mocks.outboxCreate,
        update: mocks.outboxUpdate,
        updateMany: mocks.outboxUpdateMany,
        count: mocks.outboxCount,
    },
};

vi.mock('@/lib/db', () => ({
    prisma: {
        ...transactionClient,
        $transaction: mocks.transaction,
    },
}));

vi.mock('@/lib/livekit-server', () => ({
    bedRoomIdentity: (identity: string) => `bed-${identity}`,
    getRoomService: () => ({
        listParticipants: mocks.listParticipants,
        updateParticipant: mocks.updateParticipant,
        getParticipant: mocks.getParticipant,
        mutePublishedTrack: mocks.mutePublishedTrack,
        removeParticipant: mocks.removeParticipant,
    }),
}));

const NOW = new Date('2026-09-05T06:00:00.000Z');

function claimedJob(overrides: Record<string, unknown> = {}) {
    return {
        id: 'job-1',
        participantId: 'participant-1',
        grantVersion: 3,
        roomName: 'event-stage',
        participantIdentity: 'opaque-participant',
        canPublish: false,
        disconnectParticipant: false,
        bedRoomName: null,
        bedIdentity: null,
        tokenHorizonAt: null,
        claimToken: 'claim-token',
        ...overrides,
    };
}

describe('durable stage grant effects', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.transaction.mockImplementation(
            (callback: (tx: typeof transactionClient) => unknown) => callback(transactionClient),
        );
        mocks.queryRaw.mockResolvedValue([{ id: 'job-1' }]);
        mocks.participantFindFirst.mockResolvedValue({
            id: 'participant-1',
            participantIdentity: 'opaque-participant',
            publishGrantedAt: new Date('2026-09-05T05:00:00.000Z'),
            grantVersion: 2,
            scheduledSession: { roomName: 'event-stage' },
        });
        mocks.participantUpdate.mockResolvedValue({
            id: 'participant-1',
            participantIdentity: 'opaque-participant',
            grantVersion: 3,
        });
        mocks.outboxCreate.mockResolvedValue({});
        mocks.outboxUpdate.mockResolvedValue(claimedJob());
        mocks.outboxUpdateMany.mockResolvedValue({ count: 1 });
        mocks.outboxCount.mockResolvedValue(0);
        mocks.participantUpdateMany.mockResolvedValue({ count: 1 });
        mocks.listParticipants.mockResolvedValue([
            { identity: 'opaque-participant' },
        ]);
        mocks.updateParticipant.mockResolvedValue({});
        mocks.getParticipant.mockResolvedValue({
            tracks: [{ sid: 'TR_audio' }, { sid: 'TR_video' }],
        });
        mocks.mutePublishedTrack.mockResolvedValue({});
        mocks.removeParticipant.mockResolvedValue({});
    });

    it('commits the revision, pending marker and exact effect in one transaction', async () => {
        const { transitionParticipantGrant } = await import('../stage-grant-effects');

        await expect(transitionParticipantGrant(transactionClient as never, {
            scheduledSessionId: 'session-1',
            participantId: 'participant-1',
            canPublish: false,
            now: NOW,
            actorUserId: 'operator-1',
            reason: 'Safety removal',
            clearHand: true,
            disconnectParticipant: true,
            tokenHorizonAt: new Date(NOW.getTime() + 60_000),
        })).resolves.toMatchObject({
            grantVersion: 3,
            canPublish: false,
            reconcileNeeded: true,
        });

        expect(mocks.participantUpdate).toHaveBeenCalledWith({
            where: { id: 'participant-1' },
            data: expect.objectContaining({
                publishRevokedAt: NOW,
                raisedAt: null,
                grantReconcileNeeded: true,
                grantVersion: { increment: 1 },
            }),
            select: expect.anything(),
        });
        expect(mocks.outboxCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                participantId: 'participant-1',
                grantVersion: 3,
                canPublish: false,
                disconnectParticipant: true,
                bedIdentity: 'bed-opaque-participant',
            }),
        });
    });

    it('attempts permission revocation and every track mute independently', async () => {
        mocks.updateParticipant.mockRejectedValue(new Error('permission API unavailable'));
        mocks.mutePublishedTrack
            .mockRejectedValueOnce(new Error('audio mute failed'))
            .mockResolvedValueOnce({});
        const { processNextStageGrantEffect } = await import('../stage-grant-effects');

        await expect(processNextStageGrantEffect(NOW)).resolves.toBe(true);

        expect(mocks.updateParticipant).toHaveBeenCalledOnce();
        expect(mocks.mutePublishedTrack).toHaveBeenCalledTimes(2);
        expect(mocks.outboxUpdateMany).toHaveBeenLastCalledWith({
            where: expect.objectContaining({ claimToken: expect.any(String) }),
            data: expect.objectContaining({
                status: 'PENDING',
                lastErrorCode: 'LIVEKIT_EFFECT_INCOMPLETE',
            }),
        });
        expect(mocks.participantUpdateMany).not.toHaveBeenCalled();
    });

    it('clears the participant marker only after the exact claimed job completes', async () => {
        const { processNextStageGrantEffect } = await import('../stage-grant-effects');

        await expect(processNextStageGrantEffect(NOW)).resolves.toBe(true);

        expect(mocks.outboxUpdateMany).toHaveBeenLastCalledWith({
            where: expect.objectContaining({
                id: 'job-1',
                status: 'PROCESSING',
                claimToken: expect.any(String),
            }),
            data: expect.objectContaining({ status: 'COMPLETED' }),
        });
        expect(mocks.participantUpdateMany).toHaveBeenCalledWith({
            where: { id: 'participant-1', grantVersion: 3 },
            data: { grantReconcileNeeded: false },
        });
    });

    it('ignores a stale worker completion after its claim token is superseded', async () => {
        mocks.outboxUpdateMany.mockResolvedValue({ count: 0 });
        const { processNextStageGrantEffect } = await import('../stage-grant-effects');

        await expect(processNextStageGrantEffect(NOW)).resolves.toBe(true);

        expect(mocks.outboxCount).not.toHaveBeenCalled();
        expect(mocks.participantUpdateMany).not.toHaveBeenCalled();
    });

    it('treats an absent participant as converged without a remote grant write', async () => {
        mocks.listParticipants.mockResolvedValue([]);
        const { processNextStageGrantEffect } = await import('../stage-grant-effects');

        await expect(processNextStageGrantEffect(NOW)).resolves.toBe(true);

        expect(mocks.updateParticipant).not.toHaveBeenCalled();
        expect(mocks.getParticipant).not.toHaveBeenCalled();
        expect(mocks.participantUpdateMany).toHaveBeenCalledOnce();
    });
});
