import { accountAuth } from '@/lib/account/auth';
import { isAccountHost } from '@/lib/account/config';

export async function GET(request: Request): Promise<Response> {
    if (!isAccountHost(request.headers.get('host') ?? new URL(request.url).host)) {
        return new Response(null, { status: 404 });
    }
    const response = await accountAuth().api.getJwks();
    return Response.json(response, {
        headers: {
            'Cache-Control': 'public, max-age=300',
            'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
        },
    });
}

