import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authHandler = vi.hoisted(() => vi.fn());
const getSession = vi.hoisted(() => vi.fn());
const transaction = vi.hoisted(() => vi.fn());
const revokeAccountSession = vi.hoisted(() => vi.fn());
const userFindUnique = vi.hoisted(() => vi.fn());
const sessionFindUnique = vi.hoisted(() => vi.fn());
const sessionDeleteMany = vi.hoisted(() => vi.fn());
vi.mock('@/lib/account/auth', () => ({
    accountAuth: () => ({ handler: authHandler, api: { getSession } }),
}));
vi.mock('@/lib/account/authority-db', () => ({ accountAuthorityDatabaseReady: () => true }));
vi.mock('@/lib/account/revocation', () => ({ revokeAccountSession }));
vi.mock('@/lib/account/rate-limit', () => ({ consumeAccountRateLimit: () => true }));
vi.mock('@/lib/db', () => ({
    prisma: {
        $transaction: transaction,
        earlyBirdAuthSession: { findUnique: sessionFindUnique, deleteMany: sessionDeleteMany },
        earlyBirdUser: { findUnique: userFindUnique },
    },
}));

import { POST } from './route';
import { GET } from './route';

const origin = 'https://account.harmonicbeacon.com';
const secret = 'complete-client-secret-at-least-thirty-two-characters';
const basic = `Basic ${Buffer.from(`hb-listener:${secret}`).toString('base64')}`;

function tokenRequest(body: Record<string, string>, authorization?: string) {
    return new Request(`${origin}/api/account/auth/oauth2/token`, {
        method: 'POST',
        headers: {
            host: 'account.harmonicbeacon.com',
            'content-type': 'application/x-www-form-urlencoded',
            ...(authorization ? { authorization } : {}),
        },
        body: new URLSearchParams(body),
    });
}

