import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { createLocalJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCOUNT_PROVISIONED_SCOPES } from '../config';

const databaseURL = process.env.LISTENER_TEST_DATABASE_URL;
if (databaseURL) process.env.DATABASE_URL = databaseURL;
const postgres = databaseURL ? describe : describe.skip;
const issuer = 'https://account.harmonicbeacon.com';
const clientId = 'hb-listener';
const clientSecret = 'full-client-secret-value-with-more-than-32-characters';
const accountId = `oauth-handler-${randomUUID()}`;
const email = `${accountId}@example.invalid`;
const signupEmail = `signup-${accountId}@example.invalid`;
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

postgres('pinned OAuth Provider 1.7 confidential-client lifecycle', () => {
    beforeAll(async () => {
        process.env.BEACON_ACCOUNT_BASE_URL = issuer;
        process.env.BEACON_ACCOUNT_AUTH_SECRET = 'handler-auth-secret-that-is-at-least-32-characters';
        process.env.BEACON_ACCOUNT_RATE_SECRET = 'handler-rate-secret-that-is-at-least-32-characters';
        process.env.BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER = clientSecret;
        process.env.BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE = `${clientSecret}-live`;
        process.env.BEACON_ACCOUNT_PSICOPOMPO_ENABLED = '1';
        process.env.BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO = `${clientSecret}-psicopompo`;
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
                subjectType: 'public', scopes: ACCOUNT_PROVISIONED_SCOPES, contacts: [],
                redirectUris: ['https://listen.harmonicbeacon.com/api/account/callback'],
                postLogoutRedirectUris: ['https://listen.harmonicbeacon.com/api/account/frontchannel-logout'],
                tokenEndpointAuthMethod: 'client_secret_basic', grantTypes: ['authorization_code'],
                responseTypes: ['code'], public: false, type: 'web', requirePKCE: true,
            },
            update: {
                clientSecret: hashAccountClientSecret(clientSecret), disabled: false,
                scopes: ACCOUNT_PROVISIONED_SCOPES,
            },
        });
    });

    afterAll(async () => {
        await prisma.earlyBirdUser.deleteMany({
            where: { OR: [{ id: accountId }, { email: signupEmail }] },
        });
        await prisma.beaconOAuthClient.deleteMany({ where: { clientId } });
        await prisma.$disconnect();
    });

    it('persists required signup names with the generated account in real PostgreSQL', async () => {
        const { withAccountEmailSignupProfile } = await import('../signup-profile');
        const response = await withAccountEmailSignupProfile({
            displayName: '李', realName: '李',
        }, () => handler(jsonRequest('/api/account/auth/sign-up/email', {
            name: '李', email: signupEmail, password: '12345678', callbackURL: '/account',
        })));
        expect(response.status).toBe(200);
        const created = await prisma.earlyBirdUser.findUniqueOrThrow({
            where: { email: signupEmail },
            select: {
                id: true,
                identities: { select: { providerId: true, userId: true } },
                beaconProfile: { select: { accountId: true, displayName: true, realName: true } },
            },
        });
        expect(created.identities).toEqual([{ providerId: 'credential', userId: created.id }]);
        expect(created.beaconProfile).toEqual({
            accountId: created.id, displayName: '李', realName: '李',
        });
    });

    it('exchanges tokens and binds resources to the authorized grant', async () => {
        const verifier = randomBytes(48).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const authorizeURL = new URL('/api/account/auth/oauth2/authorize', issuer);
        authorizeURL.search = new URLSearchParams({
            client_id: clientId,
            redirect_uri: 'https://listen.harmonicbeacon.com/api/account/callback',
            response_type: 'code', scope: ACCOUNT_PROVISIONED_SCOPES.join(' '),
            state: 'state-for-handler-regression', nonce: 'nonce-for-handler-regression',
            code_challenge: challenge, code_challenge_method: 'S256',
        }).toString();
        const preLoginAuthorize = await handler(new Request(authorizeURL, {
            headers: { host: 'account.harmonicbeacon.com' },
        }));
        expect(preLoginAuthorize.status).toBe(302);
        const accountLogin = new URL(preLoginAuthorize.headers.get('location')!, issuer);
        expect(accountLogin.origin + accountLogin.pathname)
            .toBe('https://account.harmonicbeacon.com/account');
        expect(accountLogin.searchParams.get('sig')).toBeTruthy();

        const signIn = await accountRoutePOST(jsonRequest('/api/account/auth/sign-in/email', {
            email,
            password,
            callbackURL: '/account',
            oauth_query: accountLogin.searchParams.toString(),
        }));
        expect(signIn.status).toBe(200);
        const signInBody = await signIn.clone().json() as { redirect?: string };
        expect(signInBody.redirect).toBeTruthy();
        const callback = new URL(signInBody.redirect!);
        expect(callback.origin + callback.pathname)
            .toBe('https://listen.harmonicbeacon.com/api/account/callback');
        expect(callback.searchParams.get('state')).toBe('state-for-handler-regression');
        const code = callback.searchParams.get('code');
        expect(code).toBeTruthy();
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
        // Legacy key rows have no alg/crv metadata. Keep their bytes and kid;
        // the configured EdDSA/Ed25519 fallback must still verify issued tokens.
        const keyId = decodeProtectedHeader(tokens.id_token).kid!;
        const beforeKey = await prisma.beaconJwks.findUniqueOrThrow({ where: { id: keyId } });
        await prisma.beaconJwks.update({ where: { id: keyId }, data: { alg: null, crv: null } });
        const { accountAuth } = await import('../auth');
        const oldKeySet = await accountAuth().api.getJwks();
        expect((await jwtVerify(tokens.id_token, createLocalJWKSet(oldKeySet), {
            issuer, audience: clientId, algorithms: ['EdDSA'],
        })).payload.sub).toBe(accountId);
        expect(await prisma.beaconJwks.findUniqueOrThrow({ where: { id: keyId } }))
            .toMatchObject({ publicKey: beforeKey.publicKey, privateKey: beforeKey.privateKey });

        const introspection = await handler(new Request(`${issuer}/api/account/auth/oauth2/introspect`, {
            method: 'POST', headers: {
                host: 'account.harmonicbeacon.com', authorization: basic,
                'content-type': 'application/x-www-form-urlencoded',
            }, body: new URLSearchParams({ token: tokens.access_token }),
        }));
        expect(introspection.status).toBe(200);
        expect(await introspection.json()).toMatchObject({ active: true, client_id: clientId, sub: accountId });

        const userInfo = await handler(new Request(`${issuer}/api/account/auth/oauth2/userinfo`, {
            headers: { authorization: `Bearer ${tokens.access_token}` },
        }));
        expect(userInfo.status).toBe(200);
        const claims = await userInfo.json();
        expect(claims).toMatchObject({
            sub: accountId, name: 'OAuth Handler', preferred_name: 'OAuth Handler',
            profile_complete: false,
        });
        if (ACCOUNT_PROVISIONED_SCOPES.includes('email')) {
            expect(claims).toMatchObject({ email, email_verified: true });
        } else {
            expect(claims).not.toHaveProperty('email');
            expect(claims).not.toHaveProperty('email_verified');
        }
        expect(claims).not.toHaveProperty('realName');
        expect(claims).not.toHaveProperty('real_name');

        // Reuse the authenticated browser session instead of adding another
        // password attempt to the provider's production rate-limit bucket.
        const anotherAuthorization = await handler(new Request(authorizeURL, {
            headers: { host: 'account.harmonicbeacon.com', cookie: sessionCookie },
        }));
        expect(anotherAuthorization.status).toBe(302);
        const anotherCode = new URL(anotherAuthorization.headers.get('location')!).searchParams.get('code');
        expect(anotherCode).toBeTruthy();
        const rejected = await handler(new Request(`${issuer}/api/account/auth/oauth2/token`, {
            method: 'POST', headers: {
                host: 'account.harmonicbeacon.com', authorization: basic,
                'content-type': 'application/x-www-form-urlencoded',
            }, body: new URLSearchParams({
                grant_type: 'authorization_code', code: anotherCode!,
                redirect_uri: 'https://listen.harmonicbeacon.com/api/account/callback',
                code_verifier: verifier, resource: 'https://untrusted-resource.example.invalid',
            }),
        }));
        expect(rejected.status).toBe(400);
        expect(await rejected.json()).toMatchObject({
            error: 'invalid_target',
        });
        const identifier = 'https://resource.example.invalid/api';
        const resourceId = randomUUID();
        const otherIdentifier = 'https://other-resource.example.invalid/api';
        const otherResourceId = randomUUID();
        await prisma.beaconOAuthResource.create({ data: {
            id: resourceId, identifier, name: 'Isolated resource', allowedScopes: ACCOUNT_PROVISIONED_SCOPES,
        } });
        await prisma.beaconOAuthClientResource.create({ data: { id: randomUUID(), clientId, resourceId: identifier } });
        await prisma.beaconOAuthResource.create({ data: {
            id: otherResourceId, identifier: otherIdentifier, name: 'Other isolated resource', allowedScopes: ACCOUNT_PROVISIONED_SCOPES,
        } });
        await prisma.beaconOAuthClientResource.create({ data: { id: randomUUID(), clientId, resourceId: otherIdentifier } });
        try {
            // Reuse this protocol's real signed-in browser session; repeated
            // password attempts exercise a different production rate bucket.
            const cookie = sessionCookie;
            const verifier = randomBytes(48).toString('base64url');
            const authorize = async (resource?: string) => {
                const url = new URL('/api/account/auth/oauth2/authorize', issuer);
                url.search = new URLSearchParams({
                    client_id: clientId, redirect_uri: 'https://listen.harmonicbeacon.com/api/account/callback',
                    response_type: 'code', scope: ACCOUNT_PROVISIONED_SCOPES.join(' '),
                    state: 'resource-grant-state', nonce: 'resource-grant-nonce',
                    code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
                    ...(resource ? { resource } : {}),
                }).toString();
                const response = await handler(new Request(url, { headers: { host: 'account.harmonicbeacon.com', cookie } }));
                expect(response.status).toBe(302);
                const code = new URL(response.headers.get('location')!).searchParams.get('code');
                expect(code).toBeTruthy();
                return code!;
            };
            const exchange = (code: string, resource = identifier) => handler(new Request(`${issuer}/api/account/auth/oauth2/token`, {
                method: 'POST', headers: {
                    host: 'account.harmonicbeacon.com', 'content-type': 'application/x-www-form-urlencoded',
                    authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
                }, body: new URLSearchParams({
                    grant_type: 'authorization_code', code, code_verifier: verifier,
                    redirect_uri: 'https://listen.harmonicbeacon.com/api/account/callback', resource,
                }),
            }));
            const withoutGrant = await exchange(await authorize(identifier), otherIdentifier);
            expect(withoutGrant.status).toBe(400);
            expect(await withoutGrant.json()).toMatchObject({ error: 'invalid_target' });

            const granted = await exchange(await authorize(identifier));
            expect(granted.status).toBe(200);
            const tokens = await granted.json();
            const { accountAuth } = await import('../auth');
            const verified = await jwtVerify(tokens.access_token, createLocalJWKSet(await accountAuth().api.getJwks()), {
                issuer, audience: identifier, algorithms: ['EdDSA'],
            });
            expect(verified.payload.sub).toBe(accountId);
        } finally {
            await prisma.beaconOAuthResource.deleteMany({ where: { id: { in: [resourceId, otherResourceId] } } });
        }
    });

    it('preserves a pre-upgrade signed session and opaque token, then fences them on session removal', async () => {
        const sessionId = randomUUID();
        const sessionToken = `legacy-session-${randomUUID()}`;
        const opaqueToken = `legacy-opaque-${randomUUID()}`;
        const tokenId = randomUUID();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
        // 1.6 persisted the unprefixed opaque-token SHA256/base64url verifier.
        // Its signed session cookie uses HMAC-SHA256 and padded base64.
        const signature = createHmac('sha256', 'handler-auth-secret-that-is-at-least-32-characters')
            .update(sessionToken).digest('base64');
        const cookie = `__Host-hb_account_session=${encodeURIComponent(`${sessionToken}.${signature}`)}`;
        await prisma.earlyBirdAuthSession.create({ data: {
            id: sessionId, token: sessionToken, userId: accountId, expiresAt,
            securityRevision: 1, authorityEnvironment: 'production',
        } });
        await prisma.beaconOAuthAccessToken.create({ data: {
            id: tokenId, token: createHash('sha256').update(opaqueToken).digest('base64url'),
            clientId, sessionId, userId: accountId, scopes: ACCOUNT_PROVISIONED_SCOPES, expiresAt,
        } });
        try {
            expect((await currentAccountSession(new Headers({ cookie })))?.user.id).toBe(accountId);
            const request = () => new Request(`${issuer}/api/account/auth/oauth2/userinfo`, {
                headers: { authorization: `Bearer hb_acct_p_at_${opaqueToken}` },
            });
            const before = await handler(request());
            expect(before.status).toBe(200);
            expect(await before.json()).toMatchObject({ sub: accountId });
            expect(await prisma.beaconOAuthAccessToken.findUniqueOrThrow({ where: { id: tokenId } }))
                .toMatchObject({ resources: [], revoked: null });
            await prisma.earlyBirdAuthSession.delete({ where: { id: sessionId } });
            expect(await prisma.beaconOAuthAccessToken.findUnique({ where: { id: tokenId } })).toBeNull();
            expect((await handler(request())).status).toBe(401);
            expect(await currentAccountSession(new Headers({ cookie }))).toBeNull();
        } finally {
            await prisma.beaconOAuthAccessToken.deleteMany({ where: { id: tokenId } });
            await prisma.earlyBirdAuthSession.deleteMany({ where: { id: sessionId } });
        }
    });

    it.each([
        ['hb-live', 'https://live.harmonicbeacon.com/api/account/callback'],
        ['hb-psicopompo', 'https://psicopompo.altermundi.net/api/auth/beacon/callback'],
    ])('completes a profile before %s and exchanges its exact callback code', async (rpClient, redirectUri) => {
        const listener = await prisma.beaconOAuthClient.findUniqueOrThrow({ where: { clientId } });
        const { hashAccountClientSecret } = await import('../client-secret');
        const rpSecret = `${clientSecret}-${rpClient === 'hb-live' ? 'live' : 'psicopompo'}`;
        await prisma.beaconProfile.update({ where: { accountId }, data: { realName: null } });
        await prisma.beaconOAuthClient.create({ data: {
            ...listener, id: randomUUID(), clientId: rpClient,
            clientSecret: hashAccountClientSecret(rpSecret),
            metadata: undefined,
            redirectUris: [redirectUri],
            postLogoutRedirectUris: rpClient === 'hb-psicopompo' ? []
                : ['https://live.harmonicbeacon.com/api/account/frontchannel-logout'],
        } });
        try {
            const signIn = await accountRoutePOST(jsonRequest('/api/account/auth/sign-in/email', {
                email, password, callbackURL: '/account',
            }));
            expect(signIn.status).toBe(200);
            const cookie = signIn.headers.getSetCookie().map((entry) => entry.split(';', 1)[0]).join('; ');
            const before = await currentAccountSession(new Headers({ cookie }));
            expect(before?.user.id).toBe(accountId);
            const authorize = new URL('/api/account/auth/oauth2/authorize', issuer);
            const verifier = randomBytes(48).toString('base64url');
            authorize.search = new URLSearchParams({
                client_id: rpClient, redirect_uri: redirectUri,
                response_type: 'code', scope: ACCOUNT_PROVISIONED_SCOPES.join(' '), state: 'live-profile-return',
                code_challenge: createHash('sha256').update(verifier).digest('base64url'),
                code_challenge_method: 'S256',
            }).toString();
            const { GET } = await import('@/app/api/account/auth/[...all]/route');
            const response = await GET(new Request(authorize, {
                headers: { host: 'account.harmonicbeacon.com', cookie },
            }));
            expect(response.status).toBe(302);
            const completion = new URL(response.headers.get('location')!, issuer);
            expect(completion.pathname).toBe('/account');
            expect(completion.searchParams.get('sig')).toBeTruthy();
            const { POST: saveProfile } = await import('@/app/api/account/profile/route');
            const saveRequest = jsonRequest('/api/account/profile', {
                displayName: '李', realName: 'Private Real Name', revision: before!.profile.revision,
            });
            saveRequest.headers.set('cookie', cookie);
            expect((await saveProfile(saveRequest)).status).toBe(200);
            const resume = jsonRequest('/api/account/auth/oauth2/continue', {
                postLogin: true, oauth_query: completion.searchParams.toString(),
            });
            resume.headers.set('cookie', cookie);
            const resumed = await accountRoutePOST(resume);
            expect(resumed.status).toBe(200);
            const result = await resumed.json();
            expect(result.status).toBe('continued');
            const callback = new URL(result.redirect);
            expect(callback.origin + callback.pathname).toBe(redirectUri);
            expect(callback.searchParams.get('state')).toBe('live-profile-return');
            expect(callback.searchParams.get('code')).toBeTruthy();
            const token = await accountRoutePOST(new Request(`${issuer}/api/account/auth/oauth2/token`, {
                method: 'POST', headers: {
                    host: 'account.harmonicbeacon.com',
                    'content-type': 'application/x-www-form-urlencoded',
                    authorization: `Basic ${Buffer.from(`${rpClient}:${rpSecret}`).toString('base64')}`,
                }, body: new URLSearchParams({ grant_type: 'authorization_code',
                    code: callback.searchParams.get('code')!, redirect_uri: redirectUri,
                    code_verifier: verifier,
                }),
            }));
            expect(token.status).toBe(200);
            const tokens = await token.json();
            expect(tokens.access_token).toBeTruthy();
            expect(tokens.id_token).toBeTruthy();
            expect(tokens.refresh_token).toBeUndefined();
            const { accountAuth } = await import('../auth');
            const jwks = await accountAuth().api.getJwks();
            const verified = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
                issuer, audience: rpClient, algorithms: ['EdDSA'],
            });
            expect(verified.payload.sub).toBe(accountId);
            expect(verified.payload.sid).toBe(before!.session.id);
            const { POST: sessionStatus } = await import('@/app/api/account/session-status/route');
            const status = await sessionStatus(new Request(`${issuer}/api/account/session-status`, {
                method: 'POST', headers: {
                    host: 'account.harmonicbeacon.com',
                    'content-type': 'application/x-www-form-urlencoded',
                    authorization: `Basic ${Buffer.from(`${rpClient}:${rpSecret}`).toString('base64')}`,
                }, body: new URLSearchParams({ sid: verified.payload.sid as string, sub: accountId }),
            }));
            expect(status.status).toBe(200);
            expect(await status.json()).toMatchObject({
                active: true, iss: issuer, sub: accountId, sid: before!.session.id,
            });
            expect(await currentAccountSession(new Headers({ cookie }))).toMatchObject({
                user: { id: accountId }, profile: { displayName: '李', realName: 'Private Real Name' },
            });
        } finally {
            await prisma.beaconOAuthClient.deleteMany({ where: { clientId: rpClient } });
        }
    });
});
