import { describe, expect, it } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

import { SESSION_COOKIE_NAME } from './src/lib/session-auth';
import {
    EARLY_BIRD_INVITATION_COOKIE,
    EARLY_BIRD_INVITATION_MAX_AGE_SECONDS,
} from './src/lib/early-birds/invitation-cookie';
// `src/middleware.ts`, not the repository root: Next only loads the middleware
// convention from inside `src` when the app lives there, and a root-level file is
// silently ignored — which is what it had been doing.
import middleware, { config } from './src/middleware';

const INVITATION = `ebi_v1.${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(32)}`;

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

function request(
    pathname: string,
    cookie?: string,
    hostname = 'live.harmonicbeacon.com',
    extraHeaders: Record<string, string> = {},
): NextRequest {
    const headers = new Headers();
    if (cookie) {
        headers.set('cookie', cookie);
    }
    for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
    return new NextRequest(new URL(pathname, `https://${hostname}`), { headers });
}

function location(response: NextResponse): URL {
    return new URL(response.headers.get('location')!);
}

describe('middleware', () => {
    describe('EarlyBird invitation URL scrubbing', () => {
        it.each([
            ['/listener', 'invite'],
            ['/listener/redeem', 'token'],
            ['/early-birds', 'invite'],
            ['/early-birds/redeem', 'token'],
        ])('moves the canonical %s query token to a short HttpOnly cookie', (pathname, queryName) => {
            const response = middleware(request(
                `${pathname}?${queryName}=${INVITATION}&locale=en`,
                undefined,
                'earlybirds-staging.harmonicbeacon.com',
            ));

            expect(response.status).toBe(307);
            const target = location(response);
            expect(target.pathname).toBe(pathname);
            expect(target.searchParams.has(queryName)).toBe(false);
            expect(target.searchParams.get('locale')).toBe('en');
            expect(response.headers.get('cache-control')).toBe('private, no-store');
            expect(response.headers.get('referrer-policy')).toBe('no-referrer');
            expect(response.cookies.get(EARLY_BIRD_INVITATION_COOKIE)).toMatchObject({
                value: INVITATION,
                httpOnly: true,
                secure: true,
                sameSite: 'lax',
                path: '/',
                maxAge: EARLY_BIRD_INVITATION_MAX_AGE_SECONDS,
            });
        });

        it.each([
            ['listen.harmonicbeacon.com', '/listener', 'invite'],
            ['listen.harmonicbeacon.com', '/listener/redeem', 'token'],
            ['listen.harmonicbeacon.com', '/early-birds', 'invite'],
            ['listen.harmonicbeacon.com', '/early-birds/redeem', 'token'],
            ['live.harmonicbeacon.com', '/early-birds', 'invite'],
        ])('scrubs but never persists %s%s invitation queries', (hostname, pathname, queryName) => {
            const response = middleware(request(
                `${pathname}?${queryName}=${INVITATION}&locale=en`,
                undefined,
                hostname,
            ));

            expect(response.status).toBe(307);
            expect(location(response).searchParams.has(queryName)).toBe(false);
            expect(location(response).searchParams.get('locale')).toBe('en');
            expect(response.headers.get('cache-control')).toBe('private, no-store');
            expect(response.headers.get('referrer-policy')).toBe('no-referrer');
            expect(response.cookies.get(EARLY_BIRD_INVITATION_COOKIE)).toBeUndefined();
        });

        it('does not trust a forwarded staging host on the public Listener URL', () => {
            const response = middleware(request(
                `/listener?invite=${INVITATION}`,
                undefined,
                'listen.harmonicbeacon.com',
                { 'x-forwarded-host': 'earlybirds-staging.harmonicbeacon.com' },
            ));

            expect(response.cookies.get(EARLY_BIRD_INVITATION_COOKIE)).toBeUndefined();
        });

        it('scrubs malformed or ambiguous query values without persisting them', () => {
            for (const pathname of [
                '/early-birds?invite=not-canonical',
                `/early-birds?invite=${INVITATION}&invite=${INVITATION}`,
            ]) {
                const response = middleware(request(pathname));
                expect(response.status).toBe(307);
                expect(location(response).searchParams.has('invite')).toBe(false);
                expect(response.cookies.get(EARLY_BIRD_INVITATION_COOKIE)).toBeUndefined();
            }
        });
    });

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
        it('runs only on invitation entry and the two protected surfaces', () => {
            expect(config.matcher).toEqual([
                '/listener',
                '/listener/redeem',
                '/early-birds',
                '/early-birds/redeem',
                '/session/:path*',
                '/ops/:path*',
            ]);
        });
    });
});
