import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    resolveRoomPrincipal: vi.fn(),
    resolveRoomViewer: vi.fn(),
    raiseHand: vi.fn(),
    lowerHand: vi.fn(),
    getHandState: vi.fn(),
    declineStageInvitation: vi.fn(),
    leaveStage: vi.fn(),
}));

vi.mock('@/lib/room-entitlement', () => ({
    resolveRoomPrincipal: mocks.resolveRoomPrincipal,
    resolveRoomViewer: mocks.resolveRoomViewer,
}));
vi.mock('@/lib/hand-queue', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/hand-queue')>();
    return {
        ...original,
        raiseHand: mocks.raiseHand,
        lowerHand: mocks.lowerHand,
        getHandState: mocks.getHandState,
    };
});
vi.mock('@/lib/stage-control', async (importOriginal) => {
    const original = await importOriginal<typeof import('@/lib/stage-control')>();
    return {
        ...original,
        declineStageInvitation: mocks.declineStageInvitation,
        leaveStage: mocks.leaveStage,
    };
});

const attendeePrincipal = {
    session: {
        id: 'event-1',
        title: 'Saturday EN',
        roomName: 'weekend-stage',
        status: 'LIVE',
        startedAt: null,
    },
    identity: 'opaque-attendee-1',
    displayName: 'Attendee',
    canPublish: false,
    ticketEntitlementId: 'ticket-1',
    staffUserId: null,
};

function handState(overrides: Record<string, unknown> = {}) {
    return {
        participantId: 'participant-1',
        raised: true,
        raisedAt: new Date('2026-08-01T15:10:00Z'),
        queuePosition: 2,
        canPublish: false,
        grantVersion: 1,
        ...overrides,
    };
}

