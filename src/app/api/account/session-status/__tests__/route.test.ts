import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ findUnique: vi.fn() }));
const ready = vi.hoisted(() => vi.fn());
const limited = vi.hoisted(() => vi.fn());

vi.mock('@/lib/db', () => ({
    prisma: { earlyBirdAuthSession: { findUnique: db.findUnique } },
}));
vi.mock('@/lib/account/authority-db', () => ({ accountAuthorityDatabaseReady: ready }));
vi.mock('@/lib/account/rate-limit', () => ({ consumeAccountRateLimit: limited }));

import { POST } from '../route';

const secret = 'complete-rp-secret-that-is-at-least-thirty-two-characters';

function request(body = new URLSearchParams({ sid: 'central-session', sub: 'opaque-account' }),
    contentType = 'application/x-www-form-urlencoded', clientId = 'hb-listener') {
    return new Request('https://account.harmonicbeacon.com/api/account/session-status', {
        method: 'POST',
        headers: {
            host: 'account.harmonicbeacon.com',
            authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
            'content-type': contentType,
        },
        body,
    });
}

describe('Account RP session status backchannel', () => {
    afterEach(() => vi.unstubAllEnvs());
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('BEACON_ACCOUNT_BASE_URL', 'https://account.harmonicbeacon.com');
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER', secret);
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE', `${secret}-live`);
        vi.stubEnv('BEACON_ACCOUNT_RATE_SECRET', `${secret}-rate`);
        ready.mockResolvedValue(true);
        limited.mockResolvedValue(true);
        db.findUnique.mockResolvedValue({
            userId: 'opaque-account',
            expiresAt: new Date(Date.now() + 60_000),
            securityRevision: 3,
            authorityEnvironment: 'production',
            user: { securityRevision: 3 },
        });
    });

    it('returns the exact issuer-bound active response with no PII', async () => {
        const response = await POST(request());
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('no-store');
        expect(await response.json()).toEqual({
            active: true,
            iss: 'https://account.harmonicbeacon.com',
            sub: 'opaque-account',
            sid: 'central-session',
        });
    });

    it('rejects non-form requests before parsing credentials or state', async () => {
        const response = await POST(request(new URLSearchParams(), 'application/json'));
        expect(response.status).toBe(415);
        expect(await response.json()).toEqual({ active: false });
        expect(db.findUnique).not.toHaveBeenCalled();
    });

    it('returns expiry only to the activated Psicopompo client', async () => {
        vi.stubEnv('BEACON_ACCOUNT_PSICOPOMPO_ENABLED', '1');
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO', secret);
        const expiresAt = new Date(Date.now() + 8 * 3600 * 1000);
        db.findUnique.mockResolvedValue({ userId: 'opaque-account', expiresAt,
            securityRevision: 3, authorityEnvironment: 'production', user: { securityRevision: 3 } });
        const response = await POST(request(undefined, undefined, 'hb-psicopompo'));
        expect(await response.json()).toEqual({ active: true,
            iss: 'https://account.harmonicbeacon.com', sub: 'opaque-account',
            sid: 'central-session', expires_at: Math.floor(expiresAt.getTime() / 1000),
        });
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE', secret);
        const live = await POST(request(undefined, undefined, 'hb-live'));
        expect(await live.json()).toEqual({ active: true,
            iss: 'https://account.harmonicbeacon.com', sub: 'opaque-account', sid: 'central-session',
        });
        vi.stubEnv('BEACON_ACCOUNT_PSICOPOMPO_ENABLED', '0');
        expect((await POST(request(undefined, undefined, 'hb-psicopompo'))).status).toBe(401);
    });

    it.each(['expired', 'revoked', 'wrong-subject', 'wrong-environment', 'missing'])(
        'fails closed without expiry or identity fields when %s', async (reason) => {
            vi.stubEnv('BEACON_ACCOUNT_PSICOPOMPO_ENABLED', '1');
            vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO', secret);
            db.findUnique.mockResolvedValue(reason === 'missing' ? null : {
                userId: reason === 'wrong-subject' ? 'another-account' : 'opaque-account',
                expiresAt: new Date(Date.now() + (reason === 'expired' ? -60_000 : 60_000)),
                securityRevision: 3,
                authorityEnvironment: reason === 'wrong-environment' ? 'staging' : 'production',
                user: { securityRevision: reason === 'revoked' ? 4 : 3 },
            });
            const response = await POST(request(undefined, undefined, 'hb-psicopompo'));
            expect(response.status).toBe(200);
            expect(await response.json()).toEqual({ active: false });
        },
    );

    it('returns no subject/session fields when inactive', async () => {
        db.findUnique.mockResolvedValue(null);
        const response = await POST(request());
        expect(await response.json()).toEqual({ active: false });
    });

    it('compares the full confidential-client secret without stripping a prefix', async () => {
        const wrong = request();
        wrong.headers.set('authorization', `Basic ${Buffer.from(
            `hb-listener:${secret.replace('complete-', '')}`,
        ).toString('base64')}`);
        const response = await POST(wrong);
        expect(response.status).toBe(401);
        expect(db.findUnique).not.toHaveBeenCalled();
    });
});
