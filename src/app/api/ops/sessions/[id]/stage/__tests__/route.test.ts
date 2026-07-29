import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    requireStaff: vi.fn(),
    sessionFindUnique: vi.fn(),
    promoteParticipant: vi.fn(),
    demoteParticipant: vi.fn(),
    muteParticipantTrack: vi.fn(),
    reconcileParticipants: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireStaff: mocks.requireStaff }));
vi.mock('@/lib/db', () => ({
    prisma: {
        scheduledSession: { findUnique: mocks.sessionFindUnique },
    },
}));
vi.mock('@/lib/stage-control', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/stage-control')>();
    return {
        ...original,
        promoteParticipant: mocks.promoteParticipant,
        demoteParticipant: mocks.demoteParticipant,
        muteParticipantTrack: mocks.muteParticipantTrack,
        reconcileParticipants: mocks.reconcileParticipants,
    };
});

const operator = {
    kind: 'staff',
    webSessionId: 'web-1',
    userId: 'operator-1',
    role: 'OPERATOR',
};

function stageRequest(body: unknown) {
    return createRequest('/api/ops/sessions/event-1/stage', {
        method: 'POST',
        body,
    });
}

describe('POST /api/ops/sessions/[id]/stage', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.requireStaff.mockResolvedValue([operator, null]);
        mocks.sessionFindUnique.mockResolvedValue({
            facilitatorId: 'facilitator-1',
        });
        mocks.promoteParticipant.mockResolvedValue({
            participantId: 'participant-1',
            canPublish: true,
            reconcileNeeded: false,
            grantVersion: 2,
        });
    });

    it('requires an authorized staff principal', async () => {
        mocks.requireStaff.mockResolvedValue([
            null,
            NextResponse.json(
                { error: 'Authentication required' },
                { status: 401 },
            ),
        ]);
        const { POST } = await import('../route');

        const response = await POST(
            stageRequest({
                action: 'promote',
                participantId: 'participant-1',
            }),
            mockParams({ id: 'event-1' }),
        );

        expect(response.status).toBe(401);
        expect(mocks.promoteParticipant).not.toHaveBeenCalled();
    });

    it('scopes a facilitator to their assigned event', async () => {
        mocks.requireStaff.mockResolvedValue([
            { ...operator, userId: 'facilitator-2', role: 'FACILITATOR' },
            null,
        ]);
        const { POST } = await import('../route');

        const response = await POST(
            stageRequest({
                action: 'promote',
                participantId: 'participant-1',
            }),
            mockParams({ id: 'event-1' }),
        );

        expect(response.status).toBe(403);
        expect(mocks.promoteParticipant).not.toHaveBeenCalled();
    });

    it('promotes through the serialized stage controller', async () => {
        const { POST } = await import('../route');
        const { status, body } = await parseResponse(await POST(
            stageRequest({
                action: 'promote',
                participantId: 'participant-1',
                reason: 'Next in the hand queue',
            }),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(200);
        expect(body).toMatchObject({
            participantId: 'participant-1',
            canPublish: true,
        });
        expect(mocks.promoteParticipant).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1',
            participantId: 'participant-1',
            actorUserId: 'operator-1',
            reason: 'Next in the hand queue',
        });
    });

    it('returns a 409 stage_full response with the queue hint', async () => {
        const { StageControlError } = await import('@/lib/stage-control');
        mocks.promoteParticipant.mockRejectedValue(new StageControlError(
            'stage_full',
            409,
            'The stage is full',
            { queuePosition: 3 },
        ));
        const { POST } = await import('../route');
        const { status, body } = await parseResponse(await POST(
            stageRequest({
                action: 'promote',
                participantId: 'participant-1',
            }),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(409);
        expect(body).toEqual({
            error: 'stage_full',
            message: 'The stage is full',
            queuePosition: 3,
        });
    });

    it('passes mute and unmute state to the track controller', async () => {
        mocks.muteParticipantTrack.mockResolvedValue({
            participantId: 'participant-1',
            trackSid: 'TR_audio',
            muted: false,
        });
        const { POST } = await import('../route');
        const response = await POST(
            stageRequest({
                action: 'mute',
                participantId: 'participant-1',
                trackSid: 'TR_audio',
                muted: false,
            }),
            mockParams({ id: 'event-1' }),
        );

        expect(response.status).toBe(200);
        expect(mocks.muteParticipantTrack).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1',
            participantId: 'participant-1',
            actorUserId: 'operator-1',
            trackSid: 'TR_audio',
            muted: false,
        });
    });

    it('surfaces failed reconciliation without hiding successful participants', async () => {
        mocks.reconcileParticipants.mockResolvedValue({
            reconciled: ['participant-1'],
            failed: ['participant-2'],
        });
        const { POST } = await import('../route');
        const { body } = await parseResponse(await POST(
            stageRequest({ action: 'reconcile' }),
            mockParams({ id: 'event-1' }),
        ));

        expect(body).toEqual({
            reconciled: ['participant-1'],
            failed: ['participant-2'],
            reconcileNeeded: true,
        });
    });
});
