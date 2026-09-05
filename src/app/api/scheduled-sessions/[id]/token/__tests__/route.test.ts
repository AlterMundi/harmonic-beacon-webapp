import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

const resolveRoomPrincipal = vi.fn();
const createSessionToken = vi.fn();
const finalizeRoomTokenIssue = vi.fn();

vi.mock('@/lib/room-entitlement', () => ({ resolveRoomPrincipal }));
vi.mock('@/lib/livekit-server', () => ({ createSessionToken }));
vi.mock('@/lib/commerce-entitlement', () => ({
    TICKET_LIVEKIT_TOKEN_TTL_SECONDS: 300,
}));
vi.mock('@/lib/room-token-issue', () => ({
    finalizeRoomTokenIssue,
    STAFF_LIVEKIT_TOKEN_TTL_SECONDS: 14_400,
}));

const principal = {
    session: {
        id: 'event-1',
        title: 'Weekend event',
        roomName: 'weekend-stage',
        status: 'LIVE',
        startedAt: new Date('2026-08-01T15:00:00Z'),
    },
    identity: 'event-stable-opaque',
    displayName: 'Attendee',
    role: 'ATTENDEE',
    isAssignedFacilitator: false,
    canPublish: false,
    ticketEntitlementId: 'ticket-1',
    staffUserId: null,
};

describe('GET /api/scheduled-sessions/[id]/token', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        createSessionToken.mockResolvedValue('stage-jwt');
        finalizeRoomTokenIssue.mockResolvedValue(true);
    });

    it.each([
        ['no cookie', 401, 'Authentication required'],
        ['wrong-event or revoked entitlement', 403, 'Not authorized'],
        ['ended/cancelled event', 403, 'Not authorized'],
        ['unrelated staff', 403, 'Not authorized'],
    ])('never mints a stage token for %s', async (_case, status, error) => {
        resolveRoomPrincipal.mockResolvedValue({
            ok: false,
            status,
            error,
        });

        const { GET } = await import('../route');
        const response = await GET(
            createRequest('/api/scheduled-sessions/event-1/token', {
                headers: { cookie: 'hb_session=cookie-value' },
            }),
            mockParams({ id: 'event-1' }),
        );

        expect((await parseResponse(response)).status).toBe(status);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(createSessionToken).not.toHaveBeenCalled();
    });

    it('issues the exact event room and stable subscribe-only identity', async () => {
        resolveRoomPrincipal.mockResolvedValue({ ok: true, principal });

        const { GET } = await import('../route');
        const response = await GET(
            createRequest('/api/scheduled-sessions/event-1/token', {
                headers: { cookie: 'hb_session=cookie-value' },
            }),
            mockParams({ id: 'event-1' }),
        );
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(createSessionToken).toHaveBeenCalledWith(
            'weekend-stage',
            'event-stable-opaque',
            'Attendee',
            false,
            { role: 'ATTENDEE', isAssignedFacilitator: false },
            '300s',
        );
        expect(body).toMatchObject({
            token: 'stage-jwt',
            identity: 'event-stable-opaque',
            room: 'weekend-stage',
            canPublish: false,
        });
        expect(JSON.stringify(body)).not.toMatch(/email|ticketEntitlement/i);
    });

    it('preserves a current facilitator or promoted grant', async () => {
        resolveRoomPrincipal.mockResolvedValue({
            ok: true,
            principal: {
                ...principal,
                displayName: 'Facilitator',
                role: 'FACILITATOR',
                isAssignedFacilitator: true,
                canPublish: true,
                ticketEntitlementId: null,
                staffUserId: 'staff-1',
            },
        });

        const { GET } = await import('../route');
        await GET(
            createRequest('/api/scheduled-sessions/event-1/token', {
                headers: { cookie: 'hb_session=cookie-value' },
            }),
            mockParams({ id: 'event-1' }),
        );

        expect(createSessionToken).toHaveBeenCalledWith(
            'weekend-stage',
            'event-stable-opaque',
            'Facilitator',
            true,
            { role: 'FACILITATOR', isAssignedFacilitator: true },
            '14400s',
        );
    });

    it('keeps the composite role and assignment explicit in response and metadata', async () => {
        resolveRoomPrincipal.mockResolvedValue({
            ok: true,
            principal: {
                ...principal,
                displayName: 'Julián',
                role: 'FACILITATOR_OP',
                isAssignedFacilitator: true,
                canPublish: true,
                ticketEntitlementId: null,
                staffUserId: 'staff-1',
            },
        });

        const { GET } = await import('../route');
        const { body } = await parseResponse(await GET(
            createRequest('/api/scheduled-sessions/event-1/token', {
                headers: { cookie: 'hb_session=cookie-value' },
            }),
            mockParams({ id: 'event-1' }),
        ));

        expect(createSessionToken).toHaveBeenCalledWith(
            'weekend-stage',
            'event-stable-opaque',
            'Julián',
            true,
            { role: 'FACILITATOR_OP', isAssignedFacilitator: true },
            '14400s',
        );
        expect(body).toMatchObject({
            role: 'FACILITATOR_OP',
            isAssignedFacilitator: true,
        });
    });

    it('uses a five-minute ticket token and rechecks under the commerce mutex before returning it', async () => {
        resolveRoomPrincipal.mockResolvedValue({
            ok: true,
            principal: { ...principal, ticketEntitlementId: 'ticket-1', staffUserId: null },
        });
        const { GET } = await import('../route');
        const response = await GET(
            createRequest('/api/scheduled-sessions/event-1/token', {
                headers: { cookie: 'hb_session=cookie-value' },
            }),
            mockParams({ id: 'event-1' }),
        );
        expect(response.status).toBe(200);
        expect(createSessionToken).toHaveBeenCalledWith(
            'weekend-stage',
            'event-stable-opaque',
            'Attendee',
            false,
            { role: 'ATTENDEE', isAssignedFacilitator: false },
            '300s',
        );
        expect(finalizeRoomTokenIssue).toHaveBeenCalledWith(expect.objectContaining({
            cookieValue: 'cookie-value',
            expectedIdentity: 'event-stable-opaque',
            expectedCanPublish: false,
            tokenExpiresAt: expect.any(Date),
        }));
    });

    it('returns a generic error and logs a redacted diagnostic when finalization fails', async () => {
        resolveRoomPrincipal.mockResolvedValue({ ok: true, principal });
        finalizeRoomTokenIssue.mockRejectedValue(
            new Error('transaction failed at postgresql://worker:private@db.example/token'),
        );
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            const { GET } = await import('../route');
            const response = await GET(
                createRequest('/api/scheduled-sessions/event-1/token', {
                    headers: { cookie: 'hb_session=cookie-value' },
                }),
                mockParams({ id: 'event-1' }),
            );
            const { status, body } = await parseResponse(response);

            expect(status).toBe(500);
            expect(body).toEqual({ error: 'Unable to issue room token' });
            expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[REDACTED]'));
            expect(consoleError).not.toHaveBeenCalledWith(expect.stringContaining('private'));
        } finally {
            consoleError.mockRestore();
        }
    });
});
