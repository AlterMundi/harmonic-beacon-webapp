import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
    resolveRoomViewer: vi.fn(),
    observeLivePresence: vi.fn(),
    closeLivePresence: vi.fn(),
}));
vi.mock('@/lib/room-entitlement', () => ({ resolveRoomViewer: mocks.resolveRoomViewer }));
vi.mock('@/lib/live-presence', () => ({
    observeLivePresence: mocks.observeLivePresence,
    closeLivePresence: mocks.closeLivePresence,
}));

import { POST } from '../route';

const request = (body: unknown) => new NextRequest('https://live.harmonicbeacon.com/api/scheduled-sessions/event-1/presence', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
});

describe('Live presence heartbeat', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.resolveRoomViewer.mockResolvedValue({
            ok: true,
            principal: { identity: 'opaque-person', session: { maxPublishers: 6 } },
        });
    });

    it('derives identity and time server-side', async () => {
        const response = await POST(request({ state: 'connected', reconnect: true }), { params: Promise.resolve({ id: 'event-1' }) });
        expect(response.status).toBe(202);
        expect(mocks.observeLivePresence).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1', participantIdentity: 'opaque-person', reconnect: true,
        });
        await expect(response.json()).resolves.toEqual({ accepted: true, maxPublishers: 6 });
    });

    it('returns authoritative 6→9→12 capacity changes on the existing heartbeat surface', async () => {
        for (const maxPublishers of [6, 9, 12] as const) {
            mocks.resolveRoomViewer.mockResolvedValueOnce({
                ok: true,
                principal: { identity: 'opaque-person', session: { maxPublishers } },
            });
            const response = await POST(
                request({ state: 'connected' }),
                { params: Promise.resolve({ id: 'event-1' }) },
            );
            await expect(response.json()).resolves.toMatchObject({ maxPublishers });
        }
        expect(mocks.observeLivePresence).toHaveBeenCalledTimes(3);
    });

    it('closes only the authenticated principal and rejects client duration', async () => {
        const invalid = await POST(request({ state: 'connected', duration: 999999 }), { params: Promise.resolve({ id: 'event-1' }) });
        expect(invalid.status).toBe(400);
        expect(mocks.observeLivePresence).not.toHaveBeenCalled();
        await POST(request({ state: 'left' }), { params: Promise.resolve({ id: 'event-1' }) });
        expect(mocks.closeLivePresence).toHaveBeenCalledWith({
            scheduledSessionId: 'event-1', participantIdentity: 'opaque-person', reason: 'left',
        });
    });
});
