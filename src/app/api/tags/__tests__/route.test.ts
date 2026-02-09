import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

describe('GET /api/tags', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns tags grouped by category', async () => {
        const mockTags = [
            { id: '1', name: 'Calm', slug: 'calm', category: 'mood', sortOrder: 0 },
            { id: '2', name: 'Focus', slug: 'focus', category: 'mood', sortOrder: 1 },
            { id: '3', name: '10 min', slug: '10-min', category: 'duration', sortOrder: 0 },
        ];

        const mockPrisma = {
            tag: { findMany: vi.fn().mockResolvedValue(mockTags) },
        };

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { tags: Record<string, { id: string; name: string; slug: string }[]>; all: unknown[] };

        expect(data.tags).toHaveProperty('mood');
        expect(data.tags).toHaveProperty('duration');
        expect(data.tags.mood).toHaveLength(2);
        expect(data.tags.duration).toHaveLength(1);
        expect(data.tags.mood[0]).toEqual({ id: '1', name: 'Calm', slug: 'calm' });
        expect(data.tags.mood[1]).toEqual({ id: '2', name: 'Focus', slug: 'focus' });
        expect(data.tags.duration[0]).toEqual({ id: '3', name: '10 min', slug: '10-min' });
    });

    it('returns flat all array with category included', async () => {
        const mockTags = [
            { id: '1', name: 'Calm', slug: 'calm', category: 'mood', sortOrder: 0 },
            { id: '2', name: '10 min', slug: '10-min', category: 'duration', sortOrder: 0 },
        ];

        const mockPrisma = {
            tag: { findMany: vi.fn().mockResolvedValue(mockTags) },
        };

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { all: { id: string; name: string; slug: string; category: string }[] };

        expect(data.all).toHaveLength(2);
        expect(data.all[0]).toEqual({ id: '1', name: 'Calm', slug: 'calm', category: 'mood' });
        expect(data.all[1]).toEqual({ id: '2', name: '10 min', slug: '10-min', category: 'duration' });
    });

    it('returns empty state when no tags exist', async () => {
        const mockPrisma = {
            tag: { findMany: vi.fn().mockResolvedValue([]) },
        };

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { tags: Record<string, unknown[]>; all: unknown[] };

        expect(data.tags).toEqual({});
        expect(data.all).toEqual([]);
    });

    it('returns 500 on database error', async () => {
        const mockPrisma = {
            tag: { findMany: vi.fn().mockRejectedValue(new Error('Connection refused')) },
        };

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(500);
        expect(body).toEqual({ error: 'Failed to list tags' });
    });
});
