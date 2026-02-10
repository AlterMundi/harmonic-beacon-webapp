import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

// The middleware uses auth() from @/auth which wraps the callback
// We need to mock it so the callback receives req.auth = our session

function createMiddlewareRequest(url: string, options: { method?: string } = {}): NextRequest & { auth: unknown; nextUrl: URL } {
    const fullUrl = new URL(url, 'http://localhost:3000');
    const req = new NextRequest(fullUrl, { method: options.method || 'GET' });
    return req as NextRequest & { auth: unknown; nextUrl: URL };
}

describe('middleware', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    // Helper to run middleware with a given session
    async function runMiddleware(pathname: string, session: unknown, method = 'GET') {
        // Mock @/auth to return a function that calls the callback with req.auth set
        vi.doMock('@/auth', () => ({
            auth: (callback: (req: NextRequest & { auth: unknown }) => unknown) => {
                // Return the actual middleware function
                return (req: NextRequest) => {
                    const augmented = req as NextRequest & { auth: unknown };
                    augmented.auth = session;
                    return callback(augmented);
                };
            },
        }));

        const middlewareModule = await import('./middleware');
        const middleware = middlewareModule.default;
        const req = createMiddlewareRequest(pathname, { method });
        return middleware(req) as NextResponse;
    }

    describe('protected pages (unauthenticated)', () => {
        it('redirects /live to /login when not authenticated', async () => {
            const res = await runMiddleware('/live', null);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
        });

        it('redirects /meditation to /login when not authenticated', async () => {
            const res = await runMiddleware('/meditation', null);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
        });

        it('redirects /profile to /login when not authenticated', async () => {
            const res = await runMiddleware('/profile', null);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
        });

        it('redirects /sessions to /login when not authenticated', async () => {
            const res = await runMiddleware('/sessions', null);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
        });
    });

    describe('protected pages (authenticated)', () => {
        const userSession = {
            user: { id: 'user-1', email: 'user@example.com', name: 'User', role: 'USER' },
        };

        it('allows /live for authenticated user', async () => {
            const res = await runMiddleware('/live', userSession);
            expect(res.status).toBe(200);
        });

        it('allows /meditation for authenticated user', async () => {
            const res = await runMiddleware('/meditation', userSession);
            expect(res.status).toBe(200);
        });
    });

    describe('provider pages', () => {
        it('redirects to /login when not authenticated', async () => {
            const res = await runMiddleware('/provider/studio', null);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
        });

        it('redirects USER role to /profile', async () => {
            const session = { user: { id: 'u1', email: 'u@e.com', name: 'U', role: 'USER' } };
            const res = await runMiddleware('/provider/studio', session);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/profile');
        });

        it('allows PROVIDER role', async () => {
            const session = { user: { id: 'p1', email: 'p@e.com', name: 'P', role: 'PROVIDER' } };
            const res = await runMiddleware('/provider/studio', session);
            expect(res.status).toBe(200);
        });

        it('allows ADMIN role', async () => {
            const session = { user: { id: 'a1', email: 'a@e.com', name: 'A', role: 'ADMIN' } };
            const res = await runMiddleware('/provider/studio', session);
            expect(res.status).toBe(200);
        });
    });

    describe('admin pages', () => {
        it('redirects to /login when not authenticated', async () => {
            const res = await runMiddleware('/admin/dashboard', null);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
        });

        it('redirects PROVIDER role to /profile', async () => {
            const session = { user: { id: 'p1', email: 'p@e.com', name: 'P', role: 'PROVIDER' } };
            const res = await runMiddleware('/admin/dashboard', session);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/profile');
        });

        it('allows ADMIN role', async () => {
            const session = { user: { id: 'a1', email: 'a@e.com', name: 'A', role: 'ADMIN' } };
            const res = await runMiddleware('/admin/dashboard', session);
            expect(res.status).toBe(200);
        });
    });

    describe('admin API routes', () => {
        it('returns 401 JSON when not authenticated', async () => {
            const res = await runMiddleware('/api/admin/stats', null);
            expect(res.status).toBe(401);
            const body = await res.json();
            expect(body.error).toBe('Authentication required');
        });

        it('returns 403 JSON for non-admin', async () => {
            const session = { user: { id: 'p1', email: 'p@e.com', name: 'P', role: 'PROVIDER' } };
            const res = await runMiddleware('/api/admin/stats', session);
            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error).toBe('Insufficient permissions');
        });

        it('passes through with x-user-* headers for admin', async () => {
            const session = { user: { id: 'a1', email: 'admin@e.com', name: 'A', role: 'ADMIN' } };
            const res = await runMiddleware('/api/admin/stats', session);
            expect(res.status).toBe(200);
            expect(res.headers.get('x-middleware-request-x-user-id')).toBe('a1');
            expect(res.headers.get('x-middleware-request-x-user-role')).toBe('ADMIN');
        });
    });

    describe('provider API routes', () => {
        it('returns 401 JSON when not authenticated', async () => {
            const res = await runMiddleware('/api/provider/sessions', null);
            expect(res.status).toBe(401);
            const body = await res.json();
            expect(body.error).toBe('Authentication required');
        });

        it('returns 403 JSON for USER role', async () => {
            const session = { user: { id: 'u1', email: 'u@e.com', name: 'U', role: 'USER' } };
            const res = await runMiddleware('/api/provider/sessions', session);
            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error).toBe('Insufficient permissions');
        });

        it('allows PROVIDER role', async () => {
            const session = { user: { id: 'p1', email: 'p@e.com', name: 'P', role: 'PROVIDER' } };
            const res = await runMiddleware('/api/provider/sessions', session);
            expect(res.status).toBe(200);
        });
    });

    describe('login redirect', () => {
        it('redirects authenticated user from /login to /live', async () => {
            const session = { user: { id: 'u1', email: 'u@e.com', name: 'U', role: 'USER' } };
            const res = await runMiddleware('/login', session);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/live');
        });

        it('allows unauthenticated access to /login', async () => {
            const res = await runMiddleware('/login', null);
            expect(res.status).toBe(200);
        });
    });

    describe('POST /api/meditations auth', () => {
        it('returns 401 for unauthenticated POST', async () => {
            const res = await runMiddleware('/api/meditations', null, 'POST');
            expect(res.status).toBe(401);
        });

        it('allows authenticated POST', async () => {
            const session = { user: { id: 'u1', email: 'u@e.com', name: 'U', role: 'USER' } };
            const res = await runMiddleware('/api/meditations', session, 'POST');
            expect(res.status).toBe(200);
        });

        it('allows unauthenticated GET to /api/meditations', async () => {
            const res = await runMiddleware('/api/meditations', null, 'GET');
            expect(res.status).toBe(200);
        });
    });

    describe('additional protected pages', () => {
        it('redirects /join to /login when not authenticated', async () => {
            const res = await runMiddleware('/join', null);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
        });

        it('redirects /session to /login when not authenticated', async () => {
            const res = await runMiddleware('/session', null);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
        });

        it('redirects /playback to /login when not authenticated', async () => {
            const res = await runMiddleware('/playback', null);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
        });

        it('allows /join for authenticated user', async () => {
            const session = { user: { id: 'u1', email: 'u@e.com', name: 'U', role: 'LISTENER' } };
            const res = await runMiddleware('/join', session);
            expect(res.status).toBe(200);
        });
    });

    describe('nested route protection', () => {
        it('protects /live/sub-path for unauthenticated', async () => {
            const res = await runMiddleware('/live/sub-path', null);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/login');
        });

        it('protects /provider/dashboard for LISTENER role', async () => {
            const session = { user: { id: 'l1', email: 'l@e.com', name: 'L', role: 'LISTENER' } };
            const res = await runMiddleware('/provider/dashboard', session);
            expect(res.status).toBe(307);
            expect(new URL(res.headers.get('location')!).pathname).toBe('/profile');
        });

        it('redirects USER to /profile?unauthorized=1 for admin pages', async () => {
            const session = { user: { id: 'u1', email: 'u@e.com', name: 'U', role: 'USER' } };
            const res = await runMiddleware('/admin/users', session);
            expect(res.status).toBe(307);
            const loc = new URL(res.headers.get('location')!);
            expect(loc.pathname).toBe('/profile');
            expect(loc.searchParams.get('unauthorized')).toBe('1');
        });

        it('passes x-user-email header for admin API', async () => {
            const session = { user: { id: 'a1', email: 'admin@e.com', name: 'A', role: 'ADMIN' } };
            const res = await runMiddleware('/api/admin/users', session);
            expect(res.status).toBe(200);
            expect(res.headers.get('x-middleware-request-x-user-email')).toBe('admin@e.com');
        });

        it('returns 403 for LISTENER on provider API', async () => {
            const session = { user: { id: 'l1', email: 'l@e.com', name: 'L', role: 'LISTENER' } };
            const res = await runMiddleware('/api/provider/sessions', session);
            expect(res.status).toBe(403);
        });

        it('allows ADMIN on provider API routes', async () => {
            const session = { user: { id: 'a1', email: 'a@e.com', name: 'A', role: 'ADMIN' } };
            const res = await runMiddleware('/api/provider/sessions', session);
            expect(res.status).toBe(200);
        });
    });
});
