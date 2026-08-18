import { createHash } from 'node:crypto';

import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const ISSUER = 'https://account.example.test';
const CLIENT_ID = 'hb-live-test';
const CLIENT_SECRET = 'test-client-secret-that-is-more-than-32-characters';
const NOW = new Date('2026-08-17T20:00:00.000Z');
const STATE = 'state-value-bound-to-browser';
const NONCE = 'nonce-value-bound-to-id-token';
const SUBJECT = 'acct_opaque_123';
const SID = 'central-device-session-456';

const createAttempt = vi.fn();
const findAttempt = vi.fn();
const claimAttempt = vi.fn();
const findStaffBinding = vi.fn();
const updateSessions = vi.fn();
const createSession = vi.fn();
const createAudit = vi.fn();

vi.mock('@/lib/db', () => {
    const transaction = vi.fn(async (work: (tx: unknown) => unknown) => work({
        webSession: { updateMany: updateSessions, create: createSession },
        auditLog: { create: createAudit },
    }));
    return {
        prisma: {
            accountLoginAttempt: {
                create: createAttempt,
                findUnique: findAttempt,
                updateMany: claimAttempt,
            },
            staffAccountBinding: { findUnique: findStaffBinding },
            webSession: { updateMany: updateSessions },
            $transaction: transaction,
        },
    };
});

let privateKey: CryptoKey;
let publicJwk: JWK;

