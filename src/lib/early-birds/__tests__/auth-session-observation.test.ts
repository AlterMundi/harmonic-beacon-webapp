import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sessions = vi.hoisted(() => ({ findUnique: vi.fn() }));
vi.mock('@/lib/db', () => ({ prisma: { listenerAccountSession: sessions } }));

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { LISTENER_ACCOUNT_COOKIE } from '@/lib/listener/account-rp';

describe('currentEarlyBirdSession central Account cutover', () => {
    beforeEach(() => {
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_CLIENT_SECRET', 'listener-secret-with-at-least-32-characters');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_STATE_SECRET', 'listener-state-secret-with-at-least-32-characters');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENABLED', '1');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENVIRONMENT', 'production');
        sessions.findUnique.mockReset();
    });
    afterEach(() => vi.unstubAllEnvs());

    it('does not retain experimental Better Auth cookie compatibility', async () => {
        for (const cookie of [
            '__Secure-hb_earlybird_session=legacy',
            'hb_listener_session=canonical-bridge',
            '__Secure-hb_earlybird_session=legacy; hb_listener_session=bridge',
        ]) await expect(currentEarlyBirdSession(new Headers({
            host: 'listen.harmonicbeacon.com', cookie,
        }))).resolves.toBeNull();
        expect(sessions.findUnique).not.toHaveBeenCalled();
    });

    it('resolves only the new host-only Account RP session', async () => {
        const expiresAt = new Date(Date.now() + 60_000);
        sessions.findUnique.mockResolvedValue({
            id: '00000000-0000-4000-8000-000000000001',
            issuer: 'https://account.harmonicbeacon.com', subject: 'opaque-account',
            sid: 'central-sid', accountId: 'opaque-account', synthetic: false,
            expiresAt, lastCheckedAt: new Date(), revalidationLeaseUntil: null,
            createdAt: new Date(), tokenDigest: 'digest',
            account: {
                id: 'opaque-account', name: 'Provider Name', email: 'opaque@account.invalid',
                image: null, beaconProfile: { displayName: 'Beacon Name' },
            },
        });
        await expect(currentEarlyBirdSession(new Headers({
            host: 'listen.harmonicbeacon.com',
            cookie: `${LISTENER_ACCOUNT_COOKIE}=opaque-token`,
        }))).resolves.toEqual({
            user: {
                id: 'opaque-account', name: 'Beacon Name',
                email: 'opaque@account.invalid', image: null,
            },
            session: { id: '00000000-0000-4000-8000-000000000001', expiresAt },
        });
        expect(sessions.findUnique).toHaveBeenCalledOnce();
    });

    it('fails malformed and duplicate new cookies closed before database access', async () => {
        for (const cookie of [
            `${LISTENER_ACCOUNT_COOKIE}=%`,
            `${LISTENER_ACCOUNT_COOKIE}=one; ${LISTENER_ACCOUNT_COOKIE}=two`,
        ]) await expect(currentEarlyBirdSession(new Headers({
            host: 'listen.harmonicbeacon.com', cookie,
        }))).resolves.toBeNull();
        expect(sessions.findUnique).not.toHaveBeenCalled();
    });
});
