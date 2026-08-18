import { requestEmailChange } from '@/lib/account/credential-actions';
import { isAccountHost } from '@/lib/account/config';

export async function POST(request: Request): Promise<Response> {
    if (!isAccountHost(request.headers.get('host') ?? new URL(request.url).host)) {
        return new Response(null, { status: 404 });
    }
    const body = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
    const status = await requestEmailChange(request, body?.email, body?.password);
    return Response.json({ status }, {
        status: status ? 202 : 400,
        headers: { 'Cache-Control': 'private, no-store' },
    });
}

