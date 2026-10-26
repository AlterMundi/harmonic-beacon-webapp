import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextResponse } from 'next/server';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    requireStaff: vi.fn(),
    sessionFindUnique: vi.fn(),
    participantFindFirst: vi.fn(),
    promoteParticipant: vi.fn(),
    demoteParticipant: vi.fn(),
    muteParticipantTrack: vi.fn(),
    reconcileParticipants: vi.fn(),
    lowerParticipantHand: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ requireStaff: mocks.requireStaff }));
vi.mock('@/lib/db', () => ({
    prisma: {
        scheduledSession: { findUnique: mocks.sessionFindUnique },
        sessionParticipant: { findFirst: mocks.participantFindFirst },
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
vi.mock('@/lib/hand-queue', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/hand-queue')>();
    return {
        ...original,
        lowerParticipantHand: mocks.lowerParticipantHand,
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
        mocks.lowerParticipantHand.mockResolvedValue({
            participantId: 'participant-1',
            raised: false,
            raisedAt: null,
            queuePosition: null,
            canPublish: true,
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

    it('lets facilitators operate unassigned events', async () => {
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

        expect(response.status).toBe(200);
        expect(mocks.promoteParticipant).toHaveBeenCalled();
    });

    it('lets FACILITATOR_OP operate an unassigned event', async () => {
        mocks.requireStaff.mockResolvedValue([
            { ...operator, userId: 'facilitator-op-2', role: 'FACILITATOR_OP' },
            null,
        ]);
        const { POST } = await import('../route');

        const response = await POST(
            stageRequest({ action: 'promote', participantId: 'participant-1' }),
            mockParams({ id: 'event-1' }),
        );

        expect(response.status).toBe(200);
        expect(mocks.promoteParticipant).toHaveBeenCalled();
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

    it('passes a mute request to the track controller', async () => {
        mocks.muteParticipantTrack.mockResolvedValue({
            participantId: 'participant-1',
            trackSid: 'TR_audio',
            muted: true,
        });
        const { POST } = await import('../route');
        const response = await POST(
            stageRequest({
                action: 'mute',
                participantId: 'participant-1',
                trackSid: 'TR_audio',
                muted: true,
            }),
            mockParams({ id: 'event-1' }),
        );

        expect(response.status).toBe(200);
        expect(mocks.muteParticipantTrack).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1',
            participantId: 'participant-1',
            actorUserId: 'operator-1',
            trackSid: 'TR_audio',
            muted: true,
        });
    });

    it('rejects remote unmute before calling the track controller', async () => {
        const { POST } = await import('../route');
        const response = await POST(
            stageRequest({
                action: 'mute',
                participantId: 'participant-1',
                trackSid: 'TR_video',
                muted: false,
            }),
            mockParams({ id: 'event-1' }),
        );

        expect(response.status).toBe(400);
        expect(mocks.muteParticipantTrack).not.toHaveBeenCalled();
    });

    it('lowers a served hand through the audited queue operation', async () => {
        const { POST } = await import('../route');
        const { status, body } = await parseResponse(await POST(
            stageRequest({
                action: 'lower_hand',
                participantId: 'participant-1',
                reason: 'Promoted to stage',
            }),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(200);
        expect(body).toMatchObject({
            participantId: 'participant-1',
            raised: false,
            canPublish: true,
        });
        expect(mocks.lowerParticipantHand).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1',
            participantId: 'participant-1',
            actorUserId: 'operator-1',
            reason: 'Promoted to stage',
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
    it('activates only the current staff participation through the capacity-fenced controller', async () => {
        mocks.participantFindFirst.mockResolvedValue({ id: 'own-participant' });
        const { POST } = await import('../route');
        const response = await POST(createRequest('/api/ops/sessions/event-1/stage', {
            method: 'POST', headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
            body: { action: 'self_publish', participantId: 'forged-participant', staffUserId: 'someone-else' },
        }), mockParams({ id: 'event-1' }));
        expect(response.status).toBe(200);
        expect(mocks.participantFindFirst).toHaveBeenCalledWith({ where: { scheduledSessionId: 'event-1', staffUserId: 'operator-1' }, select: { id: true } });
        expect(mocks.promoteParticipant).toHaveBeenCalledWith({ scheduledSessionId: 'event-1', participantId: 'own-participant', actorUserId: 'operator-1', reason: 'Staff requested publication controls' });
    });
    it('rejects cross-origin self activation without touching a grant', async () => {
        const { POST } = await import('../route');
        const response = await POST(createRequest('/api/ops/sessions/event-1/stage', {
            method: 'POST', headers: { host: 'localhost:3000', origin: 'https://evil.invalid' }, body: { action: 'self_publish' },
        }), mockParams({ id: 'event-1' }));
        expect(response.status).toBe(403); expect(mocks.participantFindFirst).not.toHaveBeenCalled(); expect(mocks.promoteParticipant).not.toHaveBeenCalled();
    });

    it('returns only the authenticated staff member’s current grant without writing or exposing identities', async () => {
        mocks.participantFindFirst.mockResolvedValue({ grantVersion: 4, publishGrantedAt: new Date(), publishRevokedAt: null, grantReconcileNeeded: false });
        const { GET } = await import('../route');
        const response = await GET(createRequest('/api/ops/sessions/event-1/stage?participantId=someone-else'), mockParams({ id: 'event-1' }));
        expect(await response.json()).toEqual({ canPublish: true, grantVersion: 4 });
        expect(response.headers.get('Cache-Control')).toBe('private, no-store');
        expect(mocks.participantFindFirst).toHaveBeenCalledWith({
            where: { scheduledSessionId: 'event-1', staffUserId: 'operator-1' },
            select: { grantVersion: true, publishGrantedAt: true, publishRevokedAt: true, grantReconcileNeeded: true },
        });
        expect(mocks.promoteParticipant).not.toHaveBeenCalled();
        expect(mocks.demoteParticipant).not.toHaveBeenCalled();
    });

    it('requires staff authentication for the own-grant snapshot', async () => {
        mocks.requireStaff.mockResolvedValue([null, NextResponse.json({ error: 'Not authorized' }, { status: 403 })]);
        const { GET } = await import('../route');
        expect((await GET(stageRequest({}), mockParams({ id: 'event-1' }))).status).toBe(403);
        expect(mocks.participantFindFirst).not.toHaveBeenCalled();
    });

    it('releases only the caller’s own stage slot through versioned self-leave', async () => {
        mocks.participantFindFirst.mockResolvedValue({ id: 'own-participant' });
        mocks.demoteParticipant.mockResolvedValue({ canPublish: false, grantVersion: 8 });
        const { POST } = await import('../route');
        const response = await POST(createRequest('/api/ops/sessions/event-1/stage', {
            method: 'POST', headers: { host: 'localhost:3000', origin: 'http://localhost:3000' },
            body: { action: 'self_leave', expectedGrantVersion: 7, participantId: 'forged-other', staffUserId: 'someone-else' },
        }), mockParams({ id: 'event-1' }));
        expect(response.status).toBe(200);
        expect(mocks.demoteParticipant).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1', participantId: 'own-participant', actorUserId: 'operator-1',
            auditAction: 'stage.staff.leave', reason: 'Staff voluntarily left the stage', clearHand: true, expectedGrantVersion: 7,
        });
    });

    it('rejects cross-origin or unversioned self-leave before releasing any slot', async () => {
        mocks.participantFindFirst.mockResolvedValue({ id: 'own-participant' });
        const { POST } = await import('../route');
        for (const [origin, expectedGrantVersion, expectedStatus] of [
            ['https://elsewhere.invalid', 4, 403], ['http://localhost:3000', undefined, 400],
        ] as const) {
            const response = await POST(createRequest('/api/ops/sessions/event-1/stage', {
                method: 'POST', headers: { host: 'localhost:3000', origin }, body: { action: 'self_leave', expectedGrantVersion },
            }), mockParams({ id: 'event-1' }));
            expect(response.status).toBe(expectedStatus);
        }
        expect(mocks.demoteParticipant).not.toHaveBeenCalled();
    });

});
