import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseResponse } from '@/__tests__/helpers';

describe('GET /api/users/me', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 404 when user not found', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'User not found' });
    });

    it('returns user profile with stats', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: {
                findUnique: vi.fn().mockResolvedValue({
                    id: 'db-user-1',
                    name: 'Test User',
                    email: 'user@example.com',
                    avatarUrl: 'https://example.com/avatar.png',
                    role: 'USER',
                }),
            },
            listeningSession: {
                count: vi.fn().mockResolvedValue(5),
                aggregate: vi.fn().mockResolvedValue({ _sum: { durationSeconds: 3600 } }),
            },
            favorite: {
                count: vi.fn().mockResolvedValue(3),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as {
            user: { name: string; email: string; avatarUrl: string; role: string };
            stats: { totalSessions: number; totalMinutes: number; favoritesCount: number };
        };

        expect(data.user).toEqual({
            name: 'Test User',
            email: 'user@example.com',
            avatarUrl: 'https://example.com/avatar.png',
            role: 'USER',
        });
        expect(data.stats).toEqual({
            totalSessions: 5,
            totalMinutes: 60,
            favoritesCount: 3,
        });
    });

    it('returns stats with zero values for new user', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'New User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: {
                findUnique: vi.fn().mockResolvedValue({
                    id: 'db-user-1',
                    name: 'New User',
                    email: 'user@example.com',
                    avatarUrl: null,
                    role: 'USER',
                }),
            },
            listeningSession: {
                count: vi.fn().mockResolvedValue(0),
                aggregate: vi.fn().mockResolvedValue({ _sum: { durationSeconds: null } }),
            },
            favorite: {
                count: vi.fn().mockResolvedValue(0),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as {
            stats: { totalSessions: number; totalMinutes: number; favoritesCount: number };
        };

        expect(data.stats).toEqual({
            totalSessions: 0,
            totalMinutes: 0,
            favoritesCount: 0,
        });
    });

    it('looks up user by zitadelId (not DB id)', async () => {
        const zitadelId = 'zitadel-subject-456';

        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: zitadelId, email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: {
                findUnique: vi.fn().mockResolvedValue({
                    id: 'db-uuid-789',
                    name: 'Test User',
                    email: 'user@example.com',
                    avatarUrl: null,
                    role: 'USER',
                }),
            },
            listeningSession: {
                count: vi.fn().mockResolvedValue(0),
                aggregate: vi.fn().mockResolvedValue({ _sum: { durationSeconds: null } }),
            },
            favorite: {
                count: vi.fn().mockResolvedValue(0),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        await GET();

        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
            where: { zitadelId },
            select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
                role: true,
            },
        });
    });
});
