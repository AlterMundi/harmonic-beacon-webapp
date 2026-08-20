import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET } from './route';

function request(path = '/api/account/login', host = 'listen.harmonicbeacon.com') {
    return new Request(`http://127.0.0.1:3000${path}`, { headers: { host } });
}

describe('Listener Account login handoff', () => {
    const fetchMock = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('fetch', fetchMock);
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENABLED', '1');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENVIRONMENT', 'production');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_CLIENT_SECRET', 'p'.repeat(32));
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_STATE_SECRET', 's'.repeat(32));
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('preserves explicit sign-in and clears any logout suppression', async () => {
        const response = await GET(request());
        expect(response.status).toBe(302);
        expect(response.headers.get('location'))
            .toMatch(/^https:\/\/account\.harmonicbeacon\.com\/api\/account\/auth\/oauth2\/authorize\?/);
        expect(response.headers.get('set-cookie')).toContain('__Host-hb_listener_account_attempt=');
        expect(response.headers.get('set-cookie'))
            .toContain('__Host-hb_listener_account_auto_handoff=;');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('preflights a healthy issuer before the automatic top-level handoff', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        const response = await GET(request('/api/account/login?auto=1'));
        expect(response.status).toBe(302);
        expect(response.headers.get('location')).toContain('account.harmonicbeacon.com');
        expect(response.headers.get('set-cookie')).toContain('__Host-hb_listener_account_attempt=');
        expect(response.headers.get('set-cookie'))
            .not.toContain('__Host-hb_listener_account_auto_handoff=;');
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it('returns to a bounded visible retry when Account is unavailable', async () => {
        fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
        const response = await GET(request('/api/account/login?auto=1'));
        expect(response.status).toBe(302);
        expect(response.headers.get('location'))
            .toBe('https://listen.harmonicbeacon.com/?accountUnavailable=1');
        expect(response.headers.get('set-cookie'))
            .toContain('__Host-hb_listener_account_auto_handoff=1');
        expect(response.headers.get('set-cookie'))
            .not.toContain('__Host-hb_listener_account_attempt=');
    });

    it('does not accept an internal or sibling Host', async () => {
        expect((await GET(request('/api/account/login?auto=1', '127.0.0.1:3000'))).status)
            .toBe(404);
        expect((await GET(request('/api/account/login?auto=1', 'live.harmonicbeacon.com'))).status)
            .toBe(404);
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
