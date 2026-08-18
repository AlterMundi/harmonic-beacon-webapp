import { oauthProviderOpenIdConfigMetadata } from '@better-auth/oauth-provider';

import { accountAuth } from '@/lib/account/auth';
import { isAccountHost } from '@/lib/account/config';

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
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        introspection_endpoint_auth_methods_supported: ['client_secret_basic'],
        revocation_endpoint_auth_methods_supported: ['client_secret_basic'],
    }, { headers: response.headers });
}
