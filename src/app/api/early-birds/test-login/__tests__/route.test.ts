import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ handler: vi.fn(), issueMembership: vi.fn() }));
vi.mock('@/lib/early-birds/auth', async (importOriginal) => {
    const bridge = await import('@/lib/listener/session-cookie-bridge');
    // The route crosses the real bridge; only Better Auth itself is stubbed,
    // so rejection/mirroring behavior under test is the production wrapper.
    const names = bridge.listenerSessionCookieNames('__Secure-hb_earlybird_session');
    return {
        ...await importOriginal<typeof import('@/lib/early-birds/auth')>(),
        earlyBirdAuth: () => ({ handler: mocks.handler }),
        earlyBirdSessionCookieNames: () => names,
        earlyBirdAuthHandler: (request: Request) =>
            bridge.listenerSessionAuthHandler(mocks.handler, names)(request),
    };
});
vi.mock('@/lib/early-birds/membership', () => ({
    issueSyntheticMembership: mocks.issueMembership,
}));

import { POST } from '../route';

const URL = 'https://app.example.test/api/early-birds/test-login';
const LEGACY_SESSION = '__Secure-hb_earlybird_session';
const CANONICAL_SESSION = '__Secure-hb_listener_session';
const SYNTHETIC_MINT = `${LEGACY_SESSION}=synthetic; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure`;
const LEGACY_CLEAR = `${LEGACY_SESSION}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`;
const CANONICAL_CLEAR = `${CANONICAL_SESSION}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`;

