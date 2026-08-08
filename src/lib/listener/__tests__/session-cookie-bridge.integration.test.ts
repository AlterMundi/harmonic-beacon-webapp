import { afterEach, describe, expect, it, vi } from 'vitest';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { betterAuth } from 'better-auth/minimal';
import { getCookies } from 'better-auth/cookies';

import {
    listenerSessionAuthHandler,
    listenerSessionClearCookies,
    listenerSessionCookieNames,
    type ListenerSessionCookieNames,
} from '@/lib/listener/session-cookie-bridge';
import { snapshotListenerSessionCookieObservations } from '@/lib/listener/session-cookie-observability';

type MemoryRow = Record<string, unknown>;
type BridgedHandler = (request: Request) => Promise<Response>;

const BASE_URL = 'https://listen.example.test';

function bridge(updateAge = 60 * 60 * 24) {
    const database: Record<string, MemoryRow[]> = {
        user: [],
        session: [],
        account: [],
        verification: [],
    };
    const auth = betterAuth({
        baseURL: BASE_URL,
        basePath: '/api/early-birds/auth',
        secret: 'test-auth-secret-with-at-least-32-characters',
        trustedOrigins: [BASE_URL],
        database: memoryAdapter(database),
        rateLimit: { enabled: false },
        emailAndPassword: { enabled: true },
        session: {
            expiresIn: 60 * 60 * 24 * 30,
            updateAge,
            cookieCache: { enabled: false },
        },
        advanced: {
            cookiePrefix: 'hb_earlybird',
            cookies: { session_token: { name: 'hb_earlybird_session' } },
            useSecureCookies: true,
        },
    });
    const names = listenerSessionCookieNames(getCookies(auth.options).sessionToken.name);
    expect(names).toEqual({
        legacy: '__Secure-hb_earlybird_session',
        canonical: '__Secure-hb_listener_session',
        scope: { path: '/', httpOnly: true, sameSite: 'Lax', secure: true },
    });
    return {
        auth,
        database,
        names,
        handler: listenerSessionAuthHandler((request) => auth.handler(request), names),
    };
}

function signUp(
    handler: BridgedHandler,
    email: string,
    cookie?: string,
    host?: string,
): Promise<Response> {
    return handler(new Request(`${BASE_URL}/api/early-birds/auth/sign-up/email`, {
        method: 'POST',
        headers: {
            origin: BASE_URL,
            'content-type': 'application/json',
            ...(cookie ? { cookie } : {}),
            ...(host ? { host } : {}),
        },
        body: JSON.stringify({ email, name: 'Listener', password: 'listener-password-1' }),
    }));
}

function signIn(handler: BridgedHandler, email: string, cookie?: string): Promise<Response> {
    return handler(new Request(`${BASE_URL}/api/early-birds/auth/sign-in/email`, {
        method: 'POST',
        headers: {
            origin: BASE_URL,
            'content-type': 'application/json',
            ...(cookie ? { cookie } : {}),
        },
        body: JSON.stringify({ email, password: 'listener-password-1' }),
    }));
}

function setCookieEntry(response: Response, name: string): string {
    const entry = response.headers.getSetCookie()
        .find((cookie) => cookie.startsWith(`${name}=`));
    expect(entry, `expected a Set-Cookie for ${name}`).toBeDefined();
    return entry as string;
}

function sessionCookieValue(response: Response, name: string): string {
    const entry = setCookieEntry(response, name);
    return entry.slice(name.length + 1, entry.indexOf(';'));
}

async function getSession(handler: BridgedHandler, cookie: string | null, host?: string) {
    const response = await handler(new Request(`${BASE_URL}/api/early-birds/auth/get-session`, {
        headers: {
            ...(cookie ? { cookie } : {}),
            ...(host ? { host } : {}),
        },
    }));
    expect(response.status).toBe(200);
    return { response, body: await response.json() as { user?: { email?: string } } | null };
}

/**
 * A rejection must come from the bridge itself: generic body, and the only
 * Set-Cookie output is the dual expiry of both exact session names — never
 * an auth token, never the rejected value.
 */
