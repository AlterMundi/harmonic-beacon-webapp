import { NextResponse, type NextRequest } from 'next/server';

import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { earlyBirdsEnabled, earlyBirdsUnavailableResponse } from '@/lib/early-birds/enabled';
import {
    clearedListenerInvitationCookies,
    earlyBirdInvitationCookieHost,
    listenerInvitationFromCookieHeader,
} from '@/lib/early-birds/invitation-cookie';
import {
    EarlyBirdMembershipGatewayUnavailableError,
    redeemFreeThroughCanonicalGateway,
} from '@/lib/early-birds/membership-gateway';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

export const dynamic = 'force-dynamic';

function sensitive(response: NextResponse): NextResponse {
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
}

function json(body: Record<string, unknown>, status: number): NextResponse {
    return sensitive(NextResponse.json(body, { status }));
}

function terminalInvitationUnavailable(): NextResponse {
    const response = json({ error: 'Invitation unavailable.' }, 409);
    for (const cookie of clearedListenerInvitationCookies()) response.cookies.set(cookie);
    return response;
}

function sameOriginInvitationRequest(request: NextRequest): boolean {
    const host = request.headers.get('host')?.trim().toLowerCase() ?? '';
    const protocol = request.headers.get('x-forwarded-proto')?.trim().toLowerCase()
        ?? request.nextUrl.protocol.replace(/:$/, '').toLowerCase();
    if (protocol !== 'https' || !earlyBirdInvitationCookieHost(host)) return false;
    const origin = request.headers.get('origin');
    if (!origin) return false;
    try {
        const parsed = new URL(origin);
        return parsed.protocol === 'https:' && parsed.origin === `https://${host}`;
    } catch {
        return false;
    }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
    if (!earlyBirdsEnabled()) return sensitive(earlyBirdsUnavailableResponse());

    if (!sameOriginInvitationRequest(request)) {
        return json({ error: 'Invalid request.' }, 403);
    }

    const session = await currentEarlyBirdSession(request.headers).catch(() => null);
    if (!session) return json({ error: 'Sign in required.' }, 401);

    const token = listenerInvitationFromCookieHeader(request.headers.get('cookie'));
    if (!token) {
        return terminalInvitationUnavailable();
    }

    let result;
    try {
        result = await redeemFreeThroughCanonicalGateway(session.user.id, token);
    } catch (error) {
        if (error instanceof EarlyBirdMembershipGatewayUnavailableError) {
            return json({ error: 'Membership service unavailable.' }, 503);
        }
        return json({ error: 'Membership service unavailable.' }, 503);
    }
    if (!result.ok) {
        return terminalInvitationUnavailable();
    }
    const landing = request.nextUrl.pathname === LISTENER_NAMESPACE.canonical.api.freeRedeem
        ? LISTENER_NAMESPACE.canonical.home
        : LISTENER_NAMESPACE.legacy.home;
    const response = sensitive(NextResponse.json({
        ok: true,
        landing,
        replayed: result.replayed,
        alreadyEntitled: result.alreadyEntitled,
    }));
    for (const cookie of clearedListenerInvitationCookies()) response.cookies.set(cookie);
    return response;
}
