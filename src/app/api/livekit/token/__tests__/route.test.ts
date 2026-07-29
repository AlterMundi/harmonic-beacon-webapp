import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, parseResponse } from '@/__tests__/helpers';

const resolveRoomPrincipal = vi.fn();
const bedRoomIdentity = vi.fn().mockReturnValue('bed-opaque');
const createBedToken = vi.fn().mockResolvedValue('bed-jwt');

vi.mock('@/lib/room-entitlement', () => ({ resolveRoomPrincipal }));
vi.mock('@/lib/livekit-server', () => ({
    bedRoomIdentity,
    createBedToken,
}));

describe('GET /api/livekit/token', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('requires an event scope before resolving authorization', async () => {
        const { GET } = await import('../route');
        const { status, body } = await parseResponse(
            await GET(createRequest('/api/livekit/token')),
        );

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'sessionId is required' });
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
        expect(createBedToken).not.toHaveBeenCalled();
    });

    it('issues only the configured beacon room with a non-PII identity', async () => {
        resolveRoomPrincipal.mockResolvedValue({
            ok: true,
            principal: { identity: 'event-stage-opaque' },
        });

        const { GET } = await import('../route');
        const { status, body } = await parseResponse(await GET(
            createRequest('/api/livekit/token', {
                searchParams: { sessionId: 'event-1' },
            }),
        ));

        expect(status).toBe(200);
        expect(resolveRoomPrincipal).toHaveBeenCalledWith(
            expect.anything(),
            'event-1',
        );
        expect(bedRoomIdentity).toHaveBeenCalledWith('event-stage-opaque');
        expect(createBedToken).toHaveBeenCalledWith('beacon', 'bed-opaque');
        expect(body).toEqual({
            token: 'bed-jwt',
            identity: 'bed-opaque',
            room: 'beacon',
            canPublish: false,
        });
    });
});
