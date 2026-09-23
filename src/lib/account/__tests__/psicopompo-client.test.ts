import { afterEach, describe, expect, it, vi } from 'vitest';
import { activeAccountStaticClients, accountClientRequiresCompleteProfile } from '../config';
import { accountEndSessionRequest, accountRequestAllowed } from '../request-boundary';

const origin = 'https://account.harmonicbeacon.com';
const production = { BEACON_ACCOUNT_BASE_URL: origin };
const enabled = { ...production, BEACON_ACCOUNT_PSICOPOMPO_ENABLED: '1' };

describe('Psicopompo isolated confidential client', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('preserves the production inventory by default', () => {
        expect(activeAccountStaticClients(production).map(c => c.clientId))
            .toEqual(['hb-listener', 'hb-live']);
    });

    it('requires explicit activation and never activates on staging', () => {
        expect(activeAccountStaticClients(enabled).map(c => c.clientId))
            .toEqual(['hb-listener', 'hb-live', 'hb-psicopompo']);
        expect(activeAccountStaticClients({ ...enabled,
            BEACON_ACCOUNT_BASE_URL: 'https://account-staging.harmonicbeacon.com',
        }).map(c => c.clientId)).toEqual(['hb-listener-staging', 'hb-live-staging']);
    });

    it('pins the callback and profile without a logout redirect', () => {
        const client = activeAccountStaticClients(enabled).find(c => c.clientId === 'hb-psicopompo');
        expect(client?.redirectUri).toBe('https://psicopompo.altermundi.net/api/auth/beacon/callback');
        expect(client?.postLogoutRedirectUri).toBeNull();
        expect(accountClientRequiresCompleteProfile('hb-psicopompo', enabled)).toBe(true);
    });

    it('admits Basic token requests only with the gate and rejects global logout', async () => {
        vi.stubEnv('BEACON_ACCOUNT_BASE_URL', origin);
        vi.stubEnv('BEACON_ACCOUNT_PSICOPOMPO_ENABLED', '0');
        const tokenRequest = () => new Request(`${origin}/api/account/auth/oauth2/token`, {
            method: 'POST', headers: {
                'content-type': 'application/x-www-form-urlencoded',
                authorization: `Basic ${Buffer.from('hb-psicopompo:synthetic-secret').toString('base64')}`,
            }, body: new URLSearchParams({ grant_type: 'authorization_code', code: 'synthetic' }),
        });
        expect(await accountRequestAllowed(tokenRequest())).toBe(false);
        vi.stubEnv('BEACON_ACCOUNT_PSICOPOMPO_ENABLED', '1');
        expect(await accountRequestAllowed(tokenRequest())).toBe(true);
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO', 'synthetic-secret');
        const hint = `header.${Buffer.from(JSON.stringify({ iss: origin,
            aud: 'hb-psicopompo', sid: 'synthetic-session' })).toString('base64url')}.signature`;
        const logout = new Request(`${origin}/api/account/auth/oauth2/end-session?${new URLSearchParams({
            client_id: 'hb-psicopompo', id_token_hint: hint, state: 'a'.repeat(32),
            post_logout_redirect_uri: 'https://psicopompo.altermundi.net/api/auth/beacon/callback',
        })}`);
        expect(accountEndSessionRequest(logout)).toBeNull();
        expect(await accountRequestAllowed(logout)).toBe(false);
    });
});
