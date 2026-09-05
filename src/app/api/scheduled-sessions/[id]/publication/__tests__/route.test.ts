import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

const mocks = vi.hoisted(() => ({
    resolveRoomPrincipal: vi.fn(),
    activateRoomPublication: vi.fn(),
}));

vi.mock('@/lib/room-entitlement', () => ({
    resolveRoomPrincipal: mocks.resolveRoomPrincipal,
}));
vi.mock('@/lib/room-token-issue', () => ({
    activateRoomPublication: mocks.activateRoomPublication,
}));

const principal = {
    session: {
        id: 'event-1',
        title: 'Event',
        roomName: 'event-room',
        status: 'LIVE',
        startedAt: new Date(),
    },
    identity: 'identity-current',
    displayName: 'Facilitator',
    role: 'FACILITATOR',
    isAssignedFacilitator: true,
    canPublish: true,
    ticketEntitlementId: null,
    staffUserId: 'staff-1',
};

describe('POST /api/scheduled-sessions/[id]/publication', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveRoomPrincipal.mockResolvedValue({ ok: true, principal });
        mocks.activateRoomPublication.mockResolvedValue(true);
    });

    it('activates only the resolved current identity', async () => {
        const { POST } = await import('../route');
        const response = await POST(
            createRequest('/api/scheduled-sessions/event-1/publication', {
                method: 'POST',
                headers: { cookie: 'hb_session=current-cookie' },
            }),
            mockParams({ id: 'event-1' }),
        );

        expect(await parseResponse(response)).toEqual({
            status: 200,
            body: { canPublish: true },
        });
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(mocks.activateRoomPublication).toHaveBeenCalledWith({
            cookieValue: 'current-cookie',
            principal,
            expectedIdentity: 'identity-current',
        });
    });

    it('fails closed for audience or a retired identity observed during revalidation', async () => {
        const { POST } = await import('../route');
        mocks.resolveRoomPrincipal.mockResolvedValueOnce({
            ok: true,
            principal: { ...principal, canPublish: false },
        });
        const audience = await POST(
            createRequest('/api/scheduled-sessions/event-1/publication', {
                method: 'POST',
                headers: { cookie: 'hb_session=current-cookie' },
            }),
            mockParams({ id: 'event-1' }),
        );
        expect(audience.status).toBe(403);
        expect(mocks.activateRoomPublication).not.toHaveBeenCalled();

        mocks.activateRoomPublication.mockResolvedValueOnce(false);
        const rotated = await POST(
            createRequest('/api/scheduled-sessions/event-1/publication', {
                method: 'POST',
                headers: { cookie: 'hb_session=current-cookie' },
            }),
            mockParams({ id: 'event-1' }),
        );
        expect(rotated.status).toBe(403);
    });

    it('does not leak a LiveKit or database error', async () => {
        mocks.activateRoomPublication.mockRejectedValue(
            new Error('rpc postgresql://worker:private@internal.example/token'),
        );
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            const { POST } = await import('../route');
            const { status, body } = await parseResponse(await POST(
                createRequest('/api/scheduled-sessions/event-1/publication', {
                    method: 'POST',
                    headers: { cookie: 'hb_session=current-cookie' },
                }),
                mockParams({ id: 'event-1' }),
            ));
            expect(status).toBe(502);
            expect(body).toEqual({ error: 'Unable to activate publication' });
            expect(consoleError).toHaveBeenCalledWith(expect.stringContaining('[REDACTED]'));
        } finally {
            consoleError.mockRestore();
        }
    });
});
