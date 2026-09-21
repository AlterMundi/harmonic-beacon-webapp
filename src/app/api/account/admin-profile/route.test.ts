import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findAccount = vi.hoisted(() => vi.fn());
const ready = vi.hoisted(() => vi.fn());
const limited = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ prisma: {
    earlyBirdUser: { findUnique: findAccount },
} }));
vi.mock('@/lib/account/authority-db', () => ({ accountAuthorityDatabaseReady: ready }));
vi.mock('@/lib/account/rate-limit', () => ({ consumeAccountRateLimit: limited }));

import { POST } from './route';

const secret = 'live-client-secret-that-is-at-least-thirty-two-characters';

function request(clientId = 'hb-live', clientSecret = secret, body: unknown = { sub: 'account-1' }) {
    return new Request('https://account.harmonicbeacon.com/api/account/admin-profile', {
        method: 'POST',
        headers: {
            host: 'account.harmonicbeacon.com', 'content-type': 'application/json',
            authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
        },
        body: JSON.stringify(body),
    });
}

describe('Live-only Account admin profile backchannel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('BEACON_ACCOUNT_BASE_URL', 'https://account.harmonicbeacon.com');
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE', secret);
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER', `${secret}-listener`);
        vi.stubEnv('BEACON_ACCOUNT_RATE_SECRET', `${secret}-rate`);
        ready.mockResolvedValue(true);
        limited.mockResolvedValue(true);
        findAccount.mockResolvedValue({
            id: 'account-1', email: 'nico@example.test', emailVerified: true,
            beaconProfile: { displayName: 'Nico', realName: 'Nicolás Echániz' },
        });
    });
    afterEach(() => vi.unstubAllEnvs());

    it('returns the private owner record only to a configured Live client', async () => {
        const response = await POST(request());
        expect(response.status).toBe(200);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
        expect(await response.json()).toEqual({
            sub: 'account-1', preferredName: 'Nico', realName: 'Nicolás Echániz',
            email: 'nico@example.test', emailVerified: true,
        });
        expect(findAccount).toHaveBeenCalledWith({
            where: { id: 'account-1' },
            select: {
                id: true, email: true, emailVerified: true,
                beaconProfile: { select: { displayName: true, realName: true } },
            },
        });
    });

    it('rejects Listener clients and wrong secrets before reading private data', async () => {
        for (const candidate of [
            request('hb-listener', `${secret}-listener`), request('hb-live', 'wrong-secret'),
        ]) expect((await POST(candidate)).status).toBe(401);
        expect(findAccount).not.toHaveBeenCalled();
    });

    it('returns no synthetic Apple address and does not guess a missing real name', async () => {
        findAccount.mockResolvedValue({
            id: 'account-1', email: 'apple-opaque@identity.invalid', emailVerified: false,
            beaconProfile: { displayName: 'Apple Alias', realName: null },
        });
        expect(await (await POST(request())).json()).toEqual({
            sub: 'account-1', preferredName: 'Apple Alias', realName: null,
            email: null, emailVerified: false,
        });
    });
});

