import { oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider';

import { accountAuth } from '@/lib/account/auth';
import { accountOrigin, isAccountHost } from '@/lib/account/config';

export async function GET(request: Request): Promise<Response> {
    if (!isAccountHost(request.headers.get('host') ?? new URL(request.url).host)) {
        return new Response(null, { status: 404 });
    }
    const response = await oauthProviderOpenIdConfigMetadata(accountAuth(), {
        headers: {
            'Cache-Control': 'public, max-age=300',
            'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        },
    })(request);
    if (!response.ok) return response;
    const metadata = await response.json() as Record<string, unknown>;
    return Response.json({
        ...metadata,
        // oauth-provider 1.6.30 derives this path from Better Auth's mounted
        // base path, while our reviewed public JWKS route is issuer-rooted.
        // Publish only the route that is actually exposed by the Account edge.
        jwks_uri: `${accountOrigin()}/.well-known/jwks.json`,
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        introspection_endpoint_auth_methods_supported: ['client_secret_basic'],
        revocation_endpoint_auth_methods_supported: ['client_secret_basic'],
    }, { headers: response.headers });
}
