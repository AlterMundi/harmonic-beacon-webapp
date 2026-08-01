import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    findUnique: vi.fn(),
    auditCreate: vi.fn(),
    listParticipants: vi.fn(),
    deleteRoom: vi.fn(),
    removeParticipant: vi.fn(),
    bedRoomIdentity: vi.fn((identity: string) => `bed-${identity}`),
}));

vi.mock('@/lib/db', () => ({
    prisma: {
        scheduledSession: { findUnique: mocks.findUnique },
        auditLog: { create: mocks.auditCreate },
    },
}));
vi.mock('@/lib/livekit-server', () => ({
    bedRoomIdentity: mocks.bedRoomIdentity,
    getRoomService: () => ({
        listParticipants: mocks.listParticipants,
        deleteRoom: mocks.deleteRoom,
        removeParticipant: mocks.removeParticipant,
    }),
}));

import { terminateSessionMedia } from '../session-termination';

describe('terminateSessionMedia', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findUnique.mockResolvedValue({
            roomName: 'event-stage',
            participants: [
                { participantIdentity: 'event-a' },
                { participantIdentity: 'event-b' },
            ],
        });
        mocks.listParticipants
            .mockResolvedValueOnce([{ identity: 'event-a' }, { identity: 'event-b' }])
            .mockResolvedValueOnce([
                { identity: 'playlist-bot' },
                { identity: 'bed-event-a' },
                { identity: 'bed-event-b' },
                { identity: 'bed-another-event' },
            ]);
        mocks.deleteRoom.mockResolvedValue(undefined);
        mocks.removeParticipant.mockResolvedValue(undefined);
        mocks.auditCreate.mockResolvedValue({ id: 'audit-1' });
    });

    it('deletes the selected stage and removes only its listeners from the shared bed', async () => {
        const result = await terminateSessionMedia({
            sessionId: 'session-1',
            actorUserId: 'operator-1',
            actorRole: 'OPERATOR',
        });

        expect(result).toEqual({
            complete: true,
            stageDisconnected: 2,
            bedDisconnected: 2,
            failures: [],
        });
        expect(mocks.deleteRoom).toHaveBeenCalledWith('event-stage');
        expect(mocks.removeParticipant.mock.calls).toEqual([
            ['beacon', 'bed-event-a'],
            ['beacon', 'bed-event-b'],
        ]);
        expect(mocks.removeParticipant).not.toHaveBeenCalledWith('beacon', 'playlist-bot');
        expect(mocks.removeParticipant).not.toHaveBeenCalledWith('beacon', 'bed-another-event');
        expect(mocks.auditCreate).toHaveBeenCalledWith({
            data: expect.objectContaining({
                actorUserId: 'operator-1',
                actorRole: 'OPERATOR',
                action: 'session.media_terminate',
                metadata: {
                    stageDisconnected: 2,
                    bedDisconnected: 2,
                    failures: [],
                },
            }),
        });
    });

    it('is harmless when no selected-event connection remains', async () => {
        mocks.listParticipants.mockReset();
        mocks.listParticipants
            .mockResolvedValueOnce([])
            .mockResolvedValueOnce([{ identity: 'playlist-bot' }]);

        await expect(terminateSessionMedia({
            sessionId: 'session-1',
            actorUserId: 'operator-1',
            actorRole: 'FACILITATOR_OP',
        })).resolves.toMatchObject({ complete: true, stageDisconnected: 0, bedDisconnected: 0 });
        expect(mocks.deleteRoom).not.toHaveBeenCalled();
        expect(mocks.removeParticipant).not.toHaveBeenCalled();
    });

    it('reports partial media failures and still audits the attempt', async () => {
        mocks.deleteRoom.mockRejectedValue(new Error('LiveKit unavailable'));
        mocks.removeParticipant
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('participant raced'));

        const result = await terminateSessionMedia({
            sessionId: 'session-1',
            actorUserId: 'operator-1',
            actorRole: 'ADMIN',
        });

        expect(result).toEqual({
            complete: false,
            stageDisconnected: 0,
            bedDisconnected: 1,
            failures: ['stage', 'bed'],
        });
        expect(mocks.auditCreate).toHaveBeenCalledOnce();
    });

    it('still attempts the stage cut and identity-scoped bed removals when listing fails', async () => {
        mocks.listParticipants.mockReset();
        mocks.listParticipants
            .mockRejectedValueOnce(new Error('stage listing unavailable'))
            .mockRejectedValueOnce(new Error('bed listing unavailable'));

        const result = await terminateSessionMedia({
            sessionId: 'session-1',
            actorUserId: 'operator-1',
            actorRole: 'OPERATOR',
        });

        expect(mocks.deleteRoom).toHaveBeenCalledWith('event-stage');
        expect(mocks.removeParticipant.mock.calls).toEqual([
            ['beacon', 'bed-event-a'],
            ['beacon', 'bed-event-b'],
        ]);
        expect(result).toMatchObject({
            complete: false,
            stageDisconnected: 0,
            bedDisconnected: 2,
            failures: ['stage', 'bed'],
        });
    });
});