function discovery(overrides: Record<string, unknown> = {}) {
    return {
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/oauth2/authorize`,
        token_endpoint: `${ISSUER}/oauth2/token`,
        jwks_uri: `${ISSUER}/oauth2/jwks`,
        introspection_endpoint: `${ISSUER}/oauth2/introspect`,
        end_session_endpoint: `${ISSUER}/oauth2/logout`,
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        ...overrides,
    };
}

function json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

async function idToken(
    nonce = NONCE,
    issuedAt = Math.floor(NOW.getTime() / 1000),
    expiresAt = Math.floor(NOW.getTime() / 1000) + 600,
) {
    return new SignJWT({ nonce, sid: SID, name: '  Ana   Beacon  ' })
        .setProtectedHeader({ alg: 'RS256', kid: 'account-test-key' })
        .setIssuer(ISSUER)
        .setSubject(SUBJECT)
        .setAudience(CLIENT_ID)
        .setIssuedAt(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(privateKey);
}

function stateDigest() {
    return createHash('sha256').update(STATE).digest('hex');
}

beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
    publicJwk.kid = 'account-test-key';
    publicJwk.alg = 'RS256';
});

beforeEach(async () => {
    vi.resetAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    process.env.BEACON_ACCOUNT_ENABLED = 'true';
    process.env.BEACON_ACCOUNT_ISSUER_URL = ISSUER;
    process.env.BEACON_ACCOUNT_CLIENT_ID = CLIENT_ID;
    process.env.BEACON_ACCOUNT_CLIENT_SECRET = CLIENT_SECRET;
    process.env.SESSION_COOKIE_TTL_SECONDS = '604800';
    const accountRp = await import('../account-rp');
    accountRp.__resetAccountDiscoveryForTests();
    createAttempt.mockResolvedValue({});
    claimAttempt.mockResolvedValue({ count: 1 });
    findStaffBinding.mockResolvedValue(null);
    updateSessions.mockResolvedValue({ count: 0 });
    createSession.mockResolvedValue({});
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.BEACON_ACCOUNT_ENABLED;
    delete process.env.BEACON_ACCOUNT_ISSUER_URL;
    delete process.env.BEACON_ACCOUNT_CLIENT_ID;
    delete process.env.BEACON_ACCOUNT_CLIENT_SECRET;
    delete process.env.TICKET_LOGIN_URL_PREFIX;
});

describe('Beacon Account OAuth 2.1 RP', () => {
    it('uses the pinned public origin behind a loopback proxy and ignores forwarded host input', async () => {
        process.env.TICKET_LOGIN_URL_PREFIX = 'https://live-staging.harmonicbeacon.com/';
        const { trustedLiveRequestOrigin } = await import('../account-rp');
        const request = {
            nextUrl: new URL('http://127.0.0.1:3000/api/account/login'),
            headers: new Headers({
                host: 'live-staging.harmonicbeacon.com',
                'x-forwarded-host': 'attacker.example',
            }),
        };

        expect(trustedLiveRequestOrigin(request)).toBe('https://live-staging.harmonicbeacon.com');
    });

    it('derives an HTTPS public origin from the exact validated Host behind a loopback proxy', async () => {
        const { trustedLiveRequestOrigin } = await import('../account-rp');
        const request = {
            nextUrl: new URL('http://127.0.0.1:3000/api/account/callback?code=private&state=private'),
            headers: new Headers({
                host: 'live-staging.harmonicbeacon.com',
                'x-forwarded-host': 'attacker.example',
            }),
        };

        expect(trustedLiveRequestOrigin(request)).toBe('https://live-staging.harmonicbeacon.com');
    });

    it('rejects missing or untrusted Host values and never falls back to X-Forwarded-Host', async () => {
        const { trustedLiveRequestOrigin } = await import('../account-rp');
        const internalUrl = new URL('http://127.0.0.1:3000/api/account/login');

        expect(() => trustedLiveRequestOrigin({
            nextUrl: internalUrl,
            headers: new Headers({ 'x-forwarded-host': 'live-staging.harmonicbeacon.com' }),
        })).toThrow('Missing Live Host');
        expect(() => trustedLiveRequestOrigin({
            nextUrl: internalUrl,
            headers: new Headers({
                host: 'attacker.example',
                'x-forwarded-host': 'live-staging.harmonicbeacon.com',
            }),
        })).toThrow('Untrusted Live origin');
    });

    it('starts a one-use confidential-client authorization with PKCE, nonce and safe return', async () => {
        const fetchMock = vi.fn().mockResolvedValue(json(discovery()));
        vi.stubGlobal('fetch', fetchMock);
        const { startAccountAuthorization } = await import('../account-rp');

        const result = await startAccountAuthorization({
            flow: 'attendee',
            returnTo: '/session/event-1',
            origin: 'http://localhost:3000',
            now: NOW,
        });

        const redirect = new URL(result.authorizationUrl);
        expect(redirect.origin).toBe(ISSUER);
        expect(redirect.searchParams.get('client_id')).toBe(CLIENT_ID);
        expect(redirect.searchParams.get('code_challenge_method')).toBe('S256');
        expect(redirect.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(redirect.searchParams.get('nonce')).toBeTruthy();
        expect(redirect.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/account/callback');
        expect(createAttempt).toHaveBeenCalledWith({
            data: expect.objectContaining({
                stateDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
                codeVerifier: expect.stringMatching(/^[A-Za-z0-9_-]{64}$/),
                flow: 'attendee',
                returnTo: '/session/event-1',
            }),
        });
        expect(result.stateCookie).toMatchObject({
            name: '__Host-hb_account_state',
            httpOnly: true,
            secure: true,
            sameSite: 'lax',
        });
    });

    it('verifies ID-token signature/claims, introspects once and persists no provider token', async () => {
        findAttempt.mockResolvedValue({
            stateDigest: stateDigest(),
            codeVerifier: 'pkce-verifier-value',
            nonce: NONCE,
            flow: 'attendee',
            returnTo: '/',
            expiresAt: new Date(NOW.getTime() + 60_000),
            consumedAt: null,
            pendingPromoDigest: null,
            pendingDisplayName: null,
            pendingTermsVersion: null,
            pendingTermsAcceptedAt: null,
        });
        const signed = await idToken();
        const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
            void _init;
            const url = String(input);
            if (url.endsWith('/.well-known/openid-configuration')) return json(discovery());
            if (url === `${ISSUER}/oauth2/token`) return json({
                access_token: 'opaque-access-token',
                id_token: signed,
                token_type: 'Bearer',
            });
            if (url === `${ISSUER}/oauth2/jwks`) return json({ keys: [publicJwk] });
            if (url === `${ISSUER}/oauth2/introspect`) return json({
                active: true,
                client_id: CLIENT_ID,
                sub: SUBJECT,
            });
            throw new Error(`unexpected fetch ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        const { completeAccountAuthorization } = await import('../account-rp');

        const result = await completeAccountAuthorization({
            code: 'one-use-authorization-code',
            state: STATE,
            stateCookie: STATE,
            origin: 'http://localhost:3000',
            now: NOW,
        });

        expect(result.identity).toMatchObject({
            issuer: ISSUER,
            subject: SUBJECT,
            sessionId: SID,
            displayName: 'Ana Beacon',
        });
        expect(claimAttempt).toHaveBeenCalledWith(expect.objectContaining({
            where: expect.objectContaining({ stateDigest: stateDigest(), consumedAt: null }),
        }));
        const persisted = createSession.mock.calls[0][0].data;
        expect(persisted).toMatchObject({
            accountIssuer: ISSUER,
            accountSubject: SUBJECT,
            accountSessionId: SID,
            accountDisplayName: 'Ana Beacon',
        });
        expect(JSON.stringify(persisted)).not.toContain('opaque-access-token');
        expect(JSON.stringify(persisted)).not.toContain(signed);
        const tokenCall = fetchMock.mock.calls.find(([url]) => String(url) === `${ISSUER}/oauth2/token`);
        expect((tokenCall?.[1] as RequestInit).headers).toMatchObject({
            Authorization: expect.stringMatching(/^Basic /),
        });
        expect(String((tokenCall?.[1] as RequestInit).body)).toContain('code_verifier=pkce-verifier-value');
    });

    it('rejects an ID token whose issued-at exceeds the callback freshness window', async () => {
        findAttempt.mockResolvedValue({
            stateDigest: stateDigest(),
            codeVerifier: 'pkce-verifier-value',
            nonce: NONCE,
            flow: 'attendee',
            returnTo: '/',
            expiresAt: new Date(NOW.getTime() + 60_000),
            consumedAt: null,
            pendingPromoDigest: null,
            pendingDisplayName: null,
            pendingTermsVersion: null,
            pendingTermsAcceptedAt: null,
        });
        const stale = await idToken(
            NONCE,
            Math.floor(NOW.getTime() / 1000) - 6 * 60,
            Math.floor(NOW.getTime() / 1000) + 10 * 60,
        );
        const fetchMock = vi.fn(async (input: string | URL | Request) => {
            const url = String(input);
            if (url.endsWith('/.well-known/openid-configuration')) return json(discovery());
            if (url === `${ISSUER}/oauth2/token`) return json({
                access_token: 'opaque-access-token',
                id_token: stale,
                token_type: 'Bearer',
            });
            if (url === `${ISSUER}/oauth2/jwks`) return json({ keys: [publicJwk] });
            if (url === `${ISSUER}/oauth2/introspect`) {
                throw new Error('stale ID token must not be introspected');
            }
            throw new Error(`unexpected fetch ${url}`);
        });
        vi.stubGlobal('fetch', fetchMock);
        const { completeAccountAuthorization } = await import('../account-rp');

        await expect(completeAccountAuthorization({
            code: 'one-use-authorization-code',
            state: STATE,
            stateCookie: STATE,
            origin: 'http://localhost:3000',
            now: NOW,
        })).rejects.toThrow();
        expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/oauth2/introspect'))).toBe(false);
    });

    it('fails closed on state mismatch before consuming the authorization attempt', async () => {
        const { completeAccountAuthorization } = await import('../account-rp');
        await expect(completeAccountAuthorization({
            code: 'authorization-code',
            state: STATE,
            stateCookie: 'different-browser-state',
            origin: 'http://localhost:3000',
            now: NOW,
        })).rejects.toThrow(/state mismatch/);
        expect(findAttempt).not.toHaveBeenCalled();
        expect(claimAttempt).not.toHaveBeenCalled();
    });

    it('does not treat Account outage as app-level unready media teardown', async () => {
        const { accountIdentityIsFresh } = await import('../account-rp');
        expect(accountIdentityIsFresh({ validatedAt: NOW }, new Date(NOW.getTime() + 899_999))).toBe(true);
        expect(accountIdentityIsFresh({ validatedAt: NOW }, new Date(NOW.getTime() + 900_001))).toBe(false);
    });

    it('revalidates and coalesces stale local sessions through the exact Account backchannel', async () => {
        updateSessions.mockResolvedValue({ count: 1 });
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            active: true,
            iss: ISSUER,
            sub: SUBJECT,
            sid: SID,
        }), {
            status: 200,
            headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        const { validatedAccountIdentity } = await import('../account-rp');
        const later = new Date(NOW.getTime() + 16 * 60_000);
        const candidate = {
            id: 'local-session-1',
            accountIssuer: ISSUER,
            accountSubject: SUBJECT,
            accountSessionId: SID,
            accountDisplayName: 'Ana Beacon',
            accountValidatedAt: NOW,
        };

        const [first, second] = await Promise.all([
            validatedAccountIdentity(candidate, later),
            validatedAccountIdentity({ ...candidate, id: 'local-session-2' }, later),
        ]);

        expect(first?.validatedAt).toEqual(later);
        expect(second?.validatedAt).toEqual(later);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toBe(`${ISSUER}/api/account/session-status`);
        const init = fetchMock.mock.calls[0][1] as RequestInit;
        expect(init.headers).toMatchObject({ Authorization: expect.stringMatching(/^Basic /) });
        expect(String(init.body)).toBe(`sid=${encodeURIComponent(SID)}&sub=${encodeURIComponent(SUBJECT)}`);
        expect(updateSessions).toHaveBeenCalledTimes(2);
    });

    it('revokes the exact issuer/sub/sid locally when Account reports inactive', async () => {
        updateSessions.mockResolvedValue({ count: 2 });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
            JSON.stringify({ active: false }),
            { status: 200, headers: { 'cache-control': 'no-store' } },
        )));
        const { validatedAccountIdentity } = await import('../account-rp');
        const later = new Date(NOW.getTime() + 16 * 60_000);
        await expect(validatedAccountIdentity({
            id: 'local-session-1',
            accountIssuer: ISSUER,
            accountSubject: SUBJECT,
            accountSessionId: SID,
            accountDisplayName: null,
            accountValidatedAt: NOW,
        }, later)).resolves.toBeNull();
        expect(updateSessions).toHaveBeenCalledWith({
            where: {
                accountIssuer: ISSUER,
                accountSubject: SUBJECT,
                accountSessionId: SID,
                revokedAt: null,
            },
            data: { revokedAt: later, revocationReason: 'account_session_inactive' },
        });
    });

    it('fails a stale protected transition closed on Account status outage without revoking media', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('issuer unavailable')));
        const { validatedAccountIdentity } = await import('../account-rp');
        await expect(validatedAccountIdentity({
            id: 'local-session-1',
            accountIssuer: ISSUER,
            accountSubject: SUBJECT,
            accountSessionId: SID,
            accountDisplayName: null,
            accountValidatedAt: NOW,
        }, new Date(NOW.getTime() + 16 * 60_000))).resolves.toBeNull();
        expect(updateSessions).not.toHaveBeenCalled();
    });

    it('rejects discovery endpoints that escape the exact issuer origin', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(discovery({
            token_endpoint: 'https://evil.example/oauth2/token',
        }))));
        const { discoverAccountIssuer } = await import('../account-rp');
        await expect(discoverAccountIssuer()).rejects.toThrow(/exact issuer origin/);
    });

    it('isolates front-channel revocation by exact issuer and opaque sid', async () => {
        const { revokeAllAccountSessions, revokeCentralSession } = await import('../account-rp');
        expect(await revokeCentralSession('https://other-issuer.example', SID, NOW)).toBe(0);
        expect(await revokeCentralSession(ISSUER, '', NOW)).toBe(0);
        expect(await revokeAllAccountSessions('https://other-issuer.example', SUBJECT, NOW)).toBe(0);
        expect(updateSessions).not.toHaveBeenCalled();

        updateSessions.mockResolvedValueOnce({ count: 2 });
        expect(await revokeCentralSession(ISSUER, SID, NOW)).toBe(2);
        expect(updateSessions).toHaveBeenCalledWith({
            where: {
                accountIssuer: ISSUER,
                accountSessionId: SID,
                revokedAt: null,
            },
            data: {
                revokedAt: NOW,
                revocationReason: 'account_frontchannel_logout',
            },
        });
    });
});
