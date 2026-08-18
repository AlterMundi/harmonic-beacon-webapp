import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    user: vi.fn(), subject: vi.fn(), session: vi.fn(), findSession: vi.fn(), membership: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ prisma: {
    $transaction: async (apply: (transaction: unknown) => unknown) => apply({
        earlyBirdUser: { upsert: mocks.user },
        listenerAccountSubject: { upsert: mocks.subject },
        listenerAccountSession: { create: mocks.session },
    }),
    listenerAccountSession: { findUnique: mocks.findSession },
} }));
vi.mock('@/lib/early-birds/membership', () => ({ issueSyntheticMembership: mocks.membership }));

import {
    currentListenerAccountSession,
    LISTENER_ACCOUNT_COOKIE,
} from '@/lib/listener/account-rp';
import { POST } from '../route';

function request(secret = 's'.repeat(32), authOnly = false) {
    return new NextRequest('https://earlybirds-staging.harmonicbeacon.com/api/early-birds/test-login', {
        method: 'POST',
        headers: {
            host: 'earlybirds-staging.harmonicbeacon.com', 'x-forwarded-proto': 'https',
            authorization: `Bearer ${secret}`, 'content-type': 'application/json',
        },
        body: JSON.stringify({ email: 'listener@e2e.invalid', name: 'Synthetic Listener', authOnly }),
    });
}

describe('supervised Listener synthetic Account RP session', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('NODE_ENV', 'production');
        vi.stubEnv('EARLY_BIRDS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_TEST_ACCESS_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_TEST_LOGIN_SECRET', 's'.repeat(32));
        vi.stubEnv('EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED', '1');
        vi.stubEnv('EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS', 'earlybirds-staging.harmonicbeacon.com');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING', 'c'.repeat(32));
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_STATE_SECRET_STAGING', 'b'.repeat(32));
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENABLED', '1');
        vi.stubEnv('BEACON_LISTENER_ACCOUNT_ENVIRONMENT', 'staging');
    });
    afterEach(() => vi.unstubAllEnvs());

    it('mints only the canonical host-only RP cookie and issuer-bound local session', async () => {
        const response = await POST(request());
        expect(response.status).toBe(200);
        expect(response.headers.get('set-cookie')).toContain(`${LISTENER_ACCOUNT_COOKIE}=`);
        expect(response.headers.get('set-cookie')).toContain('Path=/; HttpOnly; Secure; SameSite=Lax');
        expect(response.headers.get('set-cookie')).not.toContain('hb_earlybird');
        expect(mocks.session).toHaveBeenCalledWith({ data: expect.objectContaining({
            issuer: 'https://account-staging.harmonicbeacon.com',
            subject: expect.stringMatching(/^test_/), synthetic: true,
        }) });
        expect(mocks.membership).toHaveBeenCalledOnce();

        const data = mocks.session.mock.calls[0]?.[0].data;
        mocks.findSession.mockResolvedValue({
            id: 'local-session', ...data,
            account: {
                id: data.accountId, name: 'Synthetic Listener', email: 'listener@e2e.invalid',
                image: null, beaconProfile: { displayName: 'Synthetic Listener' },
            },
        });
        const cookie = response.headers.get('set-cookie')!.split(';', 1)[0];
        const resolved = await currentListenerAccountSession(new Headers({
            host: 'earlybirds-staging.harmonicbeacon.com', cookie,
        }));
        expect(resolved?.user.id).toBe(data.accountId);
    });

    it('can mint identity-only state for invitation redemption', async () => {
        expect((await POST(request('s'.repeat(32), true))).status).toBe(200);
        expect(mocks.membership).not.toHaveBeenCalled();
    });

    it('remains hidden without the supervised bearer or on an unsafe host', async () => {
        expect((await POST(request('x'.repeat(32)))).status).toBe(404);
        const unsafe = request(); unsafe.headers.set('host', 'other.example.test');
        expect((await POST(unsafe)).status).toBe(404);
    });
});
