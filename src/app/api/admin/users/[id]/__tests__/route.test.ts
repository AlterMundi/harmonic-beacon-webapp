import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('PATCH /api/admin/users/[id]', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            user: { update: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/users/user-1', {
            method: 'PATCH',
            body: { role: 'PROVIDER' },
        });
        const response = await PATCH(request, mockParams({ id: 'user-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 403 for non-admin', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { update: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/users/user-1', {
            method: 'PATCH',
            body: { role: 'PROVIDER' },
        });
        const response = await PATCH(request, mockParams({ id: 'user-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Insufficient permissions' });
    });

    /**
     * Roles are granted in Zitadel and this endpoint refuses. The four tests that
     * used to live here asserted that a PATCH wrote `User.role` — behaviour that
     * was removed, because it appeared to work and then reverted at the target's
     * next sign-in, when the role is re-read from the Zitadel claim.
     */
    function mockAdminAnd(currentRole: string) {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            user: {
                findUnique: vi.fn().mockResolvedValue({ id: 'db-admin-1', role: currentRole }),
                update: vi.fn(),
            },
            auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        return mockPrisma;
    }

    it('refuses to change a role and says where roles are granted', async () => {
        const mockPrisma = mockAdminAnd('LISTENER');

        const { PATCH } = await import('../route');
        const response = await PATCH(
            createRequest('/api/admin/users/user-1', { method: 'PATCH', body: { role: 'PROVIDER' } }),
            mockParams({ id: 'user-1' }),
        );
        const { status, body } = await parseResponse(response);

        expect(status).toBe(409);
        const data = body as { error: string; detail: string; claims: Record<string, string> };
        expect(data.error).toMatch(/not granted here/i);
        // The refusal has to be actionable, or an Admin is just stuck.
        expect(data.detail).toMatch(/zitadel/i);
        expect(data.claims).toEqual({ ADMIN: 'BEAC_ADMIN', PROVIDER: 'BEAC_PROVIDER' });
    });

    it('never writes the role', async () => {
        // The whole point. A write here is undone at the next sign-in, so the
        // regression this guards against is someone restoring it as a convenience.
        const mockPrisma = mockAdminAnd('LISTENER');

        const { PATCH } = await import('../route');
        await PATCH(
            createRequest('/api/admin/users/user-1', { method: 'PATCH', body: { role: 'ADMIN' } }),
            mockParams({ id: 'user-1' }),
        );

        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('audits the refused attempt', async () => {
        // An Admin reaching for a control that should not be reachable is worth
        // recording — it says the UI is still steering someone toward it.
        const mockPrisma = mockAdminAnd('LISTENER');

        const { PATCH } = await import('../route');
        await PATCH(
            createRequest('/api/admin/users/user-1', { method: 'PATCH', body: { role: 'PROVIDER' } }),
            mockParams({ id: 'user-1' }),
        );

        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    action: 'user.role_change_refused',
                    targetType: 'USER',
                    targetId: 'user-1',
                }),
            }),
        );
    });

    it('refuses a malformed body the same way rather than 500ing', async () => {
        mockAdminAnd('LISTENER');

        const { PATCH } = await import('../route');
        const request = new Request('http://localhost/api/admin/users/user-1', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: 'not json',
        });
        const { status } = await parseResponse(await PATCH(request, mockParams({ id: 'user-1' })));

        expect(status).toBe(409);
    });

    it('returns 404 for a user that does not exist', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));
        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue(null), update: vi.fn() },
            auditLog: { create: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { PATCH } = await import('../route');
        const { status } = await parseResponse(
            await PATCH(
                createRequest('/api/admin/users/user-1', { method: 'PATCH', body: { role: 'PROVIDER' } }),
                mockParams({ id: 'user-1' }),
            ),
        );

        expect(status).toBe(404);
        expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });
});
