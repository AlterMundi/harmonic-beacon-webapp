import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolveRoomPrincipal = vi.fn();
vi.mock('@/lib/room-entitlement', () => ({ resolveRoomPrincipal }));

function frameRequest(body = new Uint8Array([1, 2, 3])) {
    return new NextRequest('http://localhost/api/tapestry/frame?sessionId=session-1', {
        method: 'POST', headers: { 'content-type': 'image/jpeg' }, body,
    });
}

describe('POST /api/tapestry/frame', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        process.env.TAPESTRY_INTERNAL_URL = 'http://tapestry:3100';
        process.env.TAPESTRY_INTERNAL_SECRET = 'test-secret-at-least-16-chars';
        resolveRoomPrincipal.mockResolvedValue({ ok: true, principal: { identity: 'event-livekit-identity' } });
        global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    });

    it('checks current event access and sends only a derived contributor key internally', async () => {
        const { POST } = await import('../route');
        const response = await POST(frameRequest());

        expect(response.status).toBe(204);
        expect(resolveRoomPrincipal).toHaveBeenCalledWith(expect.anything(), 'session-1');
        const [url, init] = vi.mocked(fetch).mock.calls[0];
        expect(String(url)).toContain('/sessions/session-1/participants/tp-');
        expect(String(url)).not.toContain('event-livekit-identity');
        expect((init?.headers as Record<string, string>)['content-type']).toBe('image/jpeg');
        expect((init?.headers as Record<string, string>)['x-tapestry-internal-secret']).toBe(process.env.TAPESTRY_INTERNAL_SECRET);
    });

    it('does not contact the tapestry for an unauthorised request', async () => {
        resolveRoomPrincipal.mockResolvedValue({ ok: false, status: 403, error: 'Not authorized' });
        const { POST } = await import('../route');
        expect((await POST(frameRequest())).status).toBe(403);
        expect(fetch).not.toHaveBeenCalled();
    });

    it('rejects non-JPEG data before reading or proxying it', async () => {
        const { POST } = await import('../route');
        const response = await POST(new NextRequest('http://localhost/api/tapestry/frame?sessionId=session-1', { method: 'POST', body: 'x' }));
        expect(response.status).toBe(415);
        expect(resolveRoomPrincipal).not.toHaveBeenCalled();
    });
});
