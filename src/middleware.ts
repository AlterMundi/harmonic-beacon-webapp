import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
    accountOrigin,
    isAccountHost,
    isCurrentAccountHost,
} from '@/lib/account/config';

import {
    canonicalEarlyBirdInvitation,
    earlyBirdInvitationCookieHost,
    earlyBirdInvitationStagingHost,
    listenerInvitationCookies,
    LISTENER_INVITATION_CANONICAL_ORIGIN,
} from '@/lib/early-birds/invitation-cookie';
import { listenerInvitationQuery } from '@/lib/listener/namespace';

/**
 * Navigation convenience, not an authorization boundary.
 *
 * This runs on the edge runtime with no database reach, so the most it can know
 * is whether a cookie is present — not whether it names a live session, an
 * entitled ticket, an enabled staff account, or the right event. Treating that
 * as authorization would mean a revoked ticket kept its access simply because
 * the browser still held the cookie.
 *
 * It performs two edge-local navigation chores: staging forwards a canonical
 * invitation once to the Listener product host, which exchanges it for a short
 * browser-inaccessible cookie, while every other host only scrubs the bearer;
 * it also sends visitors with no session cookie to the relevant login surface.
 * Every protected page and API route still resolves the principal itself
 * through `@/lib/auth`, and none of them may assume this file ran.
 */

/**
 * `SESSION_COOKIE_NAME` from `@/lib/session-auth`, duplicated as a literal
 * because that module imports `node:crypto`, which the edge runtime does not
 * provide. `middleware.test.ts` guards the drift behaviourally: it drives this
 * file with a cookie named from the contract's own constant.
 */
const SESSION_COOKIE = 'hb_session';

/** Attendee surfaces: the paid room. Login is the code + email form on `/`. */
const ATTENDEE_PREFIXES = ['/session'];