function request(authorization?: string, authOnly = false, cookie?: string): NextRequest {
    return new NextRequest(URL, {
        method: 'POST',
        headers: {
            host: 'app.example.test',
            'x-forwarded-proto': 'https',
            'content-type': 'application/json',
            ...(authorization ? { authorization } : {}),
            ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({
            email: 'listener@e2e.invalid',
            name: 'Synthetic Listener',
            authOnly,
        }),
    });
}

describe('EarlyBird synthetic login seam', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_TEST_ACCESS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_TEST_LOGIN_SECRET', 's'.repeat(32));
        vi.stubEnv('EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS', 'app.example.test');
        mocks.handler.mockResolvedValue(new Response(JSON.stringify({
            user: { id: 'listener-synthetic-1' },
        }), {
            status: 200,
            headers: { 'set-cookie': SYNTHETIC_MINT },
        }));
        mocks.issueMembership.mockResolvedValue({});
    });
    afterEach(() => vi.unstubAllEnvs());

    it('hides the route when the caller omits the test-only bearer', async () => {
        const response = await POST(request());
        expect(response.status).toBe(404);
        await expect(response.json()).resolves.toEqual({ error: 'Not found.' });
    });

    it('hides the route for a wrong or malformed bearer', async () => {
        await expect(POST(request(`Bearer ${'x'.repeat(32)}`))).resolves.toMatchObject({ status: 404 });
        await expect(POST(request(`Basic ${'s'.repeat(32)}`))).resolves.toMatchObject({ status: 404 });
    });

    it('stays disabled with a short configured secret', async () => {
        vi.stubEnv('EARLY_BIRDS_TEST_LOGIN_SECRET', 'short');
        await expect(POST(request('Bearer short'))).resolves.toMatchObject({ status: 404 });
    });

    it('hides the route on a non-allowlisted host or non-HTTPS request', async () => {
        const wrongHost = request(`Bearer ${'s'.repeat(32)}`);
        wrongHost.headers.set('host', 'other.example.test');
        await expect(POST(wrongHost)).resolves.toMatchObject({ status: 404 });

        const insecure = request(`Bearer ${'s'.repeat(32)}`);
        insecure.headers.set('x-forwarded-proto', 'http');
        await expect(POST(insecure)).resolves.toMatchObject({ status: 404 });
    });

    it('creates isolated synthetic access on the exact staging host without forwarding the bearer', async () => {
        const secret = 's'.repeat(32);
        const response = await POST(request(`Bearer ${secret}`));
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toEqual({ ok: true, landing: '/early-birds' });
        expect(mocks.handler).toHaveBeenCalledOnce();
        const internalRequest = mocks.handler.mock.calls[0][0] as Request;
        expect(internalRequest.headers.get('authorization')).toBeNull();
        expect(JSON.stringify(await internalRequest.clone().json())).not.toContain(secret);
        expect(mocks.issueMembership).toHaveBeenCalledWith('listener-synthetic-1');
    });

    it('signs an existing synthetic account in without spending a sign-up attempt', async () => {
        const response = await POST(request(`Bearer ${'s'.repeat(32)}`));

        expect(response.status).toBe(200);
        expect(mocks.handler).toHaveBeenCalledOnce();
        const internalRequest = mocks.handler.mock.calls[0][0] as Request;
        expect(internalRequest.url).toContain('/sign-in/email');
    });

    it('falls back to one bounded sign-up for a new synthetic identity', async () => {
        mocks.handler
            .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid credentials' }), {
                status: 401,
            }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                user: { id: 'listener-synthetic-new' },
            }), {
                status: 200,
                headers: { 'set-cookie': SYNTHETIC_MINT },
            }));

        const response = await POST(request(`Bearer ${'s'.repeat(32)}`));

        expect(response.status).toBe(200);
        expect(mocks.handler).toHaveBeenCalledTimes(2);
        const first = mocks.handler.mock.calls[0][0] as Request;
        const second = mocks.handler.mock.calls[1][0] as Request;
        expect(first.url).toContain('/sign-in/email');
        expect(second.url).toContain('/sign-up/email');
        expect(mocks.issueMembership).toHaveBeenCalledWith('listener-synthetic-new');
    });

    it('creates only the staging identity when a canonical Free invitation will issue access', async () => {
        const secret = 's'.repeat(32);
        const response = await POST(request(`Bearer ${secret}`, true));
        expect(response.status).toBe(200);
        expect(mocks.handler).toHaveBeenCalledOnce();
        expect(mocks.issueMembership).not.toHaveBeenCalled();
    });

    it('preserves the actual dual session Set-Cookie pair on a successful login', async () => {
        const response = await POST(request(`Bearer ${'s'.repeat(32)}`));

        expect(response.status).toBe(200);
        // Not a mocked bridge: the real wrapper mirrored the legacy mint onto
        // the canonical name byte-identically apart from the name itself.
        expect(response.headers.getSetCookie()).toEqual([
            SYNTHETIC_MINT,
            `${CANONICAL_SESSION}${SYNTHETIC_MINT.slice(LEGACY_SESSION.length)}`,
        ]);
    });

    it('rejects invalid inbound session cookies before Better Auth and mints nothing', async () => {
        const conflict = `${CANONICAL_SESSION}=stale.token%3D; ${LEGACY_SESSION}=fresh.token%3D`;
        const response = await POST(request(`Bearer ${'s'.repeat(32)}`, false, conflict));

        // Both internal sign-in and sign-up terminate at the bridge; the
        // wrapped Better Auth handler is never invoked and no session exists.
        expect(mocks.handler).not.toHaveBeenCalled();
        expect(mocks.issueMembership).not.toHaveBeenCalled();
        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.getSetCookie()).toEqual([LEGACY_CLEAR, CANONICAL_CLEAR]);

        // Once the browser honours the two expiries, a clean retry reaches
        // Better Auth and mints a fresh byte-identical dual pair.
        const retry = await POST(request(`Bearer ${'s'.repeat(32)}`));
        expect(retry.status).toBe(200);
        expect(mocks.handler).toHaveBeenCalledOnce();
        expect(retry.headers.getSetCookie()).toEqual([
            SYNTHETIC_MINT,
            `${CANONICAL_SESSION}${SYNTHETIC_MINT.slice(LEGACY_SESSION.length)}`,
        ]);
    });

    it('never forwards malformed, incomplete or unrelated internal cookies on failure', async () => {
        mocks.handler.mockResolvedValue(new Response(JSON.stringify({ error: 'nope' }), {
            status: 401,
            headers: [
                ['set-cookie', 'unrelated=secret; Path=/; HttpOnly'],
                ['set-cookie', LEGACY_CLEAR],
            ],
        }));

        const response = await POST(request(`Bearer ${'s'.repeat(32)}`));

        expect(response.status).toBe(503);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.getSetCookie()).toEqual([]);
        expect(mocks.handler).toHaveBeenCalledTimes(2);
        expect(mocks.issueMembership).not.toHaveBeenCalled();
    });
});
