import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const find = vi.hoisted(() => vi.fn());
const ready = vi.hoisted(() => vi.fn());
const limit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ prisma: { earlyBirdUser: { findUnique: find } } }));
vi.mock('@/lib/account/authority-db', () => ({ accountAuthorityDatabaseReady: ready }));
vi.mock('@/lib/account/rate-limit', () => ({ consumeAccountRateLimit: limit }));
import { POST } from './route';

const secret = 'synthetic-calendar-mail-secret-at-least-32';
function request(client = 'pmp-calendar-mail', body: unknown = { sub: 'synthetic-subject' }) {
    return new Request('https://account.harmonicbeacon.com/api/account/calendar-mail-profile', {
        method: 'POST', headers: { 'content-type': 'application/json',
            authorization: `Basic ${Buffer.from(`${client}:${secret}`).toString('base64')}` },
        body: JSON.stringify(body),
    });
}

describe('dedicated calendar mail current mailbox lookup', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('BEACON_ACCOUNT_BASE_URL', 'https://account.harmonicbeacon.com');
        vi.stubEnv('BEACON_ACCOUNT_CALENDAR_MAIL_ENABLED', '1');
        vi.stubEnv('BEACON_ACCOUNT_CALENDAR_MAIL_SERVICE_SECRET', secret);
        vi.stubEnv('BEACON_ACCOUNT_RATE_SECRET', 'synthetic-rate-secret-at-least-thirty-two-characters');
        ready.mockResolvedValue(true); limit.mockResolvedValue(true);
        find.mockResolvedValue({ id: 'synthetic-subject', email: 'synthetic@example.test' });
    });
    afterEach(() => vi.unstubAllEnvs());
    it('defaults off and does not query contacts', async () => {
        vi.stubEnv('BEACON_ACCOUNT_CALENDAR_MAIL_ENABLED', '');
        expect((await POST(request())).status).toBe(404);
        expect(find).not.toHaveBeenCalled();
    });
    it('returns only current subject and email, no profile or verification inference', async () => {
        const result = await POST(request());
        expect(result.status).toBe(200);
        expect(result.headers.get('cache-control')).toBe('private, no-store');
        expect(await result.json()).toEqual({ sub: 'synthetic-subject', email: 'synthetic@example.test' });
        expect(find).toHaveBeenCalledWith({ where: { id: 'synthetic-subject' },
            select: { id: true, email: true } });
    });
    it.each(['hb-live', 'hb-live-staging', 'hb-psicopompo', 'unknown'])(
        'rejects other client %s', async (client) => {
            expect((await POST(request(client))).status).toBe(401);
            expect(find).not.toHaveBeenCalled();
        });
    it('rejects missing secret and unavailable authority', async () => {
        vi.stubEnv('BEACON_ACCOUNT_CALENDAR_MAIL_SERVICE_SECRET', '');
        expect((await POST(request())).status).toBe(503);
        ready.mockResolvedValue(false);
        expect((await POST(request())).status).toBe(404);
    });
    it('rejects malformed and oversized requests', async () => {
        expect((await POST(request('pmp-calendar-mail', { sub: 'x', email: 'x' }))).status).toBe(400);
        expect((await POST(request('pmp-calendar-mail', { sub: 'x'.repeat(3000) }))).status).toBe(413);
        expect(find).not.toHaveBeenCalled();
    });
    it('does not expose missing or placeholder accounts and respects rate limits', async () => {
        find.mockResolvedValue(null);
        expect((await POST(request())).status).toBe(404);
        find.mockResolvedValue({ id: 'x', email: 'x@identity.invalid' });
        expect((await POST(request())).status).toBe(404);
        limit.mockResolvedValue(false);
        expect((await POST(request())).status).toBe(429);
    });
});
