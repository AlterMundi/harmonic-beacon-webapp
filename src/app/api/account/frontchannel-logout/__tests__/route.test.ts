import { createHmac } from 'node:crypto';

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const updateSessions = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
    prisma: { webSession: { updateMany: updateSessions } },
}));

const ISSUER = 'https://account.harmonicbeacon.com';
const CLIENT_ID = 'hb-live';
const CLIENT_SECRET = 'live-client-secret-with-more-than-32-characters';

function logoutToken(overrides: Record<string, unknown> = {}): string {
    const now = Math.floor(Date.now() / 1_000);
    const payload = Buffer.from(JSON.stringify({
        v: 1,
        iss: ISSUER,
        aud: CLIENT_ID,
        sid: 'central-device-session',
        state: 'logout-state-that-is-opaque',
        iat: now,
        exp: now + 120,
        ...overrides,
    }), 'utf8').toString('base64url');
    const signature = createHmac('sha256', CLIENT_SECRET).update(payload, 'utf8').digest('base64url');
    return `${payload}.${signature}`;
}

function request(token = ''): NextRequest {
    const url = new URL('/api/account/frontchannel-logout', 'https://live.harmonicbeacon.com');
    if (token) url.searchParams.set('logout_token', token);
    return new NextRequest(url, { headers: { host: 'live.harmonicbeacon.com' } });
}

describe('GET /api/account/frontchannel-logout', () => {
    beforeEach(() => {
        updateSessions.mockReset().mockResolvedValue({ count: 1 });
        vi.stubEnv('BEACON_ACCOUNT_ENABLED', 'true');
        vi.stubEnv('BEACON_ACCOUNT_ISSUER_URL', ISSUER);
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_ID', CLIENT_ID);
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET', CLIENT_SECRET);
    });

    afterEach(() => vi.unstubAllEnvs());

    it('revokes only the issuer and sid authorized by the signed Account token', async () => {
        const { GET } = await import('../route');
        const response = await GET(request(logoutToken()));
        expect(response.status).toBe(200);
        expect(response.headers.get('content-security-policy')).toBe(
            "default-src 'none'; frame-ancestors https://account.harmonicbeacon.com",
        );
        expect(updateSessions).toHaveBeenCalledWith({
            where: {
                accountIssuer: ISSUER,
                accountSessionId: 'central-device-session',
                revokedAt: null,
            },
            data: {
                revokedAt: expect.any(Date),
                revocationReason: 'account_frontchannel_logout',
            },
        });
    });

    it.each([
        ['unsigned', ''],
        ['wrong audience', logoutToken({ aud: 'hb-live-staging' })],
        ['expired', logoutToken({ iat: 1, exp: 2 })],
    ])('rejects %s logout without touching a local session', async (_label, token) => {
        const { GET } = await import('../route');
        const response = await GET(request(token));
        expect(response.status).toBe(400);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(updateSessions).not.toHaveBeenCalled();
    });

    it('rejects a tampered signature without touching a local session', async () => {
        const { GET } = await import('../route');
        const valid = logoutToken();
        const [payload, signature] = valid.split('.');
        const tampered = `${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
        const response = await GET(request(tampered));
        expect(response.status).toBe(400);
        expect(updateSessions).not.toHaveBeenCalled();
    });
});
