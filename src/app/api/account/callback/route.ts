import {
    completeListenerAccountCallback,
    listenerAccountCookie,
    listenerAttemptCookie,
    readListenerAccountAttemptCookie,
} from '@/lib/listener/account-rp';
import { isCanonicalListenerHost, isListenerStagingHost } from '@/lib/listener/public-discovery';

export async function GET(request: Request): Promise<Response> {
    const headers = new Headers(request.headers);
    if (!isCanonicalListenerHost(headers) && !isListenerStagingHost(headers)) return new Response(null, { status: 404 });
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const attemptCookie = readListenerAccountAttemptCookie(headers);
    const completed = code && state ? await completeListenerAccountCallback({
        headers, code, state, attemptCookie: attemptCookie ?? undefined,
    }).catch(() => null) : null;
    const responseHeaders = new Headers({
        Location: completed ? '/' : '/?authError=1',
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
    });
    responseHeaders.append('Set-Cookie', listenerAttemptCookie('', 0));
    if (completed) responseHeaders.append('Set-Cookie', listenerAccountCookie(completed.token));
    return new Response(null, {
        status: 302,
        headers: responseHeaders,
    });
}
