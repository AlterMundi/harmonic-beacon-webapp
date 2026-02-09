import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseResponse } from '@/__tests__/helpers';

const mockAddGrant = vi.fn();
const mockToJwt = vi.fn().mockResolvedValue('mock-jwt-token');

vi.mock('livekit-server-sdk', () => ({
    AccessToken: vi.fn(function (this: Record<string, unknown>) {
        this.addGrant = mockAddGrant;
        this.toJwt = mockToJwt;
    }),
}));

describe('GET /api/livekit/token', () => {
    const originalEnv = { ...process.env };

    beforeEach(() => {
        vi.resetModules();
        mockAddGrant.mockClear();
        mockToJwt.mockClear();
        mockToJwt.mockResolvedValue('mock-jwt-token');
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
});
