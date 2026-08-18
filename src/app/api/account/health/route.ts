import { isAccountHost } from '@/lib/account/config';

export async function GET(request: Request): Promise<Response> {
    if (!isAccountHost(request.headers.get('host') ?? new URL(request.url).host)) {
        return new Response(null, { status: 404 });
    }
    return Response.json({ status: 'ok', service: 'beacon-account' }, {
        headers: { 'Cache-Control': 'no-store' },
    });
}

