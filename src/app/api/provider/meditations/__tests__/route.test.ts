import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

describe('GET /api/provider/meditations', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn() },
            meditation: { findMany: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 403 for USER role', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn() },
            meditation: { findMany: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Insufficient permissions' });
    });

    it('returns provider meditations scoped to the authenticated provider', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockMeditations = [
            {
                id: 'med-1',
                title: 'Morning Calm',
                description: 'A calming session',
                durationSeconds: 600,
                streamName: 'meditation-morning-calm',
                status: 'APPROVED',
                isPublished: true,
                isFeatured: false,
                rejectionReason: null,
                createdAt: new Date('2025-01-01'),
                _count: { sessions: 5 },
                tags: [
                    { tag: { name: 'Calm', slug: 'calm', category: 'mood' } },
                ],
            },
        ];

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            meditation: { findMany: vi.fn().mockResolvedValue(mockMeditations) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { meditations: Array<{ id: string; title: string; playCount: number; tags: unknown[] }> };
        expect(data.meditations).toHaveLength(1);
        expect(data.meditations[0].id).toBe('med-1');
        expect(data.meditations[0].title).toBe('Morning Calm');
        expect(data.meditations[0].playCount).toBe(5);

        // Verify scoped to provider
        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
            where: { zitadelId: 'zitadel-prov-123' },
            select: { id: true },
        });
        expect(mockPrisma.meditation.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { providerId: 'db-uuid-1' },
            }),
        );
    });

    it('returns empty array when provider has no meditations', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            meditation: { findMany: vi.fn().mockResolvedValue([]) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { meditations: unknown[] };
        expect(data.meditations).toEqual([]);
    });

    it('includes tag and status info in each meditation', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockMeditations = [
            {
                id: 'med-2',
                title: 'Deep Focus',
                description: 'Focus meditation',
                durationSeconds: 1200,
                streamName: 'meditation-deep-focus',
                status: 'PENDING',
                isPublished: false,
                isFeatured: false,
                rejectionReason: null,
                createdAt: new Date('2025-02-01'),
                _count: { sessions: 0 },
                tags: [
                    { tag: { name: 'Focus', slug: 'focus', category: 'mood' } },
                    { tag: { name: 'Work', slug: 'work', category: 'activity' } },
                ],
            },
        ];

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            meditation: { findMany: vi.fn().mockResolvedValue(mockMeditations) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { meditations: Array<{
            status: string;
            isPublished: boolean;
            tags: Array<{ name: string; slug: string; category: string }>;
        }> };
        expect(data.meditations[0].status).toBe('PENDING');
        expect(data.meditations[0].isPublished).toBe(false);
        expect(data.meditations[0].tags).toHaveLength(2);
        expect(data.meditations[0].tags[0]).toEqual({ name: 'Focus', slug: 'focus', category: 'mood' });
        expect(data.meditations[0].tags[1]).toEqual({ name: 'Work', slug: 'work', category: 'activity' });
    });
});