/** Staff surfaces: the operator console. */
const STAFF_PREFIXES = ['/ops'];
function matches(pathname: string, prefixes: string[]): boolean {
    return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function scrubEarlyBirdInvitation(request: NextRequest): NextResponse | null {
    const queryName = listenerInvitationQuery(request.nextUrl.pathname);
    if (!queryName || !request.nextUrl.searchParams.has(queryName)) return null;

    const candidates = request.nextUrl.searchParams.getAll(queryName);
    const token = candidates.length === 1
        ? canonicalEarlyBirdInvitation(candidates[0])
        : null;
    const hostname = request.nextUrl.hostname;
    if (earlyBirdInvitationStagingHost(hostname)) {
        // OAuth/session authority lives on the canonical Listener host. Carry
        // the bearer through exactly one unlogged/no-store redirect so the
        // canonical edge can scrub it into its own host-only __Host- cookie.
        const canonical = new URL(
            token ? '/listener/redeem' : '/listener',
            LISTENER_INVITATION_CANONICAL_ORIGIN,
        );
        if (token) canonical.searchParams.set('token', token);
        const response = NextResponse.redirect(canonical);
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Referrer-Policy', 'no-referrer');
        return response;
    }
    const target = request.nextUrl.clone();
    target.searchParams.delete(queryName);
    const response = NextResponse.redirect(target);
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    // Host is taken from the request URL populated by the exact nginx vhost;
    // forwarded host headers are deliberately not trusted.
    if (token && earlyBirdInvitationCookieHost(hostname)) {
        for (const cookie of listenerInvitationCookies(token)) response.cookies.set(cookie);
    }
    return response;
}

export default function middleware(request: NextRequest): NextResponse {
    const { pathname } = request.nextUrl;
    const accountRuntime = process.env.BEACON_ACCOUNT_RUNTIME === '1';
    const requestHost = request.headers.get('host') ?? request.nextUrl.host;
    const authorityHost = accountRuntime && isCurrentAccountHost(requestHost);

    // The dedicated Account container is the same standalone Next image. Its
    // runtime marker is therefore the top-level deny-default boundary: a
    // direct container/service Host can never fall through to event, media,
    // Listener, commerce or LiveKit routes.
    if (accountRuntime) {
        if (!authorityHost) return new NextResponse(null, { status: 404 });
        if (!isAccountHost(requestHost)) {
            return new NextResponse(null, { status: 404 });
        }
        {
            const nonce = crypto.randomUUID().replaceAll('-', '');
            const browserMutation = request.method === 'POST' && (
                pathname === '/api/account/profile' ||
                pathname === '/api/account/logout/current' ||
                pathname === '/api/account/logout/all' ||
                pathname === '/api/account/password/change' ||
                pathname === '/api/account/password/reset/request' ||
                pathname === '/api/account/password/reset/complete' ||
                pathname === '/api/account/email-action' ||
                pathname === '/api/account/email/change/request' ||
                pathname === '/api/account/auth/sign-up/email' ||
                pathname === '/api/account/auth/sign-in/email' ||
                pathname === '/api/account/auth/sign-in/social'
            );
            if (browserMutation && (
                request.headers.get('origin') !== accountOrigin() ||
                request.headers.get('sec-fetch-site') !== 'same-origin' ||
                request.headers.get('content-type') !== 'application/json'
            )) return new NextResponse(null, { status: 403, headers: { 'Cache-Control': 'no-store' } });
            const allowed = pathname === '/' || pathname === '/account' ||
                pathname.startsWith('/account/') || pathname === '/verify-email' ||
                pathname === '/reset-password' ||
                pathname === '/assets/hb-global-nav.js' ||
                pathname.startsWith('/.well-known/') || pathname.startsWith('/api/account/') ||
                pathname.startsWith('/_next/') || pathname === '/favicon.ico';
            if (!allowed) return new NextResponse(null, { status: 404 });
            const forwarded = new Headers(request.headers);
            const explicitLocale = request.nextUrl.searchParams.getAll('lang');
            const accountLocale = explicitLocale.length === 1 &&
                (explicitLocale[0] === 'es' || explicitLocale[0] === 'en')
                ? explicitLocale[0]
                : request.cookies.get('hb_locale')?.value === 'en' ? 'en'
                    : request.cookies.get('hb_locale')?.value === 'es' ? 'es'
                        : request.headers.get('accept-language')?.toLowerCase().startsWith('es') ? 'es' : 'en';
            forwarded.set('x-hb-account-locale', accountLocale);
            forwarded.set('x-nonce', nonce);
            const csp = `default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self' https://listen.harmonicbeacon.com https://earlybirds-staging.harmonicbeacon.com https://live.harmonicbeacon.com https://live-staging.harmonicbeacon.com; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'`;
            forwarded.set('Content-Security-Policy', csp);
            const response = pathname === '/'
                ? NextResponse.rewrite(new URL('/account', request.url), { request: { headers: forwarded } })
                : NextResponse.next({ request: { headers: forwarded } });
            response.headers.set('Referrer-Policy', 'no-referrer');
            response.headers.set('X-Content-Type-Options', 'nosniff');
            response.headers.set('Content-Security-Policy', csp);
            return response;
        }
    }

    if (isAccountHost(requestHost)) {
        if (!accountRuntime) {
            return new NextResponse('Account service unavailable', {
                status: 503, headers: { 'Cache-Control': 'no-store' },
            });
        }
    }

    // Product runtimes expose only their three RP endpoints under
    // /api/account; authority UI/actions must not leak onto Listener or Live.
    const productAccountRoute = pathname === '/api/account/login' ||
        pathname === '/api/account/callback' ||
        pathname === '/api/account/frontchannel-logout';
    if ((pathname === '/account' || pathname.startsWith('/account/') ||
        pathname === '/verify-email' || pathname === '/reset-password' ||
        pathname === '/nav-slot' || pathname.startsWith('/.well-known/') ||
        pathname.startsWith('/api/account/')) && !productAccountRoute) {
        return new NextResponse(null, { status: 404 });
    }

    const invitationRedirect = scrubEarlyBirdInvitation(request);
    if (invitationRedirect) return invitationRedirect;

    if (request.cookies.get(SESSION_COOKIE)?.value) {
        return NextResponse.next();
    }

    if (matches(pathname, STAFF_PREFIXES)) {
        return NextResponse.redirect(new URL('/staff/login', request.url));
    }

    if (matches(pathname, ATTENDEE_PREFIXES)) {
        // Carry the destination so a reconnecting attendee lands back in their
        // room after re-entering the code. `next` is re-validated where it is
        // consumed; nothing trusts it as given.
        const target = new URL('/', request.url);
        target.searchParams.set('next', pathname);
        return NextResponse.redirect(target);
    }

    return NextResponse.next();
}

export const config = {
    matcher: '/:path*',
};
