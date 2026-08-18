import { describe, expect, it, vi } from 'vitest';

vi.mock('@better-auth/oauth-provider', () => ({
    oauthProviderOpenIdConfigMetadata: () => async () => Response.json({
        issuer: 'https://account.harmonicbeacon.com',
        token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    }),
}));
vi.mock('@/lib/account/auth', () => ({ accountAuth: () => ({}) }));

import { GET } from './route';

describe('Account discovery confidential-client metadata', () => {
    it('advertises client_secret_basic exclusively for every client-authenticated endpoint', async () => {
        const response = await GET(new Request(
            'https://account.harmonicbeacon.com/.well-known/openid-configuration',
            { headers: { host: 'account.harmonicbeacon.com' } },
        ));
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            token_endpoint_auth_methods_supported: ['client_secret_basic'],
            introspection_endpoint_auth_methods_supported: ['client_secret_basic'],
            revocation_endpoint_auth_methods_supported: ['client_secret_basic'],
        });
    });
});
