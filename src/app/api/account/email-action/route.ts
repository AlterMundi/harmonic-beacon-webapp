import { completeEmailAction } from '@/lib/account/credential-actions';
import { accountRateSecret, isAccountHost } from '@/lib/account/config';
import { digestAccountActionToken } from '@/lib/account/action-tokens';
import { consumeAccountRateLimit } from '@/lib/account/rate-limit';

export async function POST(request: Request): Promise<Response> {
    if (!isAccountHost(request.headers.get('host') ?? new URL(request.url).host)) {
        return new Response(null, { status: 404 });
    }
    const body = await request.json().catch(() => null) as {
        token?: unknown;
    } | null;
    if (typeof body?.token !== 'string' || !/^[A-Za-z0-9_-]{40,64}$/.test(body.token)) {
        return Response.json({ status: false }, { status: 400 });
    }
    const secret = accountRateSecret();
    if (!secret || !await consumeAccountRateLimit({
        request,
        email: digestAccountActionToken(body.token),
        purpose: 'email-action',
        secret,
        maxPerEmail: 6,
        maxPerOrigin: 30,
        maxGlobal: 2_000,
    })) return Response.json({ status: false }, {
        status: 429,
        headers: { 'Cache-Control': 'private, no-store', 'Retry-After': '60' },
    });
    const status = await completeEmailAction(body.token);
    return Response.json({ status }, {
        status: status ? 200 : 400,
        headers: { 'Cache-Control': 'private, no-store' },
    });
}
