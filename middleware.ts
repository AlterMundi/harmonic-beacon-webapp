import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export default auth((req) => {
    const { pathname } = req.nextUrl;
    const session = req.auth;

    // Protected page routes: redirect to login
    const protectedPages = ['/live', '/meditation', '/profile'];
    const isProtectedPage = protectedPages.some(r => pathname.startsWith(r));

    if (isProtectedPage && !session?.user) {
        return NextResponse.redirect(new URL('/login', req.url));
    }

    // Admin API: require ADMIN role
    if (pathname.startsWith('/api/admin')) {
        if (!session?.user) {
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }
        if (session.user.role !== 'ADMIN') {
            return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
        }
        const headers = new Headers(req.headers);
        headers.set('x-user-id', session.user.id);
        headers.set('x-user-role', session.user.role);
        headers.set('x-user-email', session.user.email ?? '');
        return NextResponse.next({ request: { headers } });
    }

    // POST /api/meditations: require authentication
    if (pathname === '/api/meditations' && req.method === 'POST') {
        if (!session?.user) {
            return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
        }
    }

    // Redirect authenticated users away from login
    if (pathname === '/login' && session?.user) {
        return NextResponse.redirect(new URL('/live', req.url));
    }

    return NextResponse.next();
});

export const config = {
    matcher: [
        '/live/:path*',
        '/meditation/:path*',
        '/profile/:path*',
        '/login',
        '/api/admin/:path*',
        '/api/meditations',
    ],
};
