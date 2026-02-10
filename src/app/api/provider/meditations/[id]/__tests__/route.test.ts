import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

// The route file only exports GET and PATCH (no DELETE).
// Test 9 (DELETE) and 10 (DELETE 404) are adapted to PATCH ownership / not-found checks.

describe('GET /api/provider/meditations/[id]', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            meditation: { findUnique: vi.fn() },
            user: { findUnique: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/provider/meditations/med-1');
        const response = await GET(request, mockParams({ id: 'med-1' }));
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
            meditation: { findUnique: vi.fn() },
            user: { findUnique: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/provider/meditations/med-1');
        const response = await GET(request, mockParams({ id: 'med-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Insufficient permissions' });
    });

    it('returns meditation detail for the owner', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockMeditation = {
            id: 'med-1',
            title: 'Morning Calm',
            description: 'A calm meditation',
            durationSeconds: 600,
            streamName: 'meditation-morning-calm',
            status: 'APPROVED',
            isPublished: true,
            isFeatured: false,
            defaultMix: 0.5,
            providerId: 'zitadel-prov-123', // matches session.user.id initially
            tags: [
                { tag: { id: 'tag-1', name: 'Calm', slug: 'calm', category: 'mood' } },
            ],
        };

        const mockPrisma = {
            meditation: { findUnique: vi.fn().mockResolvedValue(mockMeditation) },
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/provider/meditations/med-1');
        // Since the route checks providerId !== session.user.id first (which won't match db uuid),
        // then fetches dbUser and checks providerId !== dbUser.id,
        // we need providerId to match dbUser.id for ownership to pass.
        mockMeditation.providerId = 'db-uuid-1';
        const response = await GET(request, mockParams({ id: 'med-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { meditation: { id: string; tags: Array<{ name: string }> } };
        expect(data.meditation.id).toBe('med-1');
        expect(data.meditation.tags).toHaveLength(1);
        expect(data.meditation.tags[0].name).toBe('Calm');
    });

    it('returns 404 when meditation not found', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockPrisma = {
            meditation: { findUnique: vi.fn().mockResolvedValue(null) },
            user: { findUnique: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/provider/meditations/nonexistent');
        const response = await GET(request, mockParams({ id: 'nonexistent' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Meditation not found' });
    });

    it('returns 403 when provider does not own the meditation', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockMeditation = {
            id: 'med-1',
            title: 'Someone Else Meditation',
            providerId: 'other-provider-db-uuid',
            tags: [],
        };

        const mockPrisma = {
            meditation: { findUnique: vi.fn().mockResolvedValue(mockMeditation) },
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'my-db-uuid' }) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { GET } = await import('../route');
        const request = createRequest('/api/provider/meditations/med-1');
        const response = await GET(request, mockParams({ id: 'med-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Unauthorized' });
    });
});

describe('PATCH /api/provider/meditations/[id]', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('updates title and description', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockMeditation = {
            id: 'med-1',
            providerId: 'db-uuid-1',
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(mockMeditation),
                update: vi.fn().mockResolvedValue({ ...mockMeditation, title: 'New Title' }),
            },
            meditationTag: {
                deleteMany: vi.fn(),
                createMany: vi.fn(),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/meditations/med-1', {
            method: 'PATCH',
            body: { title: 'New Title', description: 'New description' },
        });
        const response = await PATCH(request, mockParams({ id: 'med-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(body).toEqual({ success: true });
        expect(mockPrisma.meditation.update).toHaveBeenCalledWith({
            where: { id: 'med-1' },
            data: { title: 'New Title', description: 'New description' },
        });
    });

    it('updates tags by deleting existing and creating new', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockMeditation = {
            id: 'med-1',
            providerId: 'db-uuid-1',
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(mockMeditation),
                update: vi.fn().mockResolvedValue(mockMeditation),
            },
            meditationTag: {
                deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
                createMany: vi.fn().mockResolvedValue({ count: 2 }),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/meditations/med-1', {
            method: 'PATCH',
            body: { title: 'Same', tagIds: ['tag-1', 'tag-2'] },
        });
        const response = await PATCH(request, mockParams({ id: 'med-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(body).toEqual({ success: true });
        expect(mockPrisma.meditationTag.deleteMany).toHaveBeenCalledWith({
            where: { meditationId: 'med-1' },
        });
        expect(mockPrisma.meditationTag.createMany).toHaveBeenCalledWith({
            data: [
                { meditationId: 'med-1', tagId: 'tag-1' },
                { meditationId: 'med-1', tagId: 'tag-2' },
            ],
        });
    });

    it('returns 404 when meditation not found for PATCH', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(null),
                update: vi.fn(),
            },
            meditationTag: {
                deleteMany: vi.fn(),
                createMany: vi.fn(),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/meditations/nonexistent', {
            method: 'PATCH',
            body: { title: 'New Title' },
        });
        const response = await PATCH(request, mockParams({ id: 'nonexistent' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Meditation not found' });
    });

    it('returns 403 when PATCH is attempted by non-owner', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockMeditation = {
            id: 'med-1',
            providerId: 'other-provider-uuid',
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'my-db-uuid' }) },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(mockMeditation),
                update: vi.fn(),
            },
            meditationTag: {
                deleteMany: vi.fn(),
                createMany: vi.fn(),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/meditations/med-1', {
            method: 'PATCH',
            body: { title: 'Stolen Title' },
        });
        const response = await PATCH(request, mockParams({ id: 'med-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Unauthorized' });
    });

    it('updates defaultMix when valid', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockMeditation = {
            id: 'med-1',
            providerId: 'db-uuid-1',
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(mockMeditation),
                update: vi.fn().mockResolvedValue({ ...mockMeditation, title: 'T', defaultMix: 0.8 }),
            },
            meditationTag: {
                deleteMany: vi.fn(),
                createMany: vi.fn(),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/meditations/med-1', {
            method: 'PATCH',
            body: { title: 'T', description: 'D', defaultMix: 0.8 },
        });
        const response = await PATCH(request, mockParams({ id: 'med-1' }));
        const { status } = await parseResponse(response);

        expect(status).toBe(200);
        expect(mockPrisma.meditation.update).toHaveBeenCalledWith({
            where: { id: 'med-1' },
            data: { title: 'T', description: 'D', defaultMix: 0.8 },
        });
    });

    it('ignores invalid defaultMix', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockMeditation = {
            id: 'med-1',
            providerId: 'db-uuid-1',
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(mockMeditation),
                update: vi.fn().mockResolvedValue({ ...mockMeditation, title: 'T' }),
            },
            meditationTag: {
                deleteMany: vi.fn(),
                createMany: vi.fn(),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/meditations/med-1', {
            method: 'PATCH',
            body: { title: 'T', description: 'D', defaultMix: 1.5 },
        });
        const response = await PATCH(request, mockParams({ id: 'med-1' }));
        const { status } = await parseResponse(response);

        expect(status).toBe(200);
        expect(mockPrisma.meditation.update).toHaveBeenCalledWith({
            where: { id: 'med-1' },
            data: { title: 'T', description: 'D' },
        });
    });
});
