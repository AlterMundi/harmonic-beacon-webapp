import { auth } from '@/auth';
import { NextResponse } from 'next/server';

export type { Role } from './auth-config';

export { auth } from '@/auth';

export function isAdmin(role: string): boolean {
    return role === 'ADMIN';
}

export function isAdminOrProvider(role: string): boolean {
    return role === 'ADMIN' || role === 'PROVIDER';
}

/**
 * Get authenticated session or return 401 response.
 * Use in API routes: const [session, errorResponse] = await requireAuth();
 */
export async function requireAuth(): Promise<
    [{ user: { id: string; email: string; name?: string | null; image?: string | null; role: 'ADMIN' | 'PROVIDER' | 'USER' } }, null] |
    [null, NextResponse]
> {
    const session = await auth();
    if (!session?.user?.id) {
        return [null, NextResponse.json({ error: 'Authentication required' }, { status: 401 })];
    }
    return [session as { user: { id: string; email: string; name?: string | null; image?: string | null; role: 'ADMIN' | 'PROVIDER' | 'USER' } }, null];
}

/**
 * Get authenticated session with required role, or return 401/403 response.
 */
export async function requireRole(...roles: string[]): Promise<
    [{ user: { id: string; email: string; name?: string | null; image?: string | null; role: 'ADMIN' | 'PROVIDER' | 'USER' } }, null] |
    [null, NextResponse]
> {
    const [session, errorResponse] = await requireAuth();
    if (!session) return [null, errorResponse];

    if (!roles.includes(session.user.role)) {
        return [null, NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })];
    }
    return [session, null];
}