async function expectBridgeRejection(
    response: Response,
    status: 400 | 401,
    names: ListenerSessionCookieNames,
) {
    expect(response.status).toBe(status);
    const clears = response.headers.getSetCookie();
    expect(clears).toEqual(listenerSessionClearCookies(names));
    for (const entry of clears) {
        expect(entry).toContain('Max-Age=0');
        expect(entry).toContain('Path=/');
        expect(entry).toContain('HttpOnly');
        expect(entry).toContain('SameSite=Lax');
        expect(entry).toContain('Secure');
        expect(entry).not.toContain('Domain=');
    }
    await expect(response.json()).resolves.toEqual({ error: 'invalid session credentials' });
}

afterEach(() => {
    vi.useRealTimers();
});

describe('Listener session-cookie bridge over a real Better Auth pipeline', () => {
    it('mints a byte-identical dual pair with matching security attributes on sign-in', async () => {
        const state = bridge();
        const response = await signUp(state.handler, 'first@example.test');
        expect(response.status).toBe(200);

        const legacy = setCookieEntry(response, state.names.legacy);
        const canonical = setCookieEntry(response, state.names.canonical);
        expect(canonical).toBe(`${state.names.canonical}${legacy.slice(state.names.legacy.length)}`);
        for (const entry of [legacy, canonical]) {
            expect(entry).toContain('HttpOnly');
            expect(entry).toContain('Secure');
            expect(entry).toContain('SameSite=Lax');
            expect(entry).toContain('Path=/');
            expect(entry).toContain('Max-Age=');
            expect(entry).not.toContain('Domain=');
        }
        expect(state.database.session).toHaveLength(1);
    });

    it('accepts legacy-only and identical dual sessions, rejects canonical-only', async () => {
        const state = bridge();
        const response = await signUp(state.handler, 'continuity@example.test');
        const legacy = sessionCookieValue(response, state.names.legacy);
        const canonical = sessionCookieValue(response, state.names.canonical);
        expect(canonical).toBe(legacy);

        // Legacy-only is the rollback window: existing clients keep working.
        const legacyOnly = await getSession(state.handler, `${state.names.legacy}=${legacy}`);
        expect(legacyOnly.body?.user?.email).toBe('continuity@example.test');

        const dual = await getSession(
            state.handler,
            `${state.names.canonical}=${canonical}; ${state.names.legacy}=${legacy}`,
        );
        expect(dual.body?.user?.email).toBe('continuity@example.test');

        // Canonical-only is NOT rollback-compatible: rejected before Better Auth.
        const canonicalOnly = await state.handler(
            new Request(`${BASE_URL}/api/early-birds/auth/get-session`, {
                headers: { cookie: `${state.names.canonical}=${canonical}` },
            }),
        );
        await expectBridgeRejection(canonicalOnly, 401, state.names);
    });

    it('rejects conflicts, duplicates and malformed cookies before Better Auth', async () => {
        const state = bridge();
        const response = await signUp(state.handler, 'guarded@example.test');
        const legacy = sessionCookieValue(response, state.names.legacy);
        const other = (await signUp(state.handler, 'other@example.test'))
            .headers.getSetCookie().map((entry) => entry);
        const otherLegacy = other.find((entry) => entry.startsWith(`${state.names.legacy}=`))!;
        const otherValue = otherLegacy.slice(
            state.names.legacy.length + 1,
            otherLegacy.indexOf(';'),
        );

        const rejected: [string, 400 | 401][] = [
            // Conflicting canonical/legacy values are never arbitrated.
            [`${state.names.canonical}=${otherValue}; ${state.names.legacy}=${legacy}`, 400],
            // Duplicate same-name cookies are never silently selected.
            [`${state.names.canonical}=${legacy}; ${state.names.canonical}=${legacy}`, 400],
            [`${state.names.legacy}=${legacy}; ${state.names.legacy}=${legacy}`, 400],
            // Malformed percent encoding must not downgrade to the valid legacy cookie.
            [`${state.names.canonical}=${legacy.slice(0, 12)}%zz; ${state.names.legacy}=${legacy}`, 400],
            // Empty and oversized values.
            [`${state.names.canonical}=; ${state.names.legacy}=${legacy}`, 400],
            [`${state.names.legacy}=${'a'.repeat(513)}`, 400],
        ];
        for (const [cookie, status] of rejected) {
            const attempt = await state.handler(
                new Request(`${BASE_URL}/api/early-birds/auth/get-session`, {
                    headers: { cookie },
                }),
            );
            await expectBridgeRejection(attempt, status, state.names);
        }
        expect(state.database.session).toHaveLength(2);

        // A well-formed but unsigned value still fails Better Auth's own
        // verification, with the bridge passing it through untouched.
        const forged = await getSession(
            state.handler,
            `${state.names.legacy}=forged-token-without-signature`,
        );
        expect(forged.body).toBeNull();
    });

    it('never mints a session when sign-in or callback paths carry invalid cookies', async () => {
        const state = bridge();
        const duplicate = `${state.names.legacy}=aB3d.tokensig%3D; ${state.names.legacy}=aB3d.tokensig%3D`;

        // Sign-in: the minting path terminates before Better Auth runs.
        const blockedSignUp = await signUp(state.handler, 'blocked@example.test', duplicate);
        await expectBridgeRejection(blockedSignUp, 400, state.names);
        expect(state.database.user).toHaveLength(0);
        expect(state.database.session).toHaveLength(0);

        // OAuth callback: a GET minting path terminates the same way.
        const callback = await state.handler(
            new Request(`${BASE_URL}/api/early-birds/auth/callback/google?state=abc&code=def`, {
                headers: { origin: BASE_URL, cookie: duplicate },
            }),
        );
        await expectBridgeRejection(callback, 400, state.names);
        expect(state.database.session).toHaveLength(0);

        // Sign-in recovery: once the client honours the dual expiry and
        // retries clean, the very next sign-up mints an exact dual pair.
        const recovered = await signUp(state.handler, 'blocked@example.test');
        expect(recovered.status).toBe(200);
        const legacy = setCookieEntry(recovered, state.names.legacy);
        expect(setCookieEntry(recovered, state.names.canonical))
            .toBe(`${state.names.canonical}${legacy.slice(state.names.legacy.length)}`);
        expect(state.database.session).toHaveLength(1);
    });

    it('keeps two sessions of one account isolated and rejects crossed pairs', async () => {
        const state = bridge();
        // Two devices, ONE account: sign-up mints the first session, a real
        // sign-in of the same account mints an independent second one.
        const first = sessionCookieValue(
            await signUp(state.handler, 'listener@example.test'),
            state.names.legacy,
        );
        const second = sessionCookieValue(
            await signIn(state.handler, 'listener@example.test'),
            state.names.legacy,
        );
        expect(second).not.toBe(first);
        expect(state.database.user).toHaveLength(1);
        expect(state.database.session).toHaveLength(2);

        // Both independent tokens validate for the same account.
        const deviceA = await getSession(
            state.handler,
            `${state.names.canonical}=${first}; ${state.names.legacy}=${first}`,
        );
        expect(deviceA.body?.user?.email).toBe('listener@example.test');
        const deviceB = await getSession(state.handler, `${state.names.legacy}=${second}`);
        expect(deviceB.body?.user?.email).toBe('listener@example.test');

        // Crossing one device's canonical with the other's legacy rejects.
        const crossed = await state.handler(
            new Request(`${BASE_URL}/api/early-birds/auth/get-session`, {
                headers: {
                    cookie: `${state.names.legacy}=${first}; ${state.names.canonical}=${second}`,
                },
            }),
        );
        await expectBridgeRejection(crossed, 400, state.names);
        // Rejection is not revocation: both sessions remain valid afterwards.
        expect((await getSession(state.handler, `${state.names.legacy}=${first}`))
            .body?.user?.email).toBe('listener@example.test');
        expect((await getSession(state.handler, `${state.names.legacy}=${second}`))
            .body?.user?.email).toBe('listener@example.test');
    });

    it('clears both cookies with matching scope on sign-out and revokes the session', async () => {
        const state = bridge();
        const response = await signUp(state.handler, 'leaving@example.test');
        const legacy = sessionCookieValue(response, state.names.legacy);

        const signOut = await state.handler(new Request(`${BASE_URL}/api/early-birds/auth/sign-out`, {
            method: 'POST',
            headers: {
                origin: BASE_URL,
                'content-type': 'application/json',
                cookie: `${state.names.canonical}=${legacy}; ${state.names.legacy}=${legacy}`,
            },
            body: '{}',
        }));
        expect(signOut.status).toBe(200);
        for (const name of [state.names.legacy, state.names.canonical]) {
            const cleared = setCookieEntry(signOut, name);
            expect(cleared).toContain(`${name}=;`);
            expect(cleared).toContain('Max-Age=0');
            expect(cleared).toContain('Path=/');
            expect(cleared).toContain('HttpOnly');
            expect(cleared).toContain('SameSite=Lax');
            expect(cleared).toContain('Secure');
        }
        expect(state.database.session).toHaveLength(0);

        const after = await getSession(state.handler, `${state.names.legacy}=${legacy}`);
        expect(after.body).toBeNull();
    });

    it('clears both cookies when sign-out arrives legacy-only (rollback retention)', async () => {
        const state = bridge();
        const response = await signUp(state.handler, 'rollback-leaving@example.test');
        const legacy = sessionCookieValue(response, state.names.legacy);

        const signOut = await state.handler(new Request(`${BASE_URL}/api/early-birds/auth/sign-out`, {
            method: 'POST',
            headers: {
                origin: BASE_URL,
                'content-type': 'application/json',
                cookie: `${state.names.legacy}=${legacy}`,
            },
            body: '{}',
        }));
        expect(signOut.status).toBe(200);
        expect(state.database.session).toHaveLength(0);
        for (const name of [state.names.legacy, state.names.canonical]) {
            expect(setCookieEntry(signOut, name)).toContain('Max-Age=0');
        }
    });

    it('rejects a canonical-only sign-out without revoking the session', async () => {
        const state = bridge();
        const response = await signUp(state.handler, 'canonical-leaving@example.test');
        const canonical = sessionCookieValue(response, state.names.canonical);

        const signOut = await state.handler(new Request(`${BASE_URL}/api/early-birds/auth/sign-out`, {
            method: 'POST',
            headers: {
                origin: BASE_URL,
                'content-type': 'application/json',
                cookie: `${state.names.canonical}=${canonical}`,
            },
            body: '{}',
        }));
        await expectBridgeRejection(signOut, 401, state.names);
        expect(state.database.session).toHaveLength(1);
    });

    it('recovers a stale canonical cookie stranded by a deploy/rollback/redeploy sequence', async () => {
        const state = bridge();
        // The bare handler simulates the pre-bridge rollback image (20406):
        // the same Better Auth pipeline with no bridge and legacy name only.
        const legacyHandler: BridgedHandler = (request) => state.auth.handler(request);
        const signOutRequest = (handler: BridgedHandler, cookie: string) =>
            handler(new Request(`${BASE_URL}/api/early-birds/auth/sign-out`, {
                method: 'POST',
                headers: { origin: BASE_URL, 'content-type': 'application/json', cookie },
                body: '{}',
            }));

        // Bridge deploy: sign-up mints the byte-identical dual pair A.
        const deployed = await signUp(state.handler, 'rollback@example.test');
        expect(deployed.status).toBe(200);
        const tokenA = sessionCookieValue(deployed, state.names.legacy);
        expect(state.database.session).toHaveLength(1);

        // Rollback: the unwrapped legacy handler keeps accepting legacy-only.
        const rollbackSession = await getSession(legacyHandler, `${state.names.legacy}=${tokenA}`);
        expect(rollbackSession.body?.user?.email).toBe('rollback@example.test');

        // Old sign-out clears ONLY the legacy name; the canonical cookie
        // survives in the browser jar untouched.
        const oldSignOut = await signOutRequest(legacyHandler, `${state.names.legacy}=${tokenA}`);
        expect(oldSignOut.status).toBe(200);
        const oldSignOutCookies = oldSignOut.headers.getSetCookie();
        expect(oldSignOutCookies.some((entry) => entry.startsWith(`${state.names.legacy}=`))).toBe(true);
        expect(oldSignOutCookies.some((entry) => entry.startsWith(`${state.names.canonical}=`))).toBe(false);
        expect(state.database.session).toHaveLength(0);

        // Alternate timeline probe: redeploying the bridge right here would
        // face canonical-only A and answer 401 with the dual expiry, instead
        // of the unrecoverable 401-without-clear the first bridge revision
        // produced. (No server mutation: Better Auth never runs.)
        const canonicalOnly = await state.handler(
            new Request(`${BASE_URL}/api/early-birds/auth/get-session`, {
                headers: { cookie: `${state.names.canonical}=${tokenA}` },
            }),
        );
        await expectBridgeRejection(canonicalOnly, 401, state.names);

        // Old re-login: the rollback image ignores the canonical name, so it
        // mints a fresh legacy-only session B while stale canonical A persists.
        const oldRelogin = await signIn(
            legacyHandler,
            'rollback@example.test',
            `${state.names.canonical}=${tokenA}`,
        );
        expect(oldRelogin.status).toBe(200);
        const tokenB = sessionCookieValue(oldRelogin, state.names.legacy);
        expect(tokenB).not.toBe(tokenA);
        expect(oldRelogin.headers.getSetCookie()
            .some((entry) => entry.startsWith(`${state.names.canonical}=`))).toBe(false);

        // Redeploy the bridge: stale canonical A plus fresh legacy B is a
        // conflict. It fails closed and expires BOTH names; session B is not
        // revoked because Better Auth never ran.
        const stranded = await state.handler(
            new Request(`${BASE_URL}/api/early-birds/auth/get-session`, {
                headers: {
                    cookie: `${state.names.canonical}=${tokenA}; ${state.names.legacy}=${tokenB}`,
                },
            }),
        );
        await expectBridgeRejection(stranded, 400, state.names);
        expect(state.database.session).toHaveLength(1);

        // The browser honours the dual expiry: the next clean sign-in
        // succeeds and emits the exact byte-identical dual pair again.
        const recovered = await signIn(state.handler, 'rollback@example.test');
        expect(recovered.status).toBe(200);
        const legacy = setCookieEntry(recovered, state.names.legacy);
        expect(setCookieEntry(recovered, state.names.canonical))
            .toBe(`${state.names.canonical}${legacy.slice(state.names.legacy.length)}`);
    });

    it('rotates both cookies coherently when the refresh window elapses', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-08-08T10:00:00.000Z'));
        const state = bridge(1);
        const response = await signUp(state.handler, 'rotating@example.test');
        const initial = sessionCookieValue(response, state.names.legacy);

        vi.setSystemTime(new Date('2026-08-08T10:00:05.000Z'));
        const rotated = await getSession(state.handler, `${state.names.legacy}=${initial}`);
        expect(rotated.body?.user?.email).toBe('rotating@example.test');

        const legacy = setCookieEntry(rotated.response, state.names.legacy);
        const canonical = setCookieEntry(rotated.response, state.names.canonical);
        // Rotation re-signs the same token deterministically: values stay
        // byte-identical and both cookies move together.
        expect(sessionCookieValue(rotated.response, state.names.legacy)).toBe(initial);
        expect(canonical).toBe(`${state.names.canonical}${legacy.slice(state.names.legacy.length)}`);
    });
});

