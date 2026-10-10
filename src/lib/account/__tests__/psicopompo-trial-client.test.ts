import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    accountClientRequiresCompleteProfile, accountStaticClientSecrets,
    accountTrustedOrigins, activeAccountStaticClients,
} from '../config';
import { accountEndSessionRequest, accountRequestAllowed } from '../request-boundary';

const origin = 'https://account.harmonicbeacon.com';
const production = { BEACON_ACCOUNT_BASE_URL: origin };
const trial = { ...production, BEACON_ACCOUNT_PSICOPOMPO_TRIAL_ENABLED: '1' };
const callback = 'https://pruebas.psicopompo.altermundi.net/api/auth/beacon/callback';
const trialId = 'hb-psicopompo-trial';

describe('Psicopompo VM trial confidential client', () => {
    afterEach(() => vi.unstubAllEnvs());

    it.each([undefined, '0', 'yes'])('does not activate with flag %s, even with a secret', (flag) => {
        const env = { ...production, BEACON_ACCOUNT_PSICOPOMPO_TRIAL_ENABLED: flag,
            BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO_TRIAL: 'synthetic-trial-secret' };
        expect(activeAccountStaticClients(env).map(c => c.clientId)).toEqual(['hb-listener', 'hb-live']);
        expect(accountClientRequiresCompleteProfile(trialId, env)).toBe(false);
    });

    it('activates independently of the production Psicopompo client', () => {
        expect(activeAccountStaticClients(trial).map(c => c.clientId))
            .toEqual(['hb-listener', 'hb-live', trialId]);
        expect(activeAccountStaticClients({ ...trial, BEACON_ACCOUNT_PSICOPOMPO_ENABLED: '1' })
            .map(c => c.clientId)).toEqual(['hb-listener', 'hb-live', 'hb-psicopompo', trialId]);
        expect(activeAccountStaticClients({ ...production, BEACON_ACCOUNT_PSICOPOMPO_ENABLED: '1' })
            .map(c => c.clientId)).toEqual(['hb-listener', 'hb-live', 'hb-psicopompo']);
    });

    it('excludes both Psicopompo clients on staging despite enabled flags', () => {
        const env = { ...trial, BEACON_ACCOUNT_PSICOPOMPO_ENABLED: '1',
            BEACON_ACCOUNT_BASE_URL: 'https://account-staging.harmonicbeacon.com' };
        expect(activeAccountStaticClients(env).map(c => c.clientId))
            .toEqual(['hb-listener-staging', 'hb-live-staging']);
        expect(accountClientRequiresCompleteProfile(trialId, env)).toBe(false);
    });

    it('pins only the trial callback and requires the complete profile without a logout redirect', () => {
        const definition = activeAccountStaticClients(trial).find(c => c.clientId === trialId);
        expect(definition).toEqual({ clientId: trialId,
            secretVariable: 'BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO_TRIAL',
            redirectUri: callback, postLogoutRedirectUri: null, requiresCompleteProfile: true });
        expect(accountClientRequiresCompleteProfile(trialId, trial)).toBe(true);
        expect(accountTrustedOrigins(trial)).toEqual([origin]);
    });

    it('resolves the trial secret separately from the production client', () => {
        const clients = accountStaticClientSecrets({ ...trial,
            BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO: 'synthetic-production-secret',
            BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO_TRIAL: 'synthetic-trial-secret' });
        expect(clients.find(c => c.clientId === trialId)?.clientSecret).toBe('synthetic-trial-secret');
        expect(clients.find(c => c.clientId === 'hb-psicopompo')?.clientSecret)
            .toBe('synthetic-production-secret');
    });

    it('admits the trial backchannel only with its own gate and excludes it on staging', async () => {
        vi.stubEnv('BEACON_ACCOUNT_BASE_URL', origin);
        vi.stubEnv('BEACON_ACCOUNT_PSICOPOMPO_ENABLED', '1');
        vi.stubEnv('BEACON_ACCOUNT_PSICOPOMPO_TRIAL_ENABLED', '0');
        const tokenRequest = () => new Request(`${origin}/api/account/auth/oauth2/token`, {
            method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded',
                authorization: `Basic ${Buffer.from(`${trialId}:synthetic-trial-secret`).toString('base64')}` },
            body: new URLSearchParams({ grant_type: 'authorization_code', code: 'synthetic' }),
        });
        expect(await accountRequestAllowed(tokenRequest())).toBe(false);
        vi.stubEnv('BEACON_ACCOUNT_PSICOPOMPO_TRIAL_ENABLED', '1');
        expect(await accountRequestAllowed(tokenRequest())).toBe(true);
        vi.stubEnv('BEACON_ACCOUNT_BASE_URL', 'https://account-staging.harmonicbeacon.com');
        expect(await accountRequestAllowed(tokenRequest())).toBe(false);
    });

    it('does not admit the callback as a global logout redirect', async () => {
        vi.stubEnv('BEACON_ACCOUNT_BASE_URL', origin);
        vi.stubEnv('BEACON_ACCOUNT_PSICOPOMPO_TRIAL_ENABLED', '1');
        vi.stubEnv('BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO_TRIAL', 'synthetic-trial-secret');
        const hint = `header.${Buffer.from(JSON.stringify({ iss: origin,
            aud: trialId, sid: 'synthetic-session' })).toString('base64url')}.signature`;
        const logout = new Request(`${origin}/api/account/auth/oauth2/end-session?${new URLSearchParams({
            client_id: trialId, id_token_hint: hint, state: 'a'.repeat(32), post_logout_redirect_uri: callback,
        })}`);
        expect(accountEndSessionRequest(logout)).toBeNull();
        expect(await accountRequestAllowed(logout)).toBe(false);
    });
});
