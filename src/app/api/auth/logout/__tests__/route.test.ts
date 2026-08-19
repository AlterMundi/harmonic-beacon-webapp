import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRequest, parseResponse } from '@/__tests__/helpers';
import { digestSessionToken } from '@/lib/session-auth';

const TOKEN = 'opaque-cookie-value-for-tests';

function mountDb(updateMany = vi.fn().mockResolvedValue({ count: 1 })) {
    const prisma = { webSession: { updateMany } };
    vi.doMock('@/lib/db', () => ({ prisma, default: prisma }));
    return updateMany;
}

function logoutRequest(cookie?: string) {
    return createRequest('/api/auth/logout', {
        method: 'POST',
        headers: {
            origin: 'https://live-staging.harmonicbeacon.com',
            'sec-fetch-site': 'same-origin',
            ...(cookie ? { cookie: `hb_session=${cookie}` } : {}),
        },
    });
}

function sessionCookieOf(response: Response) {
    return (response as unknown as {
        cookies: { get(name: string): { value: string; maxAge?: number } | undefined };
    }).cookies.get('hb_session');
}

describe('POST /api/auth/logout', () => {
    beforeEach(() => {
        vi.resetModules();
        process.env.TICKET_LOGIN_URL_PREFIX = 'https://live-staging.harmonicbeacon.com';
    });

    afterEach(() => {
        vi.doUnmock('@/lib/db');
        vi.doUnmock('@/lib/principal');
        vi.doUnmock('@/lib/account-rp');
        vi.restoreAllMocks();
        delete process.env.TICKET_LOGIN_URL_PREFIX;
    });

    it('revokes the session row and clears the cookie', async () => {
        const updateMany = mountDb();
        const { POST } = await import('../route');

        const response = await POST(logoutRequest(TOKEN));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(body).toEqual({ ok: true });

        // Server-side revocation is the part that matters: the cookie alone is the
        // credential, so clearing the browser copy is not enough.
        expect(updateMany).toHaveBeenCalledWith({
            where: { tokenDigest: digestSessionToken(TOKEN), revokedAt: null },
            data: { revokedAt: expect.any(Date), revocationReason: 'logout' },
        });

        expect(sessionCookieOf(response)).toMatchObject({
            value: '',
            maxAge: 0,
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
            path: '/',
        });
    });

    it('answers the same way for a cookie that names nothing', async () => {
        const updateMany = mountDb(vi.fn().mockResolvedValue({ count: 0 }));
        const { POST } = await import('../route');

        const known = await POST(logoutRequest(TOKEN));
        const unknown = await POST(logoutRequest('never-issued-token-value'));

        // Logout must not become a way to test whether a session token is real.
        expect(unknown.status).toBe(known.status);
        expect(await unknown.json()).toEqual(await known.json());
        expect(updateMany).toHaveBeenCalledTimes(2);
    });

    it('succeeds with no cookie at all and does not query the database', async () => {
        const updateMany = mountDb();
        const { POST } = await import('../route');

        const response = await POST(logoutRequest());

        expect(response.status).toBe(200);
        expect(updateMany).not.toHaveBeenCalled();
        expect(sessionCookieOf(response)).toMatchObject({ value: '', maxAge: 0 });
    });

    it('still clears the cookie when the database is unreachable', async () => {
        mountDb(vi.fn().mockRejectedValue(new Error('connection refused')));
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { POST } = await import('../route');

        const response = await POST(logoutRequest(TOKEN));

        // Someone walking away from a borrowed device must not be left apparently
        // signed in because of a database blip.
        expect(response.status).toBe(200);
        expect(sessionCookieOf(response)).toMatchObject({ value: '', maxAge: 0 });
        expect(error).toHaveBeenCalled();
        expect(String(error.mock.calls[0][0])).not.toContain(TOKEN);
    });

    it('returns a signed current-session Account logout initiation bound to the exact sid', async () => {
        const accountLogoutUrl = vi.fn().mockResolvedValue(
            'https://account-staging.harmonicbeacon.com/account/logout?initiation=signed',
        );
        const revokeWebSessionByToken = vi.fn().mockResolvedValue(undefined);
        vi.doMock('@/lib/principal', () => ({
            accountIdentityFromToken: vi.fn().mockResolvedValue({
                issuer: 'https://account-staging.harmonicbeacon.com',
                subject: 'central-subject',
                sessionId: 'central-sid',
            }),
            revokeWebSessionByToken,
            clearedSessionCookie: () => ({
                name: 'hb_session', value: '', maxAge: 0, httpOnly: true,
                secure: true, sameSite: 'lax' as const, path: '/',
            }),
        }));
        vi.doMock('@/lib/account-rp', () => ({
            beaconAccountEnabled: () => true,
            trustedLiveRequestOrigin: () => 'https://live-staging.harmonicbeacon.com',
            revokeAllAccountSessions: vi.fn(),
            accountLogoutUrl,
        }));
        const { POST } = await import('../route');

        const response = await POST(logoutRequest(TOKEN));

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            ok: true,
            issuerLogoutUrl: 'https://account-staging.harmonicbeacon.com/account/logout?initiation=signed',
        });
        expect(revokeWebSessionByToken).toHaveBeenCalledWith(TOKEN);
        expect(accountLogoutUrl).toHaveBeenCalledWith({
            origin: 'https://live-staging.harmonicbeacon.com',
            sessionId: 'central-sid',
            mode: 'current',
        });
    });

    it.each([
        ['missing Origin', { 'sec-fetch-site': 'same-origin' }],
        ['sibling Origin', { origin: 'https://account-staging.harmonicbeacon.com', 'sec-fetch-site': 'same-origin' }],
        ['cross-site fetch metadata', { origin: 'https://live-staging.harmonicbeacon.com', 'sec-fetch-site': 'cross-site' }],
    ])('rejects %s before reading or revoking the session', async (_label, headers) => {
        const updateMany = mountDb();
        const { POST } = await import('../route');
        const request = createRequest('/api/auth/logout', {
            method: 'POST',
            headers: { ...headers, cookie: `hb_session=${TOKEN}` },
        });

        const response = await POST(request);

        expect(response.status).toBe(403);
        expect(updateMany).not.toHaveBeenCalled();
        expect(sessionCookieOf(response)).toBeUndefined();
    });
});
