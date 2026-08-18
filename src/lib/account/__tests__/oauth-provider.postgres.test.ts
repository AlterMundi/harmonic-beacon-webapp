import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const databaseURL = process.env.LISTENER_TEST_DATABASE_URL;
if (databaseURL) process.env.DATABASE_URL = databaseURL;
const postgres = databaseURL ? describe : describe.skip;
const issuer = 'https://account.harmonicbeacon.com';
const clientId = 'hb-listener';
const clientSecret = 'full-client-secret-value-with-more-than-32-characters';
const accountId = `oauth-handler-${randomUUID()}`;
const email = `${accountId}@example.invalid`;
const password = 'correct horse beacon battery staple';
let prisma: PrismaClient;
let handler: (request: Request) => Promise<Response>;
let accountRoutePOST: (request: Request) => Promise<Response>;
let currentAccountSession: typeof import('../auth').currentAccountSession;

function jsonRequest(path: string, body: unknown) {
    return new Request(`${issuer}${path}`, {
        method: 'POST',
        headers: { host: 'account.harmonicbeacon.com', origin: issuer, 'content-type': 'application/json' },
        body: JSON.stringify(body),
    });
}

postgres('pinned OAuth Provider 1.6.30 confidential-client lifecycle', () => {
    beforeAll(async () => {
        process.env.BEACON_ACCOUNT_BASE_URL = issuer;
        process.env.BEACON_ACCOUNT_AUTH_SECRET = 'handler-auth-secret-that-is-at-least-32-characters';
        process.env.BEACON_ACCOUNT_RATE_SECRET = 'handler-rate-secret-that-is-at-least-32-characters';
        process.env.BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER = clientSecret;
        process.env.BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE = `${clientSecret}-live`;
        ({ prisma } = await import('@/lib/db'));
        const { hashAccountPassword } = await import('@/lib/session-auth');
        const { hashAccountClientSecret } = await import('../client-secret');
        const { accountAuth } = await import('../auth');
        ({ currentAccountSession } = await import('../auth'));
        ({ POST: accountRoutePOST } = await import('@/app/api/account/auth/[...all]/route'));
        handler = accountAuth().handler;
        await prisma.beaconAccountAuthorityEnvironment.upsert({
            where: { id: 'authority' },
            create: { id: 'authority', issuer },
            update: { issuer },
        });
        await prisma.earlyBirdUser.create({ data: {
            id: accountId, name: 'OAuth Handler', email, emailVerified: true,
            identities: { create: {
                id: randomUUID(), providerId: 'credential', accountId,
                password: await hashAccountPassword(password),
            } },
        } });
        await prisma.beaconOAuthClient.upsert({
            where: { clientId },
            create: {
                id: randomUUID(), clientId, clientSecret: hashAccountClientSecret(clientSecret),
                disabled: false, skipConsent: true, enableEndSession: true,
                subjectType: 'public', scopes: ['openid', 'profile'], contacts: [],
                redirectUris: ['https://listen.harmonicbeacon.com/api/account/callback'],
                postLogoutRedirectUris: ['https://listen.harmonicbeacon.com/api/account/frontchannel-logout'],
                tokenEndpointAuthMethod: 'client_secret_basic', grantTypes: ['authorization_code'],
                responseTypes: ['code'], public: false, type: 'web', requirePKCE: true,
            },
            update: { clientSecret: hashAccountClientSecret(clientSecret), disabled: false },
        });
    });

    afterAll(async () => {
        await prisma.earlyBirdUser.deleteMany({ where: { id: accountId } });
        await prisma.beaconOAuthClient.deleteMany({ where: { clientId } });
        await prisma.$disconnect();
    });

    it('exchanges an auth code and introspects using the provisioned full secret', async () => {
        const signIn = await accountRoutePOST(jsonRequest('/api/account/auth/sign-in/email', { email, password }));
        expect(signIn.status).toBe(200);
        const setCookies = signIn.headers.getSetCookie();
        const sessionCookies = setCookies.filter((entry) =>
            entry.startsWith('__Host-hb_account_session='));
        expect(sessionCookies).toHaveLength(1);
        expect(setCookies.join('\n')).not.toContain('__Secure-__Host-');
        expect(sessionCookies[0]).toContain('Path=/');
        expect(sessionCookies[0]).toContain('HttpOnly');
        expect(sessionCookies[0]).toContain('Secure');
        expect(sessionCookies[0]).toContain('SameSite=Lax');
        expect(sessionCookies[0]).not.toContain('Domain=');
        const sessionCookie = setCookies.map((entry) => entry.split(';', 1)[0]).join('; ');
        const resolved = await currentAccountSession(new Headers({ cookie: sessionCookie }));
        expect(resolved).toMatchObject({ user: { id: accountId, accessMethod: 'email' } });

        const verifier = randomBytes(48).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const authorizeURL = new URL('/api/account/auth/oauth2/authorize', issuer);
        authorizeURL.search = new URLSearchParams({
            client_id: clientId,
            redirect_uri: 'https://listen.harmonicbeacon.com/api/account/callback',
            response_type: 'code', scope: 'openid profile',
            state: 'state-for-handler-regression', nonce: 'nonce-for-handler-regression',
            code_challenge: challenge, code_challenge_method: 'S256',
        }).toString();
        const authorize = await handler(new Request(authorizeURL, {
            headers: { host: 'account.harmonicbeacon.com', cookie: sessionCookie },
        }));
        expect(authorize.status).toBeGreaterThanOrEqual(300);
        expect(authorize.status).toBeLessThan(400);
        const callback = new URL(authorize.headers.get('location')!);
        const code = callback.searchParams.get('code');
        expect(code).toBeTruthy();

        const basic = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`;
        const token = await handler(new Request(`${issuer}/api/account/auth/oauth2/token`, {
            method: 'POST', headers: {
                host: 'account.harmonicbeacon.com', authorization: basic,
                'content-type': 'application/x-www-form-urlencoded',
            }, body: new URLSearchParams({
                grant_type: 'authorization_code', code: code!,
                redirect_uri: 'https://listen.harmonicbeacon.com/api/account/callback',
                code_verifier: verifier,
            }),
        }));
        expect(token.status).toBe(200);
        const tokens = await token.json() as { access_token: string; id_token: string };
        expect(tokens.access_token).toMatch(/^hb_acct_p_at_/);
        expect(tokens.id_token.split('.')).toHaveLength(3);

        const introspection = await handler(new Request(`${issuer}/api/account/auth/oauth2/introspect`, {
            method: 'POST', headers: {
                host: 'account.harmonicbeacon.com', authorization: basic,
                'content-type': 'application/x-www-form-urlencoded',
            }, body: new URLSearchParams({ token: tokens.access_token }),
        }));
        expect(introspection.status).toBe(200);
        expect(await introspection.json()).toMatchObject({ active: true, client_id: clientId, sub: accountId });
    });
});
