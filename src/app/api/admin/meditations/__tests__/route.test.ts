import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

describe('GET /api/admin/meditations', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    function makeMeditation(overrides: Record<string, unknown> = {}) {
        return {
            id: 'med-1',
            title: 'Morning Calm',
            description: 'A calming meditation',
            durationSeconds: 600,
            streamName: 'meditation-morning-calm',
            filePath: 'morning_calm.m4a',
            status: 'PENDING',
            isPublished: false,
            isFeatured: false,
            rejectionReason: null,
            createdAt: new Date('2025-01-01'),
            reviewedAt: null,
            provider: { name: 'Test Provider', email: 'provider@example.com' },
            tags: [
                { tag: { name: 'Calm', slug: 'calm', category: 'mood' } },
            ],
            ...overrides,
        };
    }

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            meditation: { findMany: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/meditations');
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
            meditation: { findMany: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/meditations');
        const response = await GET(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Insufficient permissions' });
    });

    it('returns meditations with provider info', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockMeditations = [makeMeditation()];
        const mockPrisma = {
            meditation: { findMany: vi.fn().mockResolvedValue(mockMeditations) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/meditations');
        const response = await GET(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { meditations: Array<Record<string, unknown>> };
        expect(data.meditations).toHaveLength(1);
        expect(data.meditations[0].title).toBe('Morning Calm');
        expect(data.meditations[0].provider).toEqual({ name: 'Test Provider', email: 'provider@example.com' });
        expect(data.meditations[0].tags).toEqual([
            { name: 'Calm', slug: 'calm', category: 'mood' },
        ]);

        // Verify findMany was called with empty where (no status filter)
        expect(mockPrisma.meditation.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {},
                orderBy: { createdAt: 'desc' },
            }),
        );
    });

    it('filters by status query param', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            meditation: { findMany: vi.fn().mockResolvedValue([]) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/meditations', {
            searchParams: { status: 'PENDING' },
        });
        const response = await GET(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { meditations: unknown[] };
        expect(data.meditations).toEqual([]);

        // Verify the PENDING filter was applied
        expect(mockPrisma.meditation.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { status: 'PENDING' },
            }),
        );
    });
});
