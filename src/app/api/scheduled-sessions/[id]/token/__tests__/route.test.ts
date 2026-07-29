import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

const resolveRoomPrincipal = vi.fn();
const createSessionToken = vi.fn();

vi.mock('@/lib/room-entitlement', () => ({ resolveRoomPrincipal }));
vi.mock('@/lib/livekit-server', () => ({ createSessionToken }));

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
    canPublish: false,
};

describe('GET /api/scheduled-sessions/[id]/token', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        createSessionToken.mockResolvedValue('stage-jwt');
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
            createRequest('/api/scheduled-sessions/event-1/token'),
            mockParams({ id: 'event-1' }),
        );

        expect((await parseResponse(response)).status).toBe(status);
        expect(createSessionToken).not.toHaveBeenCalled();
    });

    it('issues the exact event room and stable subscribe-only identity', async () => {
        resolveRoomPrincipal.mockResolvedValue({ ok: true, principal });

        const { GET } = await import('../route');
        const { status, body } = await parseResponse(await GET(
            createRequest('/api/scheduled-sessions/event-1/token'),
            mockParams({ id: 'event-1' }),
        ));

        expect(status).toBe(200);
        expect(createSessionToken).toHaveBeenCalledWith(
            'weekend-stage',
            'event-stable-opaque',
            'Attendee',
            false,
        );
        expect(body).toMatchObject({
            token: 'stage-jwt',
            identity: 'event-stable-opaque',
            room: 'weekend-stage',
            canPublish: false,
        });
        expect(JSON.stringify(body)).not.toMatch(/email|ticket/i);
    });

    it('preserves a current facilitator or promoted grant', async () => {
        resolveRoomPrincipal.mockResolvedValue({
            ok: true,
            principal: {
                ...principal,
                displayName: 'Facilitator',
                canPublish: true,
            },
        });

        const { GET } = await import('../route');
        await GET(
            createRequest('/api/scheduled-sessions/event-1/token'),
            mockParams({ id: 'event-1' }),
        );

        expect(createSessionToken).toHaveBeenCalledWith(
            'weekend-stage',
            'event-stable-opaque',
            'Facilitator',
            true,
        );
    });
});
