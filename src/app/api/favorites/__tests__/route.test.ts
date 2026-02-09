import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

describe('GET /api/favorites', () => {
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

    it('returns favorites list with meditation details', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockFavorites = [
            {
                meditationId: 'med-1',
                meditation: {
                    id: 'med-1',
                    title: 'Morning Calm',
                    streamName: 'morning-calm',
                    durationSeconds: 600,
                    tags: [
                        { tag: { name: 'Calm', slug: 'calm', category: 'mood' } },
                    ],
                },
            },
        ];

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            favorite: { findMany: vi.fn().mockResolvedValue(mockFavorites) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { favorites: unknown[] };
        expect(data.favorites).toHaveLength(1);
        expect(data.favorites[0]).toEqual({
            meditationId: 'med-1',
            meditation: {
                id: 'med-1',
                title: 'Morning Calm',
                streamName: 'morning-calm',
                durationSeconds: 600,
                tags: [{ name: 'Calm', slug: 'calm', category: 'mood' }],
            },
        });
    });

    it('returns empty favorites array', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            favorite: { findMany: vi.fn().mockResolvedValue([]) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { favorites: unknown[] };
        expect(data.favorites).toEqual([]);
    });
});

describe('POST /api/favorites', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));

        const { POST } = await import('../route');
        const res = await POST(createRequest('/api/favorites', {
            method: 'POST',
            body: { meditationId: 'med-1' },
        }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 400 when meditationId is missing', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));

        const { POST } = await import('../route');
        const res = await POST(createRequest('/api/favorites', {
            method: 'POST',
            body: {},
        }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'meditationId is required' });
    });

    it('creates favorite when not already favorited (returns {favorited: true})', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            favorite: {
                findUnique: vi.fn().mockResolvedValue(null),
                create: vi.fn().mockResolvedValue({ userId: 'db-user-1', meditationId: 'med-1' }),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { POST } = await import('../route');
        const res = await POST(createRequest('/api/favorites', {
            method: 'POST',
            body: { meditationId: 'med-1' },
        }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        expect(body).toEqual({ favorited: true });
        expect(mockPrisma.favorite.create).toHaveBeenCalledWith({
            data: { userId: 'db-user-1', meditationId: 'med-1' },
        });
    });

    it('removes existing favorite (returns {favorited: false})', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            favorite: {
                findUnique: vi.fn().mockResolvedValue({ userId: 'db-user-1', meditationId: 'med-1' }),
                delete: vi.fn().mockResolvedValue({}),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { POST } = await import('../route');
        const res = await POST(createRequest('/api/favorites', {
            method: 'POST',
            body: { meditationId: 'med-1' },
        }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        expect(body).toEqual({ favorited: false });
        expect(mockPrisma.favorite.delete).toHaveBeenCalledWith({
            where: {
                userId_meditationId: { userId: 'db-user-1', meditationId: 'med-1' },
            },
        });
    });
});
