import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @/auth globally for this file since auth.ts re-exports from it
vi.mock('@/auth', () => ({
    auth: vi.fn().mockResolvedValue(null),
}));

import { isAdmin, isAdminOrProvider } from '../auth';

describe('isAdmin', () => {
    it('returns true for ADMIN', () => {
        expect(isAdmin('ADMIN')).toBe(true);
    });

    it('returns false for PROVIDER', () => {
        expect(isAdmin('PROVIDER')).toBe(false);
    });

    it('returns false for USER', () => {
        expect(isAdmin('USER')).toBe(false);
    });

    it('returns false for empty string', () => {
        expect(isAdmin('')).toBe(false);
    });
});

describe('isAdminOrProvider', () => {
    it('returns true for ADMIN', () => {
        expect(isAdminOrProvider('ADMIN')).toBe(true);
    });

    it('returns true for PROVIDER', () => {
        expect(isAdminOrProvider('PROVIDER')).toBe(true);
    });

    it('returns false for USER', () => {
        expect(isAdminOrProvider('USER')).toBe(false);
    });

    it('returns false for LISTENER', () => {
        expect(isAdminOrProvider('LISTENER')).toBe(false);
    });
});

describe('requireAuth', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns [session, null] when authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'user-123', email: 'test@example.com', name: 'Test', image: null, role: 'USER' },
            }),
        }));
        const { requireAuth } = await import('../auth');
        const [session, error] = await requireAuth();
        expect(session).not.toBeNull();
        expect(session!.user.id).toBe('user-123');
        expect(error).toBeNull();
    });

    it('returns [null, 401] when session is null', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));
        const { requireAuth } = await import('../auth');
        const [session, error] = await requireAuth();
        expect(session).toBeNull();
        expect(error).not.toBeNull();
        expect(error!.status).toBe(401);
    });

    it('returns [null, 401] when user.id is missing', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({ user: { email: 'test@example.com' } }),
        }));
        const { requireAuth } = await import('../auth');
        const [session, error] = await requireAuth();
        expect(session).toBeNull();
        expect(error!.status).toBe(401);
    });
});

describe('requireRole', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns [session, null] when role matches', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'admin-1', email: 'admin@example.com', name: 'Admin', image: null, role: 'ADMIN' },
            }),
        }));
        const { requireRole } = await import('../auth');
        const [session, error] = await requireRole('ADMIN');
        expect(session).not.toBeNull();
        expect(session!.user.role).toBe('ADMIN');
        expect(error).toBeNull();
    });

    it('returns [null, 403] when role does not match', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'user-1', email: 'user@example.com', name: 'User', image: null, role: 'USER' },
            }),
        }));
        const { requireRole } = await import('../auth');
        const [session, error] = await requireRole('ADMIN');
        expect(session).toBeNull();
        expect(error!.status).toBe(403);
    });

    it('returns [null, 401] when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));
        const { requireRole } = await import('../auth');
        const [session, error] = await requireRole('ADMIN');
        expect(session).toBeNull();
        expect(error!.status).toBe(401);
    });

    it('accepts multiple roles', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'prov-1', email: 'prov@example.com', name: 'Provider', image: null, role: 'PROVIDER' },
            }),
        }));
        const { requireRole } = await import('../auth');
        const [session, error] = await requireRole('ADMIN', 'PROVIDER');
        expect(session).not.toBeNull();
        expect(error).toBeNull();
    });
});
