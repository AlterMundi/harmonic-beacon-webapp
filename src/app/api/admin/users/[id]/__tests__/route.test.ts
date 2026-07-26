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

    it('updates user role successfully', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            user: {
                // Two distinct reads: the target's outgoing role, then the acting
                // admin's DB uuid resolved by the audit helper.
                findUnique: vi.fn()
                    .mockResolvedValueOnce({ role: 'LISTENER' })
                    .mockResolvedValueOnce({ id: 'db-admin-1' }),
                update: vi.fn().mockResolvedValue({ id: 'user-1', role: 'PROVIDER' }),
            },
            auditLog: { create: vi.fn().mockResolvedValue({}) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/users/user-1', {
            method: 'PATCH',
            body: { role: 'PROVIDER' },
        });
        const response = await PATCH(request, mockParams({ id: 'user-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(body).toEqual({ success: true });

        expect(mockPrisma.user.update).toHaveBeenCalledWith({
            where: { id: 'user-1' },
            data: { role: 'PROVIDER' },
        });
    });

    it('writes an audit entry recording both the old and the new role', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            user: {
                findUnique: vi.fn()
                    .mockResolvedValueOnce({ role: 'LISTENER' })
                    .mockResolvedValueOnce({ id: 'db-admin-1' }),
                update: vi.fn().mockResolvedValue({ id: 'user-1', role: 'PROVIDER' }),
            },
            auditLog: { create: vi.fn().mockResolvedValue({}) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/users/user-1', {
            method: 'PATCH',
            body: { role: 'PROVIDER' },
        });
        const response = await PATCH(request, mockParams({ id: 'user-1' }));

        expect(response.status).toBe(200);
        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
            data: {
                actorId: 'db-admin-1',
                actorRole: 'ADMIN',
                action: 'user.role_change',
                targetType: 'USER',
                targetId: 'user-1',
                metadata: { previousRole: 'LISTENER', newRole: 'PROVIDER' },
            },
        });
    });

    it('returns 404 when the target user does not exist', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            user: {
                findUnique: vi.fn().mockResolvedValue(null),
                update: vi.fn(),
            },
            auditLog: { create: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/users/user-1', {
            method: 'PATCH',
            body: { role: 'PROVIDER' },
        });
        const response = await PATCH(request, mockParams({ id: 'user-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'User not found' });
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('still changes the role when the audit write fails', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            user: {
                findUnique: vi.fn()
                    .mockResolvedValueOnce({ role: 'LISTENER' })
                    .mockResolvedValueOnce({ id: 'db-admin-1' }),
                update: vi.fn().mockResolvedValue({ id: 'user-1', role: 'PROVIDER' }),
            },
            auditLog: { create: vi.fn().mockRejectedValue(new Error('audit table unreachable')) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/users/user-1', {
            method: 'PATCH',
            body: { role: 'PROVIDER' },
        });
        const response = await PATCH(request, mockParams({ id: 'user-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(body).toEqual({ success: true });
        expect(mockPrisma.user.update).toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    });

    it('returns 400 for invalid role', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            user: { update: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/users/user-1', {
            method: 'PATCH',
            body: { role: 'SUPERUSER' },
        });
        const response = await PATCH(request, mockParams({ id: 'user-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Invalid role' });

        // Verify prisma.update was NOT called
        expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });
});
