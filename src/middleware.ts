import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Navigation convenience, not an authorization boundary.
 *
 * This runs on the edge runtime with no database reach, so the most it can know
 * is whether a cookie is present — not whether it names a live session, an
 * entitled ticket, an enabled staff account, or the right event. Treating that
 * as authorization would mean a revoked ticket kept its access simply because
 * the browser still held the cookie.
 *
 * So it does exactly one thing: send a visitor who obviously has no session to
 * the right login surface instead of rendering a protected page that would fail.
 * Every protected page and API route resolves the principal itself through
 * `@/lib/auth`, and none of them may assume this file ran.
 */

/**
 * `SESSION_COOKIE_NAME` from `@/lib/session-auth`, duplicated as a literal
 * because that module imports `node:crypto`, which the edge runtime does not
 * provide. `middleware.test.ts` guards the drift behaviourally: it drives this
 * file with a cookie named from the contract's own constant.
 */
const SESSION_COOKIE = 'hb_session';

/** Attendee surfaces: the protected room. */
const ATTENDEE_PREFIXES = ['/session'];

/** Staff surfaces: the operator console. */
const STAFF_PREFIXES = ['/ops'];

function matches(pathname: string, prefixes: string[]): boolean {
    return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

export default function middleware(request: NextRequest): NextResponse {
    const { pathname } = request.nextUrl;

    if (request.cookies.get(SESSION_COOKIE)?.value) {
        return NextResponse.next();
    }

    if (matches(pathname, STAFF_PREFIXES)) {
        return NextResponse.redirect(new URL('/staff/login', request.url));
    }

    if (matches(pathname, ATTENDEE_PREFIXES)) {
        // A room deep link must not strand an Account user on the public event
        // list. When central Account is enabled, begin the bounded OIDC handoff
        // immediately and carry the local room path through its validated
        // `next` contract. Deployments without Account keep the legacy ticket
        // login surface.
        if (process.env.BEACON_ACCOUNT_ENABLED === 'true') {
            const target = new URL('/api/account/login', request.url);
            target.searchParams.set('flow', 'attendee');
            target.searchParams.set('next', pathname);
            return NextResponse.redirect(target);
        }
        const target = new URL('/', request.url);
        target.searchParams.set('next', pathname);
        return NextResponse.redirect(target);
    }

    return NextResponse.next();
}

export const config = {
    matcher: ['/session/:path*', '/ops/:path*'],
};