describe('Listener session-cookie observability over the real pipeline', () => {
    it('the auth handler records exactly one observation per invocation', async () => {
        const state = bridge();
        const before = snapshotListenerSessionCookieObservations();

        // Sign-up with no session cookie: one invocation, state `none`.
        const response = await signUp(
            state.handler,
            'observed@example.test',
            undefined,
            'listen.harmonicbeacon.com',
        );
        expect(response.status).toBe(200);
        const legacy = sessionCookieValue(response, state.names.legacy);

        // One dual-pair get-session: one invocation, state `dual_identical`.
        const dual = await getSession(
            state.handler,
            `${state.names.canonical}=${legacy}; ${state.names.legacy}=${legacy}`,
            'listen.harmonicbeacon.com',
        );
        expect(dual.body?.user?.email).toBe('observed@example.test');

        // One canonical-only rejection: one invocation, state `canonical_only`,
        // with the dual-clear behavior unchanged.
        const rejected = await state.handler(
            new Request(`${BASE_URL}/api/early-birds/auth/get-session`, {
                headers: {
                    host: 'listen.harmonicbeacon.com',
                    cookie: `${state.names.canonical}=${legacy}`,
                },
            }),
        );
        await expectBridgeRejection(rejected, 401, state.names);

        const after = snapshotListenerSessionCookieObservations();
        expect(after.counts.none - before.counts.none).toBe(1);
        expect(after.counts.dual_identical - before.counts.dual_identical).toBe(1);
        expect(after.counts.canonical_only - before.counts.canonical_only).toBe(1);
        expect(after.startedAtSeconds).toBe(before.startedAtSeconds);
    });
});
