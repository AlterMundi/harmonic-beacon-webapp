import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@better-auth/oauth-provider', () => ({
    oauthProviderOpenIdConfigMetadata: vi.fn(() => () => Response.json({
        issuer: 'https://account.harmonicbeacon.com',
        token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
        introspection_endpoint_auth_methods_supported: ['client_secret_post'],
        revocation_endpoint_auth_methods_supported: ['none'],
    })),
}));
vi.mock('@/lib/account/auth', () => ({ accountAuth: () => ({}) }));

import { GET } from '../route';

afterEach(() => vi.unstubAllEnvs());

describe('Account discovery confidential-client metadata', () => {
    it('advertises only client_secret_basic at every authenticated endpoint', async () => {
        vi.stubEnv('BEACON_ACCOUNT_BASE_URL', 'https://account.harmonicbeacon.com');
        const response = await GET(new Request(
            'https://account.harmonicbeacon.com/.well-known/openid-configuration',
            { headers: { host: 'account.harmonicbeacon.com' } },
        ));
        expect(response.status).toBe(200);
        const metadata = await response.json();
        expect(metadata.jwks_uri).toBe('https://account.harmonicbeacon.com/.well-known/jwks.json');
        expect(metadata.token_endpoint_auth_methods_supported).toEqual(['client_secret_basic']);
        expect(metadata.introspection_endpoint_auth_methods_supported).toEqual(['client_secret_basic']);
        expect(metadata.revocation_endpoint_auth_methods_supported).toEqual(['client_secret_basic']);
    });
});
