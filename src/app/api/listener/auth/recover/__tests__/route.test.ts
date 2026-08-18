import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ findUnique: vi.fn(), deleteMany: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { listenerAccountSession: db } }));

import { GET, POST } from '../route';

function request(origin = 'https://earlybirds-staging.harmonicbeacon.com') {
    return new NextRequest('https://earlybirds-staging.harmonicbeacon.com/api/listener/auth/recover', {
        method: 'POST',
        headers: {
            host: 'earlybirds-staging.harmonicbeacon.com', origin,
            'sec-fetch-site': origin.includes('earlybirds-staging') ? 'same-origin' : 'same-site',
            'content-type': 'application/json',
            cookie: '__Host-hb_listener_account=local-cookie',
        },
        body: JSON.stringify({ mode: 'current', locale: 'es' }),
    });
}

describe('Listener same-origin central logout initiation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING', 's'.repeat(32));
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING', 'b'.repeat(32));
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENABLED', '1');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENVIRONMENT', 'staging');
        db.deleteMany.mockResolvedValue({ count: 1 });
    });
    afterEach(() => vi.unstubAllEnvs());

    it('deletes the local RP session before returning a signed Account initiation', async () => {
        db.findUnique.mockResolvedValue({
            id: 'local-session', issuer: 'https://account-staging.harmonicbeacon.com', sid: 'central-sid',
        });
        const response = await POST(request());
        const result = await response.json() as { url: string };
        const target = new URL(result.url);
        expect(response.status).toBe(200);
        expect(target.origin).toBe('https://account-staging.harmonicbeacon.com');
        expect(target.pathname).toBe('/account/logout');
        expect(target.searchParams.get('initiation')).toBeTruthy();
        expect(target.searchParams.get('lang')).toBe('es');
        expect(db.deleteMany).toHaveBeenCalledWith({
            where: { id: 'local-session', sid: 'central-sid' },
        });
        expect(response.headers.get('set-cookie')).toContain('Max-Age=0');
    });

    it('offers human confirmation when state_mismatch left no local RP session', async () => {
        db.findUnique.mockResolvedValue(null);
        const response = await POST(request());
        const result = await response.json() as { url: string; confirmation: boolean };
        const target = new URL(result.url);
        expect(response.status).toBe(200);
        expect(result.confirmation).toBe(true);
        expect(target.searchParams.has('initiation')).toBe(false);
        expect(target.searchParams.get('return_to'))
            .toBe('https://earlybirds-staging.harmonicbeacon.com/');
        expect(db.deleteMany).not.toHaveBeenCalled();
    });

    it('treats malformed or duplicate RP cookies as absent without throwing or querying by token', async () => {
        for (const cookie of [
            '__Host-hb_listener_account=%',
            '__Host-hb_listener_account=one; __Host-hb_listener_account=two',
        ]) {
            const malformed = request();
            malformed.headers.set('cookie', cookie);
            const response = await POST(malformed);
            expect(response.status).toBe(200);
            expect(await response.json()).toMatchObject({ confirmation: true });
        }
        expect(db.findUnique).not.toHaveBeenCalled();
    });

    it('rejects sibling-origin POSTs and every GET', async () => {
        expect((await POST(request('https://listen.harmonicbeacon.com'))).status).toBe(403);
        expect(GET().status).toBe(405);
        expect(db.findUnique).not.toHaveBeenCalled();
    });
});
