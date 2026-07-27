import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

describe('GET /api/meditations', () => {
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
            isFeatured: false,
            isPublished: true,
            defaultMix: 0.7,
            status: 'APPROVED',
            createdAt: new Date('2025-01-01'),
            provider: { name: 'Test Provider', avatarUrl: null },
            tags: [
                { tag: { name: 'Calm', slug: 'calm', category: 'mood' } },
            ],
            ...overrides,
        };
    }

    it('returns published APPROVED meditations', async () => {
        const mockMeditations = [makeMeditation()];
        const mockPrisma = {
            meditation: { findMany: vi.fn().mockResolvedValue(mockMeditations) },
        };

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/meditations');
        const response = await GET(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { meditations: Array<{ defaultMix: number }> };
        expect(data.meditations).toHaveLength(1);
        expect(data.meditations[0].defaultMix).toBe(0.7);

        // Verify prisma was called with correct where clause
        expect(mockPrisma.meditation.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { isPublished: true, status: 'APPROVED', isHidden: false },
            }),
        );
    });

    it('returns empty array when no meditations exist', async () => {
        const mockPrisma = {
            meditation: { findMany: vi.fn().mockResolvedValue([]) },
        };

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/meditations');
        const response = await GET(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { meditations: unknown[] };
        expect(data.meditations).toEqual([]);
    });

    it('filters by tag slug when ?tag= param is provided', async () => {
        const mockPrisma = {
            meditation: { findMany: vi.fn().mockResolvedValue([]) },
        };

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/meditations', {
            searchParams: { tag: 'calm' },
        });
        const response = await GET(request);
        const { status } = await parseResponse(response);

        expect(status).toBe(200);
        expect(mockPrisma.meditation.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    isPublished: true,
                    status: 'APPROVED',
                    isHidden: false,
                    tags: { some: { tag: { slug: 'calm' } } },
                },
            }),
        );
    });

    it('orders by featured first, then newest', async () => {
        const featured = makeMeditation({ id: 'med-featured', isFeatured: true, title: 'Featured' });
        const regular = makeMeditation({ id: 'med-regular', isFeatured: false, title: 'Regular' });
        const mockPrisma = {
            meditation: { findMany: vi.fn().mockResolvedValue([featured, regular]) },
        };

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/meditations');
        const response = await GET(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(mockPrisma.meditation.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
            }),
        );

        const data = body as { meditations: { id: string; isFeatured: boolean }[] };
        expect(data.meditations[0].isFeatured).toBe(true);
        expect(data.meditations[1].isFeatured).toBe(false);
    });

    it('includes provider name in response', async () => {
        const med = makeMeditation({ provider: { name: 'Guru Bob', avatarUrl: 'https://example.com/avatar.png' } });
        const mockPrisma = {
            meditation: { findMany: vi.fn().mockResolvedValue([med]) },
        };

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/meditations');
        const response = await GET(request);
        const { body } = await parseResponse(response);

        const data = body as { meditations: { provider: { name: string; avatarUrl: string | null } }[] };
        expect(data.meditations[0].provider).toEqual({ name: 'Guru Bob', avatarUrl: 'https://example.com/avatar.png' });
    });

    it('returns 500 on database error when filesystem fallback also fails', async () => {
        const mockPrisma = {
            meditation: { findMany: vi.fn().mockRejectedValue(new Error('DB down')) },
        };

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        // Mock fs/promises.readdir to also fail (no fallback files)
        vi.doMock('fs/promises', () => ({
            readdir: vi.fn().mockRejectedValue(new Error('ENOENT')),
            stat: vi.fn().mockRejectedValue(new Error('ENOENT')),
        }));

        const { GET } = await import('../route');
        const request = createRequest('/api/meditations');
        const response = await GET(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(500);
        expect(body).toEqual({ error: 'Failed to list meditations' });
    });
});
