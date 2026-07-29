import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    resolveRoomPrincipal: vi.fn(),
    raiseHand: vi.fn(),
    lowerHand: vi.fn(),
    getHandState: vi.fn(),
}));

vi.mock('@/lib/room-entitlement', () => ({
    resolveRoomPrincipal: mocks.resolveRoomPrincipal,
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
        ...overrides,
    };
}

describe('/api/scheduled-sessions/[id]/hand', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveRoomPrincipal.mockResolvedValue({
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
    });

    it('denies an unauthenticated or unentitled caller at the entitlement gate', async () => {
        mocks.resolveRoomPrincipal.mockResolvedValue({
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

    it('denies staff even when the room gate would admit them to observe', async () => {
        mocks.resolveRoomPrincipal.mockResolvedValue({
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
            createRequest('/api/scheduled-sessions/event-1/hand', { method: 'POST' }),
            mockParams({ id: 'event-1' }),
        );

        expect(response.status).toBe(403);
        expect(mocks.raiseHand).not.toHaveBeenCalled();
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
        });
        expect(mocks.raiseHand).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1',
            participantIdentity: 'opaque-attendee-1',
            ticketEntitlementId: 'ticket-1',
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
});
