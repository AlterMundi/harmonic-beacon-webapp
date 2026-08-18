import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ deleteMany: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { listenerAccountSession: db } }));

import { signAccountFrontchannelLogout } from '@/lib/account/frontchannel-token';
import { GET } from '../route';

describe('Listener signed frontchannel logout boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENABLED', '1');
        db.deleteMany.mockResolvedValue({ count: 1 });
    });
    afterEach(() => vi.unstubAllEnvs());

    it.each([
        ['listen.harmonicbeacon.com', 'https://account.harmonicbeacon.com', 'hb-listener', 'p'],
        ['earlybirds-staging.harmonicbeacon.com', 'https://account-staging.harmonicbeacon.com', 'hb-listener-staging', 's'],
    ])('trusts only a signed matching Account issuer on %s', async (host, issuer, audience, secretChar) => {
        const staging = host.startsWith('earlybirds-staging');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENVIRONMENT', staging ? 'staging' : 'production');
        vi.stubEnv(staging ? 'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING'
            : 'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET', secretChar.repeat(32));
        vi.stubEnv(staging ? 'BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING'
            : 'BEACON_LISTENER_ACCOUNT_STATE_SECRET', (staging ? 'b' : 'a').repeat(32));
        const logoutToken = signAccountFrontchannelLogout({
            issuer, audience, sid: 'central-session', clientSecret: secretChar.repeat(32),
        });
        const response = await GET(new Request(
            `https://${host}/api/account/frontchannel-logout?logout_token=${encodeURIComponent(logoutToken)}`,
            { headers: { host } },
        ));
        expect(response.status).toBe(204);
        expect(response.headers.get('content-security-policy'))
            .toBe(`default-src 'none'; frame-ancestors ${issuer}`);
        expect(db.deleteMany).toHaveBeenCalledWith({
            where: { issuer, sid: 'central-session' },
        });
    });

    it('does not turn an unsigned cross-site GET into logout CSRF', async () => {
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENVIRONMENT', 'production');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_CLIENT_SECRET', 'p'.repeat(32));
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_STATE_SECRET', 'a'.repeat(32));
        const response = await GET(new Request(
            'https://listen.harmonicbeacon.com/api/account/frontchannel-logout',
            { headers: { host: 'listen.harmonicbeacon.com', cookie: '__Host-hb_listener_account=local-cookie' } },
        ));
        expect(response.status).toBe(400);
        expect(db.deleteMany).not.toHaveBeenCalled();
    });

    it('does not revoke a session for a tampered cross-site token', async () => {
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENVIRONMENT', 'production');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_CLIENT_SECRET', 'p'.repeat(32));
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_STATE_SECRET', 'a'.repeat(32));
        const valid = signAccountFrontchannelLogout({
            issuer: 'https://account.harmonicbeacon.com', audience: 'hb-listener',
            sid: 'central-session', clientSecret: 'p'.repeat(32),
        });
        const [payload, signature] = valid.split('.');
        const tampered = `${payload}.${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
        const response = await GET(new Request(
            `https://listen.harmonicbeacon.com/api/account/frontchannel-logout?logout_token=${tampered}`,
            { headers: { host: 'listen.harmonicbeacon.com' } },
        ));
        expect(response.status).toBe(400);
        expect(db.deleteMany).not.toHaveBeenCalled();
    });
});
