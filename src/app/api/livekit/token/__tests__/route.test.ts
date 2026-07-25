import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NextResponse } from 'next/server';
import { parseResponse } from '@/__tests__/helpers';

const mockAddGrant = vi.fn();
const mockToJwt = vi.fn().mockResolvedValue('mock-jwt-token');

vi.mock('livekit-server-sdk', () => ({
    AccessToken: vi.fn(function (this: Record<string, unknown>) {
        this.addGrant = mockAddGrant;
        this.toJwt = mockToJwt;
    }),
}));

/** Authenticate the caller. Without this the route now returns 401. */
function mockAuthed() {
    vi.doMock('@/lib/auth', () => ({
        requireAuth: vi.fn().mockResolvedValue([
            { user: { id: 'zitadel-sub-1', email: 'listener@example.com', role: 'USER' } },
            null,
        ]),
    }));
}

describe('GET /api/livekit/token', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        mockAddGrant.mockClear();
        mockToJwt.mockClear();
        mockToJwt.mockResolvedValue('mock-jwt-token');
        mockAuthed();
    });

    afterEach(() => {
        process.env = { ...originalEnv };
    });

    it('returns token, identity, and room on success', async () => {
        process.env.LIVEKIT_API_KEY = 'test-api-key';
        process.env.LIVEKIT_API_SECRET = 'test-api-secret';
        process.env.LIVEKIT_ROOM_NAME = 'test-room';

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { token: string; identity: string; room: string };

        expect(data.token).toBe('mock-jwt-token');
        expect(data.identity).toBeDefined();
        expect(data.room).toBe('test-room');
    });

    it('returns 500 when LIVEKIT env vars are missing', async () => {
        delete process.env.LIVEKIT_API_KEY;
        delete process.env.LIVEKIT_API_SECRET;

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(500);
        const data = body as { error: string };
        expect(data.error).toMatch(/not configured/i);
    });

    it('generates identity starting with listener-', async () => {
        process.env.LIVEKIT_API_KEY = 'test-api-key';
        process.env.LIVEKIT_API_SECRET = 'test-api-secret';

        const { GET } = await import('../route');
        const response = await GET();
        const { body } = await parseResponse(response);
        const data = body as { identity: string };

        expect(data.identity).toMatch(/^listener-/);
    });

    it('returns 401 when unauthenticated', async () => {
        // The regression this route existed with: anyone could mint a token for
        // the beacon room without a session. Credentials against a third-party
        // service, issued to whoever asked.
        process.env.LIVEKIT_API_KEY = 'test-api-key';
        process.env.LIVEKIT_API_SECRET = 'test-api-secret';

        vi.doMock('@/lib/auth', () => ({
            requireAuth: vi.fn().mockResolvedValue([
                null,
                NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
            ]),
        }));

        const { GET } = await import('../route');
        const { status } = await parseResponse(await GET());

        expect(status).toBe(401);
        expect(mockToJwt).not.toHaveBeenCalled();
    });

    it('does not embed a user identifier in the participant identity', async () => {
        // Identities are visible to every other participant in the room. A
        // stable per-user identity would let listeners recognise each other
        // across sessions, which the shared-presence model does not intend.
        process.env.LIVEKIT_API_KEY = 'test-api-key';
        process.env.LIVEKIT_API_SECRET = 'test-api-secret';

        const { GET } = await import('../route');
        const { body } = await parseResponse(await GET());
        const data = body as { identity: string };

        expect(data.identity).not.toContain('zitadel-sub-1');
        expect(data.identity).not.toContain('listener@example.com');
    });

    it('mints two different identities across calls', async () => {
        // Same identity twice would evict a listener's other tab: LiveKit
        // disconnects an existing connection when the identity rejoins.
        process.env.LIVEKIT_API_KEY = 'test-api-key';
        process.env.LIVEKIT_API_SECRET = 'test-api-secret';

        const { GET } = await import('../route');
        const first = (await parseResponse(await GET())).body as { identity: string };
        const second = (await parseResponse(await GET())).body as { identity: string };

        expect(first.identity).not.toBe(second.identity);
    });

    it('grants subscribe-only access, never publish', async () => {
        process.env.LIVEKIT_API_KEY = 'test-api-key';
        process.env.LIVEKIT_API_SECRET = 'test-api-secret';

        const { GET } = await import('../route');
        await GET();

        expect(mockAddGrant).toHaveBeenCalledWith(
            expect.objectContaining({ canPublish: false, canSubscribe: true }),
        );
    });
});
