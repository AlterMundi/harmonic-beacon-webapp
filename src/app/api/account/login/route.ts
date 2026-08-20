import {
    createListenerAccountAuthorization,
    listenerAttemptCookie,
    listenerAutomaticHandoffCookie,
    listenerAccountRPConfig,
} from '@/lib/listener/account-rp';
import { isCanonicalListenerHost, isListenerStagingHost } from '@/lib/listener/public-discovery';

async function accountReadyForAutomaticHandoff(headers: Headers): Promise<boolean> {
    try {
        const config = listenerAccountRPConfig(headers);
        const response = await fetch(new URL('/api/account/health/ready', config.issuer), {
            cache: 'no-store',
            redirect: 'error',
            signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok) return false;
        const body = await response.json().catch(() => null) as { status?: unknown } | null;
        return body?.status === 'ok';
    } catch {
        return false;
    }
}

export async function GET(request: Request): Promise<Response> {
    const headers = new Headers(request.headers);
    if (!isCanonicalListenerHost(headers) && !isListenerStagingHost(headers)) return new Response(null, { status: 404 });
    const automaticValues = new URL(request.url).searchParams.getAll('auto');
    const automatic = automaticValues.length === 1 && automaticValues[0] === '1';
    if (automatic && !await accountReadyForAutomaticHandoff(headers)) {
        const listenerOrigin = isListenerStagingHost(headers)
            ? 'https://earlybirds-staging.harmonicbeacon.com'
            : 'https://listen.harmonicbeacon.com';
        return new Response(null, {
            status: 302,
            headers: {
                Location: `${listenerOrigin}/?accountUnavailable=1`,
                'Set-Cookie': listenerAutomaticHandoffCookie('1', 60),
                'Cache-Control': 'private, no-store',
                'Referrer-Policy': 'no-referrer',
            },
        });
    }
    try {
        const authorization = createListenerAccountAuthorization(headers);
        const responseHeaders = new Headers({
            Location: authorization.url.toString(),
            'Cache-Control': 'private, no-store',
            'Referrer-Policy': 'no-referrer',
        });
        responseHeaders.append('Set-Cookie', listenerAttemptCookie(authorization.cookie));
        if (!automatic) responseHeaders.append('Set-Cookie', listenerAutomaticHandoffCookie('', 0));
        return new Response(null, {
            status: 302,
            headers: responseHeaders,
        });
    } catch { return Response.json({ error: 'identity_unavailable' }, { status: 503 }); }
}
