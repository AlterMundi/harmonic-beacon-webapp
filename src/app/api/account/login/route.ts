import { createListenerAccountAuthorization, listenerAttemptCookie } from '@/lib/listener/account-rp';
import { isCanonicalListenerHost, isListenerStagingHost } from '@/lib/listener/public-discovery';

export async function GET(request: Request): Promise<Response> {
    const headers = new Headers(request.headers);
    if (!isCanonicalListenerHost(headers) && !isListenerStagingHost(headers)) return new Response(null, { status: 404 });
    try {
        const authorization = createListenerAccountAuthorization(headers);
        return new Response(null, {
            status: 302,
            headers: {
                Location: authorization.url.toString(),
                'Set-Cookie': listenerAttemptCookie(authorization.cookie),
                'Cache-Control': 'private, no-store',
                'Referrer-Policy': 'no-referrer',
            },
        });
    } catch { return Response.json({ error: 'identity_unavailable' }, { status: 503 }); }
}

