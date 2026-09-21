import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const findProfile = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ prisma: {
    beaconProfile: { findUnique: findProfile },
} }));

import {
    accountOAuthProfileCompletionRequired,
    accountUserInfoClaims,
} from '@/lib/account/profile-claims';

describe('Account OIDC profile boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv('BEACON_ACCOUNT_BASE_URL', 'https://account.harmonicbeacon.com');
    });
    afterEach(() => vi.unstubAllEnvs());

    it('publishes preferred and completion claims without the private name', async () => {
        findProfile.mockResolvedValue({
            displayName: 'Nico', realName: 'Nicolás Echániz', revision: 4,
        });
        const claims = await accountUserInfoClaims({
            user: { id: 'account-1', email: 'nico@example.test' },
            scopes: ['openid', 'profile', 'email'],
        });
        expect(claims).toMatchObject({
            name: 'Nico', preferred_name: 'Nico', profile_revision: 4,
            profile_complete: true,
        });
        expect(claims).not.toHaveProperty('realName');
        expect(claims).not.toHaveProperty('real_name');
    });

    it('marks legacy/provider profiles incomplete without inferring a private name', async () => {
        findProfile.mockResolvedValue({ displayName: 'Provider Name', realName: null, revision: 1 });
        expect(await accountUserInfoClaims({
            user: { id: 'google-account', email: 'google@example.test' },
            scopes: ['openid', 'profile'],
        })).toMatchObject({ profile_complete: false, preferred_name: 'Provider Name' });
    });

    it('gates incomplete profiles only for the configured Live clients', async () => {
        findProfile.mockResolvedValue({ displayName: 'Alias', realName: null });
        await expect(accountOAuthProfileCompletionRequired('account-1', 'hb-listener'))
            .resolves.toBe(false);
        expect(findProfile).not.toHaveBeenCalled();
        await expect(accountOAuthProfileCompletionRequired('account-1', 'hb-live'))
            .resolves.toBe(true);
        findProfile.mockResolvedValue({ displayName: 'Alias', realName: 'Single' });
        await expect(accountOAuthProfileCompletionRequired('account-1', 'hb-live'))
            .resolves.toBe(false);
    });

    it('does not expose a synthetic provider email through the email scope', async () => {
        findProfile.mockResolvedValue({ displayName: 'Apple', realName: null, revision: 1 });
        expect(await accountUserInfoClaims({
            user: { id: 'apple-account', email: 'apple-opaque@identity.invalid' },
            scopes: ['openid', 'email'],
        })).toMatchObject({ email: undefined, email_verified: false });
    });
});