describe('Account catch-all route confidential OAuth boundary', () => {
    beforeEach(() => {
        vi.stubEnv('BEACON_ACCOUNT_BASE_URL', origin);
        vi.stubEnv('BEACON_ACCOUNT_RATE_SECRET', 'route-test-rate-secret-at-least-thirty-two-characters');
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER', secret);
        getSession.mockResolvedValue(null);
        authHandler.mockResolvedValue(Response.json({ access_token: 'opaque' }));
        transaction.mockImplementation(async (callback) => callback({}));
        revokeAccountSession.mockResolvedValue(undefined);
        sessionDeleteMany.mockResolvedValue({ count: 0 });
    });
    afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

    it('forwards an exact client_secret_basic token request', async () => {
        const response = await POST(tokenRequest({
            grant_type: 'authorization_code', code: 'code', redirect_uri: 'https://listen.harmonicbeacon.com/api/account/callback',
        }, basic));
        expect(response.status).toBe(200);
        expect(authHandler).toHaveBeenCalledOnce();
    });

    it('rejects body client secrets and unauthenticated requests before Better Auth', async () => {
        for (const request of [
            tokenRequest({ client_id: 'hb-listener', client_secret: secret }),
            tokenRequest({ grant_type: 'authorization_code' }),
            tokenRequest({ client_secret: secret }, basic),
        ]) expect((await POST(request)).status).toBe(404);
        expect(authHandler).not.toHaveBeenCalled();
    });

    it('preserves every Better Auth cookie and validates the exact host-only session cookie', async () => {
        const headers = new Headers({ 'Content-Type': 'application/json' });
        headers.append('Set-Cookie', '__Host-hb_account_session=opaque-session; Path=/; HttpOnly; Secure; SameSite=Lax');
        headers.append('Set-Cookie', 'hb_account_auxiliary=opaque-state; Path=/; HttpOnly; Secure; SameSite=Lax');
        authHandler.mockResolvedValueOnce(Response.json({ redirect: false }, { headers }));
        userFindUnique.mockResolvedValueOnce({ id: 'account-1', securityRevision: 3 });
        getSession
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ user: { id: 'account-1' }, session: { id: 'session-1' } });
        transaction.mockImplementationOnce(async (callback) => callback({
            $queryRaw: vi.fn(),
            earlyBirdAuthSession: {
                findUnique: vi.fn().mockResolvedValue({
                    id: 'session-1', userId: 'account-1', securityRevision: 3,
                    user: { securityRevision: 3 },
                }),
                deleteMany: vi.fn(),
            },
        }));

        const response = await POST(new Request(`${origin}/api/account/auth/sign-in/email`, {
            method: 'POST',
            headers: {
                host: 'account.harmonicbeacon.com', origin,
                'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
            },
            body: JSON.stringify({ email: 'listener@example.invalid', password: '12345678' }),
        }));

        expect(response.status).toBe(200);
        expect(response.headers.getSetCookie()).toEqual([
            '__Host-hb_account_session=opaque-session; Path=/; HttpOnly; Secure; SameSite=Lax',
            'hb_account_auxiliary=opaque-state; Path=/; HttpOnly; Secure; SameSite=Lax',
        ]);
        expect(response.headers.getSetCookie().join('\n')).not.toContain('__Secure-__Host-');
        expect(getSession.mock.calls[1]?.[0]?.headers.get('cookie'))
            .toBe('__Host-hb_account_session=opaque-session');
    });

    it('rejects an unforwardable successful sign-in and removes only its exact new session token', async () => {
        const headers = new Headers();
        headers.append('Set-Cookie', '__Host-hb_account_session=newly-created-session-token.signature; Path=/; HttpOnly; Secure; SameSite=Lax');
        authHandler.mockResolvedValueOnce(Response.json({
            token: 'newly-created-session-token', redirect: false,
        }, { headers }));
        userFindUnique.mockResolvedValueOnce({ id: 'account-1', securityRevision: 3 });
        getSession.mockResolvedValueOnce(null);

        const response = await POST(new Request(`${origin}/api/account/auth/sign-in/email`, {
            method: 'POST',
            headers: {
                host: 'account.harmonicbeacon.com', origin,
                'sec-fetch-site': 'same-origin', 'content-type': 'application/json',
            },
            body: JSON.stringify({ email: 'listener@example.invalid', password: '12345678' }),
        }));

        expect(response.status).toBe(401);
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(sessionDeleteMany).toHaveBeenCalledOnce();
        expect(sessionDeleteMany).toHaveBeenCalledWith({
            where: { token: 'newly-created-session-token' },
        });
        expect(sessionDeleteMany).not.toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ userId: 'account-1' }),
        }));
    });

    it('wraps verified end-session success in a signed exact frontchannel redirect', async () => {
        const payload = Buffer.from(JSON.stringify({
            iss: origin, aud: 'hb-listener', sid: 'central-sid',
        })).toString('base64url');
        const query = new URLSearchParams({
            id_token_hint: `header.${payload}.signature`, client_id: 'hb-listener',
            post_logout_redirect_uri: 'https://listen.harmonicbeacon.com/api/account/frontchannel-logout',
            state: 'bounded_logout_state_1234',
        });
        authHandler.mockResolvedValueOnce(new Response(null, { status: 204 }));
        const response = await GET(new Request(
            `${origin}/api/account/auth/oauth2/end-session?${query}`,
            { headers: { host: 'account.harmonicbeacon.com' } },
        ));
        expect(response.status).toBe(302);
        const location = new URL(response.headers.get('location')!);
        expect(location.origin + location.pathname)
            .toBe('https://listen.harmonicbeacon.com/api/account/frontchannel-logout');
        expect(location.searchParams.get('logout_token')).toBeTruthy();
        expect(location.searchParams.get('state')).toBe('bounded_logout_state_1234');
        expect(revokeAccountSession).toHaveBeenCalledWith({}, 'central-sid');
    });

    it('does not issue a signed frontchannel redirect when authoritative revocation fails', async () => {
        const payload = Buffer.from(JSON.stringify({
            iss: origin, aud: 'hb-listener', sid: 'central-sid',
        })).toString('base64url');
        const query = new URLSearchParams({
            id_token_hint: `header.${payload}.signature`, client_id: 'hb-listener',
            post_logout_redirect_uri: 'https://listen.harmonicbeacon.com/api/account/frontchannel-logout',
            state: 'bounded_logout_state_1234',
        });
        authHandler.mockResolvedValueOnce(new Response(null, { status: 204 }));
        transaction.mockRejectedValueOnce(new Error('database unavailable'));

        const response = await GET(new Request(
            `${origin}/api/account/auth/oauth2/end-session?${query}`,
            { headers: { host: 'account.harmonicbeacon.com' } },
        ));
        expect(response.status).toBe(503);
        expect(response.headers.get('location')).toBeNull();
    });
});
