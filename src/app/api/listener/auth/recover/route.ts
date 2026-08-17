import type { NextRequest } from 'next/server';

import {
    EARLY_BIRD_COOKIE_PREFIX,
    EARLY_BIRD_SESSION_COOKIE,
    LISTENER_SESSION_COOKIE,
    earlyBirdAuthHandler,
} from '@/lib/early-birds/auth';
import { listenerRuntimeTrustedOrigins } from '@/lib/listener/runtime-env';

export const dynamic = 'force-dynamic';

const RESPONSE_HEADERS = {
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer',
};

function exactTrustedOrigin(request: NextRequest): boolean {
    const origin = request.headers.get('origin');
    if (!origin || origin !== request.nextUrl.origin) return false;
    try {
        const configured = listenerRuntimeTrustedOrigins();
        const allowed = configured.length > 0 ? configured : [request.nextUrl.origin];
        return allowed.includes(origin);
    } catch {
        return false;
    }
}

function recoveryCookieNames(): string[] {
    return [...new Set([
        `${EARLY_BIRD_COOKIE_PREFIX}.state`,
        `__Secure-${EARLY_BIRD_COOKIE_PREFIX}.state`,
        EARLY_BIRD_SESSION_COOKIE,
        `__Secure-${EARLY_BIRD_SESSION_COOKIE}`,
        LISTENER_SESSION_COOKIE,
        `__Secure-${LISTENER_SESSION_COOKIE}`,
    ])];
}

function clearCookie(name: string): string {
    return [
        `${name}=`,
        'Max-Age=0',
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        ...(name.startsWith('__Secure-') ? ['Secure'] : []),
    ].join('; ');
}

/**
 * Explicit recovery from a failed OAuth callback. No query value is accepted,
 * reflected or logged. A valid current session is revoked by Better Auth;
 * ambiguous/stale credentials are only removed from this browser.
 */
export async function POST(request: NextRequest): Promise<Response> {
    if (!exactTrustedOrigin(request)) {
        return Response.json({ error: 'Invalid request origin.' }, {
            status: 403,
            headers: RESPONSE_HEADERS,
        });
    }

    let revocationFailed = false;
    try {
        const signOut = new Request(
            new URL('/api/early-birds/auth/sign-out', request.nextUrl.origin),
            {
                method: 'POST',
                headers: {
                    origin: request.nextUrl.origin,
                    cookie: request.headers.get('cookie') ?? '',
                    'content-type': 'application/json',
                },
                body: '{}',
            },
        );
        const response = await earlyBirdAuthHandler(signOut);
        revocationFailed = response.status >= 500;
    } catch {
        revocationFailed = true;
    }

    const headers = new Headers(RESPONSE_HEADERS);
    headers.set('content-type', 'application/json');
    for (const name of recoveryCookieNames()) {
        headers.append('set-cookie', clearCookie(name));
    }
    return new Response(JSON.stringify({ recovered: !revocationFailed }), {
        status: revocationFailed ? 503 : 200,
        headers,
    });
}

export function GET(): Response {
    return Response.json({ error: 'Method not allowed.' }, {
        status: 405,
        headers: { ...RESPONSE_HEADERS, Allow: 'POST' },
    });
}
