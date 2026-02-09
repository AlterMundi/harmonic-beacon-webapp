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
            user: { update: vi.fn().mockResolvedValue({ id: 'user-1', role: 'PROVIDER' }) },
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
