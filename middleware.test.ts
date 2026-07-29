import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE_NAME } from './src/lib/session-auth';
// `src/middleware.ts`, not the repository root: Next only loads the middleware
// convention from inside `src` when the app lives there, and a root-level file is
// silently ignored — which is what it had been doing.
import middleware, { config } from './src/middleware';

/**
 * Middleware is navigation convenience, not the authorization boundary.
 *
 * These tests deliberately assert something weak: presence of a cookie changes
 * where a visitor lands, and nothing else. The gate lives in `@/lib/auth`, whose
 * tests assert the strong properties (revoked ticket, disabled staff, expired
 * session). If a future change makes middleware appear to authorize anything,
 * the last test here — an arbitrary made-up cookie value sailing through — is the
 * one that should make that obvious.
 */

function request(pathname: string, cookie?: string): NextRequest {
    const headers = new Headers();
    if (cookie) {
        headers.set('cookie', cookie);
    }
    return new NextRequest(new URL(pathname, 'https://live.harmonicbeacon.com'), { headers });
}

function location(response: NextResponse): URL {
    return new URL(response.headers.get('location')!);
}

describe('middleware', () => {
    it('recognizes exactly the cookie the session contract issues', () => {
        // Drift guard for the literal in `middleware.ts`, which cannot import
        // `@/lib/session-auth` because the edge runtime has no `node:crypto`.
        // Driven from the contract's own constant, so a rename fails here.
        expect(middleware(request('/session/x', `${SESSION_COOKIE_NAME}=value`)).status).toBe(200);
        expect(middleware(request('/session/x', 'hb_session_other=value')).status).toBe(307);
    });

    describe('without a session cookie', () => {
        it('sends a room visitor to the landing page with the room remembered', () => {
            const response = middleware(request('/session/session-saturday'));

            expect(response.status).toBe(307);
            const target = location(response);
            expect(target.pathname).toBe('/');
            expect(target.searchParams.get('next')).toBe('/session/session-saturday');
        });

        it('sends an operator to the staff login page', () => {
            const response = middleware(request('/ops/session/session-saturday'));

            expect(response.status).toBe(307);
            expect(location(response).pathname).toBe('/staff/login');
        });

        it('redirects the bare prefixes too', () => {
            expect(location(middleware(request('/session'))).pathname).toBe('/');
            expect(location(middleware(request('/ops'))).pathname).toBe('/staff/login');
        });

        it('leaves the public landing page and the login surfaces alone', () => {
            for (const pathname of ['/', '/staff/login', '/login', '/api/auth/ticket']) {
                expect(middleware(request(pathname)).status).toBe(200);
            }
        });

        it('does not redirect a path that merely starts with a protected prefix', () => {
            // `/sessions-are-cool` is not under `/session`.
            expect(middleware(request('/sessions-are-cool')).status).toBe(200);
            expect(middleware(request('/opside')).status).toBe(200);
        });
    });

    describe('with a session cookie', () => {
        it('lets a room request through to the page that will actually check it', () => {
            const response = middleware(request('/session/session-saturday', `${SESSION_COOKIE_NAME}=whatever`));

            expect(response.status).toBe(200);
            expect(response.headers.get('location')).toBeNull();
        });

        it('lets an operator request through', () => {
            expect(middleware(request('/ops/admission', `${SESSION_COOKIE_NAME}=whatever`)).status).toBe(200);
        });

        it('authorizes nothing: an invented cookie value passes here and is refused downstream', () => {
            // The point of the design. This value names no `WebSession` row, so
            // `requirePrincipal()` will answer 401 — but middleware cannot know
            // that, and must not pretend to.
            const response = middleware(request('/ops/admission', `${SESSION_COOKIE_NAME}=not-a-real-token`));
            expect(response.status).toBe(200);
        });

        it('ignores an empty cookie value', () => {
            expect(middleware(request('/session/x', `${SESSION_COOKIE_NAME}=`)).status).toBe(307);
        });
    });

    describe('matcher', () => {
        it('runs only on the two protected surfaces', () => {
            expect(config.matcher).toEqual(['/session/:path*', '/ops/:path*']);
        });
    });
});
