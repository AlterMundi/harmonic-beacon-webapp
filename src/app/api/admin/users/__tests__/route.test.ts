import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

describe('GET /api/admin/users', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            user: { findMany: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/users');
        const response = await GET(request);
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
            user: { findMany: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/users');
        const response = await GET(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Insufficient permissions' });
    });

    it('returns users with meditation/session counts', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockUsers = [
            {
                id: 'user-1',
                name: 'Alice',
                email: 'alice@example.com',
                avatarUrl: null,
                role: 'PROVIDER',
                createdAt: new Date('2025-01-15'),
                _count: { meditations: 5, sessions: 12 },
            },
            {
                id: 'user-2',
                name: 'Bob',
                email: 'bob@example.com',
                avatarUrl: 'https://example.com/bob.png',
                role: 'USER',
                createdAt: new Date('2025-02-20'),
                _count: { meditations: 0, sessions: 3 },
            },
        ];

        const mockPrisma = {
            user: { findMany: vi.fn().mockResolvedValue(mockUsers) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/users');
        const response = await GET(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { users: Array<Record<string, unknown>> };
        expect(data.users).toHaveLength(2);
        expect(data.users[0].name).toBe('Alice');
        expect(data.users[0]._count).toEqual({ meditations: 5, sessions: 12 });
        expect(data.users[1].name).toBe('Bob');
        expect(data.users[1]._count).toEqual({ meditations: 0, sessions: 3 });

        // Verify findMany was called with correct select shape
        expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                orderBy: { createdAt: 'desc' },
                select: expect.objectContaining({
                    id: true,
                    name: true,
                    email: true,
                    role: true,
                    _count: {
                        select: { meditations: true, sessions: true },
                    },
                }),
            }),
        );
    });
});
