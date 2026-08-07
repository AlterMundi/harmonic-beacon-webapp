import type { NextRequest } from 'next/server';

import { earlyBirdAuth } from '@/lib/early-birds/auth';
import {
    earlyBirdsEnabled,
    earlyBirdsUnavailableResponse,
} from '@/lib/early-birds/enabled';

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
    const configured = [
        process.env.EARLY_BIRDS_AUTH_BASE_URL,
        ...(process.env.EARLY_BIRDS_TRUSTED_ORIGINS ?? '').split(','),
    ]
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value));
    const allowed = configured.length > 0 ? configured : [request.nextUrl.origin];
    return allowed.includes(origin);
}

function oauthCallback(request: NextRequest): boolean {
    return request.nextUrl.pathname.includes('/api/early-birds/auth/callback/');
}

export function GET(request: NextRequest): Promise<Response> | Response {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    return earlyBirdAuth().handler(request);
}

export function POST(request: NextRequest): Promise<Response> | Response {
    if (!earlyBirdsEnabled()) return earlyBirdsUnavailableResponse();
    const hidden = hiddenSyntheticEmailEndpoint(request);
    if (hidden) return hidden;
    // Provider callbacks are protected by the one-time state/cookie verifier
    // and Apple uses a cross-site form_post. Every browser-initiated mutation
    // must instead originate from one of the exact Listener hosts.
    if (!oauthCallback(request) && !trustedMutationOrigin(request)) {
        return Response.json({ error: 'Invalid request origin.' }, {
            status: 403,
            headers: { 'Cache-Control': 'private, no-store' },
        });
    }
    return earlyBirdAuth().handler(request);
}
