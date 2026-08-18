import { requestPasswordReset } from '@/lib/account/credential-actions';
import { isAccountHost } from '@/lib/account/config';

export async function POST(request: Request): Promise<Response> {
    if (!isAccountHost(request.headers.get('host') ?? new URL(request.url).host)) {
        return new Response(null, { status: 404 });
    }
    const body = await request.json().catch(() => null) as { email?: unknown } | null;
    await requestPasswordReset(request, body?.email);
    return Response.json({ status: true }, {
        status: 202,
        headers: { 'Cache-Control': 'private, no-store' },
    });
}
