import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authHandler = vi.hoisted(() => vi.fn());
vi.mock('@/lib/early-birds/auth', () => {
    return {
        EARLY_BIRD_COOKIE_PREFIX: 'hb_earlybird',
        EARLY_BIRD_SESSION_COOKIE: 'hb_earlybird_session',
        LISTENER_SESSION_COOKIE: 'hb_listener_session',
        earlyBirdAuthHandler: authHandler,
    };
});

import { GET, POST } from '../route';

describe('Listener identity recovery boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('BEACON_LISTENER_AUTH_BASE_URL', 'https://listen.example.test');
        vi.stubEnv('BEACON_LISTENER_TRUSTED_ORIGINS', 'https://listen.example.test');
        authHandler.mockResolvedValue(new Response(null, { status: 204 }));
    });
    afterEach(() => vi.unstubAllEnvs());

    function request(origin = 'https://listen.example.test') {
        return new NextRequest('https://listen.example.test/api/listener/auth/recover', {
            method: 'POST',
            headers: {
                origin,
                cookie: '__Secure-hb_earlybird_session=opaque; hb_listener_invite=preserve-me',
            },
        });
    }

    it('revokes a valid session then clears only OAuth state and Listener sessions', async () => {
        const response = await POST(request());
        const cookies = response.headers.getSetCookie();

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ recovered: true });
        expect(authHandler).toHaveBeenCalledOnce();
        expect(cookies).toHaveLength(6);
        expect(cookies.map((cookie) => cookie.split('=', 1)[0]).sort()).toEqual([
            '__Secure-hb_earlybird.state',
            '__Secure-hb_earlybird_session',
            '__Secure-hb_listener_session',
            'hb_earlybird.state',
            'hb_earlybird_session',
            'hb_listener_session',
        ]);
        expect(cookies.every((cookie) => cookie.includes('Max-Age=0'))).toBe(true);
        expect(cookies.join(';')).not.toContain('preserve-me');
        expect(cookies.join(';')).not.toContain('invite');
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    });

    it('clears fixed browser credentials but does not claim success if revocation fails', async () => {
        authHandler.mockRejectedValueOnce(new Error('database unavailable'));
        const response = await POST(request());
        expect(response.status).toBe(503);
        expect(await response.json()).toEqual({ recovered: false });
        expect(response.headers.getSetCookie()).toHaveLength(6);
    });

    it.each([null, 'https://attacker.invalid', 'https://staging.example.test'])(
        'rejects missing, cross-site and merely trusted cross-host origins: %s',
        async (origin) => {
            if (origin === 'https://staging.example.test') {
                vi.stubEnv(
                    'BEACON_LISTENER_TRUSTED_ORIGINS',
                    'https://listen.example.test,https://staging.example.test',
                );
            }
            const crossOrigin = new NextRequest(
                'https://listen.example.test/api/listener/auth/recover',
                { method: 'POST', headers: origin ? { origin } : {} },
            );
            const response = await POST(crossOrigin);
            expect(response.status).toBe(403);
            expect(response.headers.getSetCookie()).toEqual([]);
            expect(authHandler).not.toHaveBeenCalled();
        },
    );

    it('does not mutate identity through GET', () => {
        const response = GET();
        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('POST');
        expect(response.headers.getSetCookie()).toEqual([]);
    });
});
