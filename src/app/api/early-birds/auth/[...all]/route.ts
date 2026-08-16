import type { NextRequest } from 'next/server';

import { earlyBirdAuthHandler } from '@/lib/early-birds/auth';
import {
    EARLY_BIRD_MAGIC_LINK_PATH,
    EARLY_BIRD_MAGIC_LINK_VERIFY_PATH,
    earlyBirdMagicLinkAvailable,
} from '@/lib/early-birds/magic-link';
import {
    earlyBirdsEnabled,
    earlyBirdsUnavailableResponse,
} from '@/lib/early-birds/enabled';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';
import { listenerRuntimeTrustedOrigins } from '@/lib/listener/runtime-env';

export const dynamic = 'force-dynamic';

function hiddenSyntheticEmailEndpoint(request: NextRequest): Response | null {
    if (!request.nextUrl.pathname.endsWith('/sign-up/email') &&
        !request.nextUrl.pathname.endsWith('/sign-in/email')) return null;
    return Response.json({ error: 'Not found.' }, {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
    });
}

function trustedMutationOrigin(request: NextRequest): boolean {
    const origin = request.headers.get('origin');
    if (!origin) return false;
    try {
        const configured = listenerRuntimeTrustedOrigins();
        const allowed = configured.length > 0 ? configured : [request.nextUrl.origin];
        return allowed.includes(origin);
    } catch {
        return false;
    }
}

function oauthCallback(request: NextRequest): boolean {
    return request.nextUrl.pathname.includes('/api/early-birds/auth/callback/');
}

function magicLinkRequest(request: NextRequest): boolean {
    return request.nextUrl.pathname.endsWith(EARLY_BIRD_MAGIC_LINK_PATH);
}

function magicLinkVerification(request: NextRequest): boolean {
    return request.nextUrl.pathname.endsWith(EARLY_BIRD_MAGIC_LINK_VERIFY_PATH);
}

const LISTENER_CALLBACKS: ReadonlySet<string> = new Set([
    LISTENER_NAMESPACE.canonical.home,
    LISTENER_NAMESPACE.canonical.redeem,
    LISTENER_NAMESPACE.legacy.home,
    LISTENER_NAMESPACE.legacy.redeem,
]);
const LISTENER_ERROR_CALLBACKS: ReadonlySet<string> = new Set([
    LISTENER_NAMESPACE.canonical.authError,
    LISTENER_NAMESPACE.legacy.authError,
]);

function safeListenerCallback(value: unknown, kind: 'success' | 'error'): boolean {
    if (value === undefined) return true;
    if (typeof value !== 'string') return false;
    if (kind === 'success') return LISTENER_CALLBACKS.has(value);
    return LISTENER_ERROR_CALLBACKS.has(value);
}

async function safeMagicLinkRequest(request: NextRequest): Promise<boolean> {
    try {
        const body = await request.clone().json() as Record<string, unknown>;
        const metadata = body.metadata;
        return typeof body.callbackURL === 'string' &&
            safeListenerCallback(body.callbackURL, 'success') &&
            safeListenerCallback(body.newUserCallbackURL, 'success') &&
            safeListenerCallback(body.errorCallbackURL, 'error') &&
            (metadata === undefined || (
                typeof metadata === 'object' && metadata !== null &&
                Object.keys(metadata).every((key) => key === 'locale') &&
                ['es', 'en'].includes(String((metadata as Record<string, unknown>).locale))
            ));
    } catch {
        return false;
    }
}

function safeMagicLinkVerification(request: NextRequest): boolean {
    const callbackURL = request.nextUrl.searchParams.get('callbackURL');
    return callbackURL !== null && safeListenerCallback(callbackURL, 'success') &&
        safeListenerCallback(request.nextUrl.searchParams.get('newUserCallbackURL') ?? undefined, 'success') &&
        safeListenerCallback(request.nextUrl.searchParams.get('errorCallbackURL') ?? undefined, 'error');
}

function hiddenMagicLinkResponse(): Response {
    return Response.json({ error: 'Not found.' }, {
        status: 404,
        headers: { 'Cache-Control': 'private, no-store' },
    });
}

function invalidMagicLinkResponse(): Response {
    return Response.json({ error: 'Invalid request.' }, {
        status: 400,
        headers: { 'Cache-Control': 'private, no-store' },
    });
}

export function GET(request: NextRequest): Promise<Response> | Response {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    if (magicLinkVerification(request)) {
        if (!earlyBirdMagicLinkAvailable()) return hiddenMagicLinkResponse();
        if (!safeMagicLinkVerification(request)) return invalidMagicLinkResponse();
    }
    return earlyBirdAuthHandler(request);
}

export async function POST(request: NextRequest): Promise<Response> {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    const hidden = hiddenSyntheticEmailEndpoint(request);
    if (hidden) return hidden;
    if (magicLinkRequest(request)) {
        if (!earlyBirdMagicLinkAvailable()) return hiddenMagicLinkResponse();
        if (!await safeMagicLinkRequest(request)) return invalidMagicLinkResponse();
    }
    // Provider callbacks are protected by the one-time state/cookie verifier
    // and Apple uses a cross-site form_post. Every browser-initiated mutation
    // must instead originate from one of the exact Listener hosts.
    if (!oauthCallback(request) && !trustedMutationOrigin(request)) {
        return Response.json({ error: 'Invalid request origin.' }, {
            status: 403,
            headers: { 'Cache-Control': 'private, no-store' },
        });
    }
    return earlyBirdAuthHandler(request);
}
