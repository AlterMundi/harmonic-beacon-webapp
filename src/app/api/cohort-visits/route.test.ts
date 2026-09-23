import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const { identity, record } = vi.hoisted(() => ({ identity: vi.fn(), record: vi.fn() }));
vi.mock('@/lib/principal', () => ({ accountIdentityFromToken: identity }));
vi.mock('@/lib/cohort-visits', () => ({ recordCohortVisit: record }));
import { POST } from './route';
const origin = 'https://live.harmonicbeacon.com';
function request(body: unknown = { surface: 'session' }, suppliedOrigin = origin, site = 'same-origin') {
    return new NextRequest(origin + '/api/cohort-visits', { method: 'POST',
        headers: { origin: suppliedOrigin, 'sec-fetch-site': site, cookie: 'hb_session=test-cookie' },
        body: JSON.stringify(body) });
}
describe('private authenticated observations', () => {
    beforeEach(() => {
        vi.stubEnv('TICKET_LOGIN_URL_PREFIX', origin);
        vi.clearAllMocks(); identity.mockResolvedValue({ issuer: 'server-issuer', subject: 'server-subject' });
        record.mockResolvedValue(true);
    });
    afterEach(() => vi.unstubAllEnvs());
    it('uses existing cookie and only server identity', async () => {
        const r = await POST(request());
        expect(r.status).toBe(202);
        expect(r.headers.get('cache-control')).toBe('private, no-store');
        expect(identity).toHaveBeenCalledWith('test-cookie');
        expect(record).toHaveBeenCalledWith({ issuer: 'server-issuer', subject: 'server-subject' }, 'session');
        expect(await r.json()).toEqual({ accepted: true, observed: true });
    });
    it.each([
        { surface: 'session', subject: 'forged' },
        { surface: 'landing', timestamp: '2020-01-01' },
        { surface: 'admin' }, null, [],
    ])('rejects uncontrolled fields %j', async body => {
        expect((await POST(request(body))).status).toBe(400); expect(identity).not.toHaveBeenCalled();
    });
    it('rejects cross-origin writes before checking identity', async () => {
        expect((await POST(request({}, 'https://other.invalid'))).status).toBe(403);
        expect((await POST(request({}, origin, 'cross-site'))).status).toBe(403);
        expect(identity).not.toHaveBeenCalled();
    });
    it('rejects absent/revoked/expired identity without writing', async () => {
        identity.mockResolvedValue(null);
        expect((await POST(request())).status).toBe(401); expect(record).not.toHaveBeenCalled();
    });
    it('reports a failure without leaking detail', async () => {
        record.mockRejectedValue(new Error('secret database detail'));
        const r = await POST(request());
        expect(r.status).toBe(503); expect(JSON.stringify(await r.json())).not.toContain('secret');
    });
    it('truthfully reports pre-cutoff non-observation', async () => {
        record.mockResolvedValue(false);
        expect(await (await POST(request())).json()).toEqual({ accepted: true, observed: false });
    });
});
