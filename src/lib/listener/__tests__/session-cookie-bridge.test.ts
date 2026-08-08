import { describe, expect, it, vi } from 'vitest';

import {
    LISTENER_SESSION_COOKIE,
    listenerSessionAuthHandler,
    listenerSessionClearCookies,
    listenerSessionCookieNames,
    listenerSessionSetCookieMirrors,
    mirrorListenerSessionResponse,
    resolveListenerSessionCookie,
} from '@/lib/listener/session-cookie-bridge';

const NAMES = listenerSessionCookieNames('hb_earlybird_session');
const SECURE_NAMES = listenerSessionCookieNames('__Secure-hb_earlybird_session');

// Shape of a Better Auth signed session value on the wire:
// encodeURIComponent(`${token}.${base64 HMAC}`).
const VALUE = 'm1V0k2NlR3JlVG9rZW4.x%2B9ab%2Fcd%3D';
const OTHER_VALUE = '90mV0k2NlR3JlVG9rZW4.qwert%2Fyuiop%3D';

function setCookiesOf(response: Response): string[] {
    return response.headers.getSetCookie();
}

describe('Listener session-cookie bridge names', () => {
    it('derives the canonical name from the resolved legacy name and its security posture', () => {
        expect(LISTENER_SESSION_COOKIE).toBe('hb_listener_session');
        expect(NAMES).toEqual({
            legacy: 'hb_earlybird_session',
            canonical: 'hb_listener_session',
            scope: { path: '/', httpOnly: true, sameSite: 'Lax', secure: false },
        });
        expect(SECURE_NAMES).toEqual({
            legacy: '__Secure-hb_earlybird_session',
            canonical: '__Secure-hb_listener_session',
            scope: { path: '/', httpOnly: true, sameSite: 'Lax', secure: true },
        });
    });

    it('honours the scope Better Auth resolved instead of re-deriving it', () => {
        const resolved = listenerSessionCookieNames('hb_earlybird_session', {
            path: '/',
            httpOnly: true,
            sameSite: 'Lax',
            secure: true,
        });
        expect(resolved.scope).toEqual({
            path: '/',
            httpOnly: true,
            sameSite: 'Lax',
            secure: true,
        });
    });
});

