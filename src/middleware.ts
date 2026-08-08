import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

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
    matcher: [
        '/listener',
        '/listener/redeem',
        '/early-birds',
        '/early-birds/redeem',
        '/session/:path*',
        '/ops/:path*',
    ],
};
