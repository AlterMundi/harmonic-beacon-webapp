import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { accountRequestAllowed } from '@/lib/account/request-boundary';

const origin = 'https://account.harmonicbeacon.com';
const secret = 'complete-client-secret-at-least-thirty-two-characters';
const basic = `Basic ${Buffer.from(`hb-listener:${secret}`).toString('base64')}`;

function form(path: 'token' | 'introspect' | 'revoke', body: Record<string, string>, authorization?: string) {
    return new Request(`${origin}/api/account/auth/oauth2/${path}`, {
        method: 'POST',
        headers: {
            host: 'account.harmonicbeacon.com',
            'content-type': 'application/x-www-form-urlencoded',
            ...(authorization ? { authorization } : {}),
        },
        body: new URLSearchParams(body),
    });
}

describe('Account OAuth confidential-client request boundary', () => {
    beforeEach(() => {
        vi.stubEnv('BEACON_ACCOUNT_BASE_URL', origin);
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER', secret);
    });
    afterEach(() => vi.unstubAllEnvs());

    it.each(['token', 'introspect', 'revoke'] as const)(
        'accepts client_secret_basic and rejects client_secret_post at %s', async (path) => {
            await expect(accountRequestAllowed(form(path, { token: 'opaque' }, basic))).resolves.toBe(true);
            await expect(accountRequestAllowed(form(path, {
                token: 'opaque', client_id: 'hb-listener', client_secret: secret,
            }))).resolves.toBe(false);
            await expect(accountRequestAllowed(form(path, {
                token: 'opaque', client_secret: secret,
            }, basic))).resolves.toBe(false);
        },
    );

    it('rejects a body client id that conflicts with the Basic principal', async () => {
        await expect(accountRequestAllowed(form('token', {
            client_id: 'hb-live', grant_type: 'authorization_code',
        }, basic))).resolves.toBe(false);
    });

    it('uses an explicit Better Auth route/method allowlist', async () => {
        const request = (path: string, method = 'POST') => new Request(`${origin}${path}`, {
            method,
            headers: { host: 'account.harmonicbeacon.com', 'content-type': 'application/json' },
            ...(method === 'POST' ? { body: '{}' } : {}),
        });
        for (const [path, method] of [
            ['/api/account/auth/sign-up/email', 'POST'],
            ['/api/account/auth/sign-in/email', 'POST'],
            ['/api/account/auth/sign-in/social', 'POST'],
            ['/api/account/auth/callback/google', 'GET'],
            ['/api/account/auth/callback/apple', 'POST'],
        ]) await expect(accountRequestAllowed(request(path, method))).resolves.toBe(true);

        for (const [path, method] of [
            ['/api/account/auth/sign-out', 'POST'],
            ['/api/account/auth/update-user', 'POST'],
            ['/api/account/auth/list-sessions', 'GET'],
            ['/api/account/auth/revoke-session', 'POST'],
            ['/api/account/auth/revoke-sessions', 'POST'],
            ['/api/account/auth/revoke-other-sessions', 'POST'],
            ['/api/account/auth/change-email', 'POST'],
            ['/api/account/auth/change-password', 'POST'],
            ['/api/account/auth/request-password-reset', 'POST'],
            ['/api/account/auth/reset-password', 'POST'],
            ['/api/account/auth/verify-email', 'GET'],
            ['/api/account/auth/get-session', 'GET'],
            ['/api/account/auth/sign-up/email', 'GET'],
        ]) await expect(accountRequestAllowed(request(path, method))).resolves.toBe(false);
    });

    it('trusts only the exact Account origin for browser credential requests', async () => {
        vi.stubEnv('BEACON_ACCOUNT_TRUSTED_ORIGINS',
            'https://listen.harmonicbeacon.com,https://live.harmonicbeacon.com');
        const { accountTrustedOrigins } = await import('@/lib/account/config');
        expect(accountTrustedOrigins()).toEqual([origin]);
    });

    it('admits end-session only for an exact static client, signed-token shape and registered return', async () => {
        const payload = Buffer.from(JSON.stringify({
            iss: origin, aud: 'hb-listener', sid: 'central-sid',
        })).toString('base64url');
        const token = `header.${payload}.signature`;
        const query = new URLSearchParams({
            id_token_hint: token,
            client_id: 'hb-listener',
            post_logout_redirect_uri: 'https://listen.harmonicbeacon.com/api/account/frontchannel-logout',
            state: 'bounded_logout_state_1234',
        });
        const request = (value: URLSearchParams) => new Request(
            `${origin}/api/account/auth/oauth2/end-session?${value}`,
            { headers: { host: 'account.harmonicbeacon.com' } },
        );
        await expect(accountRequestAllowed(request(query))).resolves.toBe(true);
        for (const [key, value] of [
            ['client_id', 'hb-live'],
            ['post_logout_redirect_uri', 'https://evil.example/logout'],
            ['state', 'short'],
        ]) {
            const changed = new URLSearchParams(query); changed.set(key, value);
            await expect(accountRequestAllowed(request(changed))).resolves.toBe(false);
        }
        const extra = new URLSearchParams(query); extra.set('unexpected', '1');
        await expect(accountRequestAllowed(request(extra))).resolves.toBe(false);
    });
});
