import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, parseResponse } from '@/__tests__/helpers';

const resolveRoomPrincipal = vi.fn();
const bedRoomIdentity = vi.fn().mockReturnValue('bed-opaque');
const createBedToken = vi.fn().mockResolvedValue('bed-jwt');
const finalizeRoomTokenIssue = vi.fn();

vi.mock('@/lib/room-entitlement', () => ({ resolveRoomPrincipal }));
vi.mock('@/lib/livekit-server', () => ({
    bedRoomIdentity,
    createBedToken,
}));
vi.mock('@/lib/commerce-entitlement', () => ({
    TICKET_LIVEKIT_TOKEN_TTL_SECONDS: 300,
}));
vi.mock('@/lib/room-token-issue', () => ({
    finalizeRoomTokenIssue,
    STAFF_LIVEKIT_TOKEN_TTL_SECONDS: 14_400,
}));

describe('GET /api/livekit/token', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        finalizeRoomTokenIssue.mockResolvedValue(true);
    });

    it('requires an event scope before resolving authorization', async () => {
        const { GET } = await import('../route');
        const response = await GET(createRequest('/api/livekit/token'));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'sessionId is required' });
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(resolveRoomPrincipal).not.toHaveBeenCalled();
    });

    it.each([
        ['no cookie', 401, 'Authentication required'],
        ['wrong-event or revoked ticket', 403, 'Not authorized'],
        ['ended event or unrelated staff', 403, 'Not authorized'],
    ])('never mints a bed token for %s', async (_case, status, error) => {
        resolveRoomPrincipal.mockResolvedValue({ ok: false, status, error });

        const { GET } = await import('../route');
        const response = await GET(
            createRequest('/api/livekit/token', {
                searchParams: { sessionId: 'event-1' },
            }),
        );

        expect((await parseResponse(response)).status).toBe(status);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(createBedToken).not.toHaveBeenCalled();
    });

    it('issues only the configured beacon room with a non-PII identity', async () => {
        resolveRoomPrincipal.mockResolvedValue({
            ok: true,
            principal: {
                identity: 'event-stage-opaque',
                ticketEntitlementId: null,
                staffUserId: 'staff-1',
                canPublish: true,
            },
        });

        const { GET } = await import('../route');
        const response = await GET(
            createRequest('/api/livekit/token', {
                searchParams: { sessionId: 'event-1' },
                headers: { cookie: 'hb_session=cookie-value' },
            }),
        );
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(resolveRoomPrincipal).toHaveBeenCalledWith(
            expect.anything(),
            'event-1',
        );
        expect(bedRoomIdentity).toHaveBeenCalledWith('event-stage-opaque');
        expect(createBedToken).toHaveBeenCalledWith('beacon', 'bed-opaque', '14400s');
        expect(body).toEqual({
            token: 'bed-jwt',
            identity: 'bed-opaque',
            room: 'beacon',
            canPublish: false,
        });
    });

    it('uses the same five-minute horizon for a ticket-backed bed token', async () => {
        resolveRoomPrincipal.mockResolvedValue({
            ok: true,
            principal: {
                identity: 'event-stage-opaque',
                ticketEntitlementId: 'ticket-1',
                staffUserId: null,
                canPublish: false,
            },
        });
        const { GET } = await import('../route');
        const response = await GET(createRequest('/api/livekit/token', {
            searchParams: { sessionId: 'event-1' },
            headers: { cookie: 'hb_session=cookie-value' },
        }));
        expect(response.status).toBe(200);
        expect(createBedToken).toHaveBeenCalledWith('beacon', 'bed-opaque', '300s');
        expect(finalizeRoomTokenIssue).toHaveBeenCalledWith(expect.objectContaining({
            cookieValue: 'cookie-value',
            expectedIdentity: 'event-stage-opaque',
            expectedCanPublish: false,
            tokenExpiresAt: expect.any(Date),
        }));
    });

    it('returns a generic error and logs a redacted diagnostic when finalization fails', async () => {
        resolveRoomPrincipal.mockResolvedValue({
            ok: true,
            principal: {
                identity: 'event-stage-opaque',
                ticketEntitlementId: 'ticket-1',
                staffUserId: null,
                canPublish: false,
            },
        });
        finalizeRoomTokenIssue.mockRejectedValue(
            new Error('transaction failed at postgresql://worker:private@db.example/token'),
        );
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        try {
            const { GET } = await import('../route');
            const response = await GET(createRequest('/api/livekit/token', {
                searchParams: { sessionId: 'event-1' },
                headers: { cookie: 'hb_session=cookie-value' },
            }));
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
