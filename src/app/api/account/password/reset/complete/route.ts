import { completePasswordReset } from '@/lib/account/credential-actions';
import { accountRateSecret, isAccountHost } from '@/lib/account/config';
import { digestAccountActionToken } from '@/lib/account/action-tokens';
import { consumeAccountRateLimit } from '@/lib/account/rate-limit';

export async function POST(request: Request): Promise<Response> {
    if (!isAccountHost(request.headers.get('host') ?? new URL(request.url).host)) {
        return new Response(null, { status: 404 });
    }
    const body = await request.json().catch(() => null) as { token?: unknown; password?: unknown } | null;
    const rateSecret = accountRateSecret();
    if (!rateSecret || !await consumeAccountRateLimit({
        request,
        email: typeof body?.token === 'string'
            ? digestAccountActionToken(body.token)
            : 'malformed',
        purpose: 'reset-complete', secret: rateSecret,
        maxPerEmail: 3, maxPerOrigin: 20, maxGlobal: 1_000,
    })) return Response.json({ status: false }, {
        status: 429, headers: { 'Cache-Control': 'private, no-store' },
    });
    const status = typeof body?.token === 'string' && typeof body.password === 'string' &&
        await completePasswordReset(body.token, body.password);
    return Response.json({ status }, {
        status: status ? 200 : 400,
        headers: { 'Cache-Control': 'private, no-store' },
    });
}