describe('listenerSessionClearCookies', () => {
    it('expires both exact names with the resolved scope and no value or Domain', () => {
        expect(listenerSessionClearCookies(SECURE_NAMES)).toEqual([
            `${SECURE_NAMES.legacy}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`,
            `${SECURE_NAMES.canonical}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`,
        ]);
    });

    it('matches the non-secure scope when Better Auth resolved plain names', () => {
        expect(listenerSessionClearCookies(NAMES)).toEqual([
            `${NAMES.legacy}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
            `${NAMES.canonical}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`,
        ]);
    });
});

describe('resolveListenerSessionCookie', () => {
    it('forwards requests without any session cookie', () => {
        expect(resolveListenerSessionCookie(null, NAMES))
            .toEqual({ kind: 'forward', header: null });
        const header = 'other=1; hb_earlybird_device_id=abc';
        expect(resolveListenerSessionCookie(header, NAMES))
            .toEqual({ kind: 'forward', header });
    });

    it('forwards a legacy-only session unchanged for rollback compatibility', () => {
        const header = `cart=1; ${NAMES.legacy}=${VALUE}`;
        expect(resolveListenerSessionCookie(header, NAMES))
            .toEqual({ kind: 'forward', header });
    });

    it('forwards a byte-identical dual pair unchanged', () => {
        const header = `${NAMES.canonical}=${VALUE}; ${NAMES.legacy}=${VALUE}`;
        expect(resolveListenerSessionCookie(header, NAMES))
            .toEqual({ kind: 'forward', header });
    });

    it('rejects a canonical-only session instead of relabelling it as legacy', () => {
        expect(resolveListenerSessionCookie(
            `cart=1; ${NAMES.canonical}=${VALUE}; theme=dark`,
            NAMES,
        )).toEqual({ kind: 'reject', status: 401 });
    });

    it('rejects conflicting canonical/legacy values instead of arbitrating', () => {
        const header = `cart=1; ${NAMES.canonical}=${OTHER_VALUE}; ${NAMES.legacy}=${VALUE}`;
        expect(resolveListenerSessionCookie(header, NAMES))
            .toEqual({ kind: 'reject', status: 400 });
    });

    it('rejects duplicate cookies of either name instead of letting first-wins decide', () => {
        for (const header of [
            `${NAMES.canonical}=${VALUE}; ${NAMES.canonical}=${VALUE}`,
            `${NAMES.canonical}=${VALUE}; ${NAMES.canonical}=${OTHER_VALUE}; ${NAMES.legacy}=${VALUE}`,
            `${NAMES.legacy}=${VALUE}; ${NAMES.legacy}=${VALUE}`,
            `${NAMES.legacy}=${VALUE}; ${NAMES.legacy}=${OTHER_VALUE}`,
        ]) {
            expect(resolveListenerSessionCookie(header, NAMES), header)
                .toEqual({ kind: 'reject', status: 400 });
        }
    });

    it('rejects malformed percent encoding even alongside a valid cookie', () => {
        for (const header of [
            `${NAMES.canonical}=${VALUE.slice(0, 10)}%zz; ${NAMES.legacy}=${VALUE}`,
            `${NAMES.canonical}=${VALUE}; ${NAMES.legacy}=${VALUE.slice(0, 10)}%2g`,
            `${NAMES.legacy}=${VALUE.slice(0, 10)}%`,
        ]) {
            expect(resolveListenerSessionCookie(header, NAMES), header)
                .toEqual({ kind: 'reject', status: 400 });
        }
    });

    it('rejects empty, non-wire, control-character or oversized session values', () => {
        for (const header of [
            `${NAMES.canonical}=; ${NAMES.legacy}=${VALUE}`,
            `${NAMES.legacy}==${VALUE}`,
            `${NAMES.legacy}=${'a'.repeat(513)}`,
            `${NAMES.canonical}=${VALUE}, ${NAMES.canonical}=${OTHER_VALUE}`,
            // Control characters embedded in a value never match the wire charset.
            `${NAMES.legacy}=${VALUE.slice(0, 5)}\t${VALUE.slice(5)}`,
            `${NAMES.canonical}=${VALUE.slice(0, 5)} ${VALUE.slice(5)}; ${NAMES.legacy}=${VALUE}`,
        ]) {
            const resolution = resolveListenerSessionCookie(header, NAMES);
            expect(resolution.kind, header).toBe('reject');
        }
    });

    it('rejects an oversized header carrying a session cookie entirely', () => {
        const filler = `filler=${'f'.repeat(9000)}`;
        const header = `${NAMES.legacy}=${VALUE}; ${filler}`;
        expect(resolveListenerSessionCookie(header, NAMES))
            .toEqual({ kind: 'reject', status: 400 });
    });

    it('ignores cookies that merely share a prefix with the session names', () => {
        const header = `${NAMES.legacy}_backup=${VALUE}; ${NAMES.legacy}=${VALUE}`;
        expect(resolveListenerSessionCookie(header, NAMES))
            .toEqual({ kind: 'forward', header });
    });
});

describe('listenerSessionSetCookieMirrors', () => {
    it('mirrors a single legacy mint with byte-identical value and attributes', () => {
        const emitted = `${SECURE_NAMES.legacy}=${VALUE}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure`;
        expect(listenerSessionSetCookieMirrors([emitted], SECURE_NAMES)).toEqual([
            `${SECURE_NAMES.canonical}=${VALUE}; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax; Secure`,
        ]);
    });

    it('mirrors a single legacy clear as a dual clear with matching scope', () => {
        const expired = `${SECURE_NAMES.legacy}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`;
        expect(listenerSessionSetCookieMirrors([expired], SECURE_NAMES)).toEqual([
            `${SECURE_NAMES.canonical}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`,
        ]);
    });

    it('leaves an already byte-identical dual output untouched', () => {
        const emitted = [
            `${SECURE_NAMES.legacy}=${VALUE}; Max-Age=2592000; Path=/; HttpOnly; Secure`,
            `${SECURE_NAMES.canonical}=${VALUE}; Max-Age=2592000; Path=/; HttpOnly; Secure`,
        ];
        expect(listenerSessionSetCookieMirrors(emitted, SECURE_NAMES)).toEqual([]);
    });

    it('never mirrors OAuth state, PKCE, CSRF or other cookies', () => {
        expect(listenerSessionSetCookieMirrors([
            `hb_earlybird.state=${VALUE}; Max-Age=300; Path=/; HttpOnly`,
            `hb_earlybird.pkce=${VALUE}; Max-Age=300; Path=/; HttpOnly`,
            `${NAMES.legacy}_backup=${VALUE}; Path=/`,
            'unrelated=1; Path=/',
        ], NAMES)).toEqual([]);
    });

    it('fails ambiguous output instead of appending another canonical', () => {
        const mint = `${NAMES.legacy}=${VALUE}; Path=/; HttpOnly`;
        const ambiguous: string[][] = [
            // More than one same-name mutation.
            [mint, `${NAMES.legacy}=${OTHER_VALUE}; Path=/; HttpOnly`],
            [mint, `${NAMES.canonical}=${VALUE}; Path=/; HttpOnly`, `${NAMES.canonical}=${VALUE}; Path=/; HttpOnly`],
            // A canonical mutation without a legacy counterpart.
            [`${NAMES.canonical}=${VALUE}; Path=/; HttpOnly`],
            // A pair whose values or security attributes differ.
            [mint, `${NAMES.canonical}=${OTHER_VALUE}; Path=/; HttpOnly`],
            [mint, `${NAMES.canonical}=${VALUE}; Path=/; HttpOnly; Secure`],
        ];
        for (const entries of ambiguous) {
            expect(listenerSessionSetCookieMirrors(entries, NAMES), entries.join(' | '))
                .toBeNull();
        }
    });
});

describe('bridge response wrapper', () => {
    it('appends the canonical mirror while preserving status, body and other headers', async () => {
        const headers = new Headers({ 'content-type': 'application/json' });
        headers.append('set-cookie', `${NAMES.legacy}=${VALUE}; Path=/; HttpOnly`);
        headers.append('set-cookie', 'hb_earlybird.state=abc; Path=/; HttpOnly');
        const response = new Response(JSON.stringify({ ok: true }), { status: 201, headers });

        const mirrored = mirrorListenerSessionResponse(response, NAMES);
        expect(mirrored.status).toBe(201);
        expect(mirrored.headers.get('content-type')).toBe('application/json');
        expect(setCookiesOf(mirrored)).toEqual([
            `${NAMES.legacy}=${VALUE}; Path=/; HttpOnly`,
            'hb_earlybird.state=abc; Path=/; HttpOnly',
            `${NAMES.canonical}=${VALUE}; Path=/; HttpOnly`,
        ]);
        await expect(mirrored.json()).resolves.toEqual({ ok: true });
    });

    it('returns the original response when nothing needs mirroring', () => {
        const response = new Response(null, { status: 204 });
        expect(mirrorListenerSessionResponse(response, NAMES)).toBe(response);
    });

    it('replaces ambiguous Better Auth output with a generic 500 and no Set-Cookie', async () => {
        const headers = new Headers();
        headers.append('set-cookie', `${NAMES.legacy}=${VALUE}; Path=/; HttpOnly`);
        headers.append('set-cookie', `${NAMES.legacy}=${OTHER_VALUE}; Path=/; HttpOnly`);
        const response = new Response('secret session body', { status: 200, headers });

        const mirrored = mirrorListenerSessionResponse(response, NAMES);
        expect(mirrored.status).toBe(500);
        expect(setCookiesOf(mirrored)).toEqual([]);
        await expect(mirrored.text()).resolves.not.toContain('secret session body');
    });
});

describe('listenerSessionAuthHandler', () => {
    function mintingHandler() {
        return vi.fn(async () => {
            const headers = new Headers();
            headers.append('set-cookie', `${NAMES.legacy}=${VALUE}; Path=/; HttpOnly`);
            return new Response('ok', { headers });
        });
    }

    it('terminates invalid states before the handler, expiring both names generically', async () => {
        const inner = mintingHandler();
        const handler = listenerSessionAuthHandler(inner, NAMES);

        for (const [cookie, status] of [
            [`${NAMES.canonical}=${VALUE}`, 401],
            [`${NAMES.legacy}=${VALUE}; ${NAMES.legacy}=${VALUE}`, 400],
            [`${NAMES.canonical}=${OTHER_VALUE}; ${NAMES.legacy}=${VALUE}`, 400],
            [`${NAMES.legacy}=${VALUE.slice(0, 10)}%zz`, 400],
        ] as const) {
            const response = await handler(new Request('https://listen.example.test/x', {
                headers: { cookie },
            }));
            expect(response.status, cookie).toBe(status);
            // Exactly the two expiry cookies, never an auth token, and the
            // rejected value is never echoed back.
            expect(setCookiesOf(response), cookie).toEqual(
                listenerSessionClearCookies(NAMES),
            );
            const body = await response.text();
            expect(body).not.toContain(VALUE);
            expect(body).not.toContain(OTHER_VALUE);
        }
        expect(inner).not.toHaveBeenCalled();
    });

    it('expires both names with Secure when the resolved scope is secure', async () => {
        const handler = listenerSessionAuthHandler(mintingHandler(), SECURE_NAMES);
        const response = await handler(new Request('https://listen.example.test/x', {
            headers: { cookie: `${SECURE_NAMES.canonical}=${VALUE}` },
        }));
        expect(response.status).toBe(401);
        expect(setCookiesOf(response)).toEqual([
            `${SECURE_NAMES.legacy}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`,
            `${SECURE_NAMES.canonical}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax; Secure`,
        ]);
    });

    it('stays recoverable: an accepted state after a rejection still reaches the handler', async () => {
        const inner = mintingHandler();
        const handler = listenerSessionAuthHandler(inner, NAMES);

        const rejected = await handler(new Request('https://listen.example.test/x', {
            headers: { cookie: `${NAMES.canonical}=${VALUE}` },
        }));
        expect(rejected.status).toBe(401);
        expect(inner).not.toHaveBeenCalled();

        // The client honoured the dual expiry and retries with no session
        // cookie: the minting path runs and mirrors the fresh dual pair.
        const response = await handler(new Request('https://listen.example.test/x'));
        expect(response.status).toBe(200);
        expect(setCookiesOf(response)).toEqual([
            `${NAMES.legacy}=${VALUE}; Path=/; HttpOnly`,
            `${NAMES.canonical}=${VALUE}; Path=/; HttpOnly`,
        ]);
        expect(inner).toHaveBeenCalledOnce();
    });

    it('forwards accepted states untouched and mirrors the minted pair', async () => {
        const seenCookies: (string | null)[] = [];
        const handler = listenerSessionAuthHandler(async (request) => {
            seenCookies.push(request.headers.get('cookie'));
            const headers = new Headers();
            headers.append('set-cookie', `${NAMES.legacy}=${VALUE}; Path=/; HttpOnly`);
            return new Response('ok', { headers });
        }, NAMES);

        const dual = `${NAMES.canonical}=${VALUE}; ${NAMES.legacy}=${VALUE}`;
        for (const cookie of [null, `${NAMES.legacy}=${VALUE}`, dual]) {
            const response = await handler(new Request('https://listen.example.test/x', {
                headers: cookie ? { cookie } : {},
            }));
            expect(response.status).toBe(200);
            expect(setCookiesOf(response)).toEqual([
                `${NAMES.legacy}=${VALUE}; Path=/; HttpOnly`,
                `${NAMES.canonical}=${VALUE}; Path=/; HttpOnly`,
            ]);
        }
        expect(seenCookies).toEqual([null, `${NAMES.legacy}=${VALUE}`, dual]);
    });
});