describe('/api/scheduled-sessions/[id]/hand', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveRoomViewer.mockResolvedValue({
            ok: true,
            principal: attendeePrincipal,
        });
        mocks.raiseHand.mockResolvedValue(handState());
        mocks.lowerHand.mockResolvedValue(handState({
            raised: false,
            raisedAt: null,
            queuePosition: null,
        }));
        mocks.getHandState.mockResolvedValue(handState());
        mocks.declineStageInvitation.mockResolvedValue({
            participantId: 'participant-1',
            participantIdentity: 'opaque-attendee-rotated',
            canPublish: false,
            reconcileNeeded: false,
            grantVersion: 2,
        });
        mocks.leaveStage.mockResolvedValue({
            participantId: 'participant-1',
            participantIdentity: 'opaque-attendee-1',
            canPublish: false,
            reconcileNeeded: false,
            grantVersion: 3,
        });
    });

    it('denies an unauthenticated or unentitled caller at the entitlement gate', async () => {
        mocks.resolveRoomViewer.mockResolvedValue({
            ok: false,
            status: 403,
            error: 'Not authorized',
        });
        const { POST } = await import('../route');

        const response = await POST(
            createRequest('/api/scheduled-sessions/event-1/hand', { method: 'POST' }),
            mockParams({ id: 'event-1' }),
        );

        expect(response.status).toBe(403);
        expect(mocks.raiseHand).not.toHaveBeenCalled();
    });

    it('lets staff raise only their own hand without creating a publication grant', async () => {
        mocks.resolveRoomViewer.mockResolvedValue({
            ok: true,
            principal: {
                ...attendeePrincipal,
                displayName: 'Operator',
                ticketEntitlementId: null,
                staffUserId: 'operator-1',
            },
        });
        const { POST } = await import('../route');

        const response = await POST(
            createRequest('/api/scheduled-sessions/event-1/hand', { method: 'POST',
                headers: { host: 'live.harmonicbeacon.com', origin: 'https://live.harmonicbeacon.com' },
                body: { participantIdentity: 'someone-else', staffUserId: 'someone-else' } }),
            mockParams({ id: 'event-1' }),
        );

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ canPublish: false, raised: true });
        expect(mocks.raiseHand).toHaveBeenCalledWith({ scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-attendee-1', ticketEntitlementId: null,
            staffUserId: 'operator-1', displayName: 'Operator' });
        expect(mocks.resolveRoomPrincipal).not.toHaveBeenCalled();
    });

    it('raises the caller\u2019s hand for their own event and returns the queue state', async () => {
        const { POST } = await import('../route');

        const { status, body } = await parseResponse(await POST(
            createRequest('/api/scheduled-sessions/event-1/hand', { method: 'POST' }),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(200);
        expect(body).toEqual({
            participantId: 'participant-1',
            raised: true,
            raisedAt: '2026-08-01T15:10:00.000Z',
            queuePosition: 2,
            canPublish: false,
            grantVersion: 1,
        });
        expect(mocks.raiseHand).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-attendee-1',
            ticketEntitlementId: 'ticket-1',
            staffUserId: null,
            displayName: 'Attendee',
        });
    });

    it('lowers the caller\u2019s own hand', async () => {
        const { DELETE } = await import('../route');

        const { status, body } = await parseResponse(await DELETE(
            createRequest('/api/scheduled-sessions/event-1/hand', { method: 'DELETE' }),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(200);
        expect(body).toMatchObject({ raised: false, raisedAt: null });
        expect(mocks.lowerHand).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-attendee-1',
        });
    });

    it('declines only the caller\u2019s own stage invitation and returns to the audience', async () => {
        mocks.getHandState.mockResolvedValue(handState({
            raised: false,
            raisedAt: null,
            queuePosition: null,
            canPublish: false,
        }));
        const { PATCH } = await import('../route');

        const { status, body } = await parseResponse(await PATCH(
            createRequest('/api/scheduled-sessions/event-1/hand', {
                method: 'PATCH',
                body: { action: 'decline_invitation', expectedGrantVersion: 1 },
            }),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(200);
        expect(body).toMatchObject({ raised: false, canPublish: false });
        expect(mocks.declineStageInvitation).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-attendee-1',
            expectedGrantVersion: 1,
        });
        expect(mocks.getHandState).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-attendee-rotated',
        });
    });

    it('lets the caller leave their own stage grant and returns the converged hand state', async () => {
        mocks.getHandState.mockResolvedValue(handState({
            raised: false,
            raisedAt: null,
            queuePosition: null,
            canPublish: false,
        }));
        const { PATCH } = await import('../route');

        const { status, body } = await parseResponse(await PATCH(
            createRequest('/api/scheduled-sessions/event-1/hand', {
                method: 'PATCH',
                body: { action: 'leave_stage', expectedGrantVersion: 1 },
            }),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(200);
        expect(body).toMatchObject({ raised: false, canPublish: false });
        expect(mocks.leaveStage).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-attendee-1',
            expectedGrantVersion: 1,
        });
        expect(mocks.declineStageInvitation).not.toHaveBeenCalled();
    });

    it('rejects an unknown invitation action without changing a grant', async () => {
        const { PATCH } = await import('../route');

        const response = await PATCH(
            createRequest('/api/scheduled-sessions/event-1/hand', {
                method: 'PATCH',
                body: { action: 'promote_someone_else' },
            }),
            mockParams({ id: 'event-1' }),
        );

        expect(response.status).toBe(400);
        expect(mocks.declineStageInvitation).not.toHaveBeenCalled();
        expect(mocks.leaveStage).not.toHaveBeenCalled();
    });

    it('requires the grant version for every attendee stage exit', async () => {
        const { PATCH } = await import('../route');
        const response = await PATCH(
            createRequest('/api/scheduled-sessions/event-1/hand', {
                method: 'PATCH',
                body: { action: 'leave_stage' },
            }),
            mockParams({ id: 'event-1' }),
        );

        expect(response.status).toBe(400);
        expect(mocks.leaveStage).not.toHaveBeenCalled();
        expect(mocks.declineStageInvitation).not.toHaveBeenCalled();
    });

    it('returns the caller\u2019s own state for the polling loop, without PII', async () => {
        const { GET } = await import('../route');

        const { status, body } = await parseResponse(await GET(
            createRequest('/api/scheduled-sessions/event-1/hand'),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(200);
        expect(body).toMatchObject({ raised: true, queuePosition: 2 });
        expect(JSON.stringify(body)).not.toMatch(/email|ticket|code/i);
        expect(mocks.getHandState).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-attendee-1',
        });
    });

    it('maps a missing participant row to 404', async () => {
        const { HandQueueError } = await import('@/lib/hand-queue');
        mocks.getHandState.mockRejectedValue(new HandQueueError(
            'participant_not_found',
            404,
            'Participant not found',
        ));
        const { GET } = await import('../route');

        const { status, body } = await parseResponse(await GET(
            createRequest('/api/scheduled-sessions/event-1/hand'),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(404);
        expect(body).toMatchObject({ error: 'participant_not_found' });
    });

    it('polls an assigned staff member without materializing presence or a preflight grant', async () => {
        mocks.resolveRoomViewer.mockResolvedValue({ ok: true, principal: { ...attendeePrincipal,
            ticketEntitlementId: null, staffUserId: 'staff-1', isAssignedFacilitator: true } });
        mocks.getHandState.mockResolvedValue(handState({ raised: false, canPublish: false }));
        const { GET } = await import('../route');
        const response = await GET(createRequest('/api/scheduled-sessions/event-1/hand'), mockParams({ id: 'event-1' }));
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ canPublish: false });
        expect(mocks.resolveRoomPrincipal).not.toHaveBeenCalled();
        expect(mocks.raiseHand).not.toHaveBeenCalled();
    });

    it.each([undefined, 'https://untrusted.example'])('rejects a staff hand write with Origin %s', async origin => {
        mocks.resolveRoomViewer.mockResolvedValue({ ok: true, principal: { ...attendeePrincipal,
            ticketEntitlementId: null, staffUserId: 'staff-1' } });
        const { POST } = await import('../route');
        const headers: Record<string, string> = { host: 'live.harmonicbeacon.com' };
        if (origin) headers.origin = origin;
        const response = await POST(createRequest('/api/scheduled-sessions/event-1/hand', { method: 'POST', headers }), mockParams({ id: 'event-1' }));
        expect(response.status).toBe(403);
        expect(mocks.raiseHand).not.toHaveBeenCalled();
    });

    it('does not let the hand API demote a staff facilitator or bypass self_leave', async () => {
        mocks.resolveRoomViewer.mockResolvedValue({ ok: true, principal: { ...attendeePrincipal,
            ticketEntitlementId: null, staffUserId: 'staff-1', isAssignedFacilitator: true } });
        const { PATCH } = await import('../route');
        const response = await PATCH(createRequest('/api/scheduled-sessions/event-1/hand', {
            method: 'PATCH', headers: { host: 'live.harmonicbeacon.com', origin: 'https://live.harmonicbeacon.com' },
            body: { action: 'decline_invitation', expectedGrantVersion: 1 },
        }), mockParams({ id: 'event-1' }));
        expect(response.status).toBe(403);
        expect(mocks.declineStageInvitation).not.toHaveBeenCalled();
        expect(mocks.leaveStage).not.toHaveBeenCalled();
    });

    it('does not let staff raise a participant hand before the doors open', async () => {
        mocks.resolveRoomViewer.mockResolvedValue({ ok: true, principal: { ...attendeePrincipal,
            session: { ...attendeePrincipal.session, status: 'SCHEDULED' }, ticketEntitlementId: null, staffUserId: 'staff-1' } });
        const { POST } = await import('../route');
        const response = await POST(createRequest('/api/scheduled-sessions/event-1/hand', {
            method: 'POST', headers: { host: 'live.harmonicbeacon.com', origin: 'https://live.harmonicbeacon.com' },
        }), mockParams({ id: 'event-1' }));
        expect(response.status).toBe(403);
        expect(mocks.raiseHand).not.toHaveBeenCalled();
    });
});
