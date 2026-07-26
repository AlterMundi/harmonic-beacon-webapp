import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

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

describe('DELETE /api/provider/meditations/[id] - provider takedown', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    /** A published meditation owned by the acting Provider. */
    const publishedMeditation = {
        id: 'med-1',
        title: 'Morning Calm',
        providerId: 'db-uuid-1',
        status: 'APPROVED',
        isPublished: true,
        isFeatured: false,
        isHidden: false,
    };

    function setupMocks(
        existing: Record<string, unknown> | null = publishedMeditation,
        options: { role?: string; dbUserId?: string } = {},
    ) {
        const { role = 'PROVIDER', dbUserId = 'db-uuid-1' } = options;

        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: dbUserId }) },
            auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(existing),
                update: vi.fn().mockImplementation(({ data }) =>
                    Promise.resolve({ ...existing, ...data })),
            },
            meditationTag: { deleteMany: vi.fn(), createMany: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        return { mockPrisma };
    }

    async function takedown(id = 'med-1') {
        const { DELETE } = await import('../route');
        return DELETE(
            createRequest(`/api/provider/meditations/${id}`, { method: 'DELETE' }),
            mockParams({ id }),
        );
    }

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
        vi.doMock('@/lib/db', () => ({
            prisma: { meditation: { findUnique: vi.fn(), update: vi.fn() }, user: { findUnique: vi.fn() } },
        }));

        const { status, body } = await parseResponse(await takedown());

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 403 for a LISTENER', async () => {
        setupMocks(publishedMeditation, { role: 'LISTENER' });

        const { status, body } = await parseResponse(await takedown());

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Insufficient permissions' });
    });

    it('refuses to take down another Provider\'s content', async () => {
        // The whole point of the ownership check: a Provider takes down their
        // own work and nobody else's.
        const { mockPrisma } = setupMocks({ ...publishedMeditation, providerId: 'other-provider-uuid' });

        const { status, body } = await parseResponse(await takedown());

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Unauthorized' });
        expect(mockPrisma.meditation.update).not.toHaveBeenCalled();
        expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });

    it('returns 404 when the meditation does not exist', async () => {
        setupMocks(null);

        const { status, body } = await parseResponse(await takedown('nonexistent'));

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Meditation not found' });
    });

    it('sets isHidden alone, matching the Hidden invariant', async () => {
        // BUSINESS_RULES.md §2.1: Hidden is APPROVED + isPublished true +
        // isHidden true. Hiding writes isHidden and nothing else, so the
        // pre-takedown publication state survives.
        const { mockPrisma } = setupMocks();

        const { status, body } = await parseResponse(await takedown());

        expect(status).toBe(200);
        expect(mockPrisma.meditation.update).toHaveBeenCalledWith({
            where: { id: 'med-1' },
            data: { isHidden: true },
        });
        expect((body as { meditation: unknown }).meditation).toEqual({
            id: 'med-1',
            status: 'APPROVED',
            isPublished: true,
            isHidden: true,
        });
    });

    it('does not delete the row', async () => {
        // BUSINESS_RULES.md §9.2: the row is the tombstone other listeners'
        // history hangs off. There is no delete call to make.
        const { mockPrisma } = setupMocks();

        await takedown();

        expect(mockPrisma.meditation).not.toHaveProperty('delete');
        expect(mockPrisma.meditation.update).toHaveBeenCalledTimes(1);
    });

    it('states that the audio was not purged', async () => {
        const { body } = await parseResponse(await (async () => {
            setupMocks();
            return takedown();
        })());

        const { retained } = body as { retained: string[] };
        expect(retained.some((line) => /audio file is not purged/i.test(line))).toBe(true);
        expect(retained.some((line) => /kept, not deleted/i.test(line))).toBe(true);
    });

    it('logs the takedown as a Provider action, not an Admin hide', async () => {
        const { mockPrisma } = setupMocks();

        await takedown();

        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
            data: {
                actorId: 'db-uuid-1',
                actorRole: 'PROVIDER',
                action: 'meditation.takedown',
                targetType: 'MEDITATION',
                targetId: 'med-1',
                metadata: {
                    previousIsHidden: false,
                    previousStatus: 'APPROVED',
                    previousIsPublished: true,
                    withdrawnFromReview: false,
                },
            },
        });
    });

    it('treats a PENDING meditation as a withdrawal from review', async () => {
        // Withdrawing before review is a different act from pulling published
        // content, and the response names it — but it is the same write, so the
        // row stays distinguishable from "published, then taken down".
        const { mockPrisma } = setupMocks({
            ...publishedMeditation,
            status: 'PENDING',
            isPublished: false,
        });

        const { status, body } = await parseResponse(await takedown());
        const data = body as { withdrawnFromReview: boolean; meditation: Record<string, unknown>; retained: string[] };

        expect(status).toBe(200);
        expect(data.withdrawnFromReview).toBe(true);
        expect(mockPrisma.meditation.update).toHaveBeenCalledWith({
            where: { id: 'med-1' },
            data: { isHidden: true },
        });
        expect(data.meditation).toEqual({
            id: 'med-1',
            status: 'PENDING',
            isPublished: false,
            isHidden: true,
        });
        expect(data.retained.some((line) => /cannot be approved while it is down/i.test(line))).toBe(true);
    });

    it('lets an Admin take down content they do not own', async () => {
        // The route has always exempted Admins from the ownership check; the
        // audit entry records who actually acted.
        const { mockPrisma } = setupMocks(
            { ...publishedMeditation, providerId: 'someone-else' },
            { role: 'ADMIN', dbUserId: 'db-admin-1' },
        );

        const { status } = await parseResponse(await takedown());

        expect(status).toBe(200);
        expect(mockPrisma.auditLog.create.mock.calls[0][0].data.actorRole).toBe('ADMIN');
    });

    it('returns 500 when the update fails', async () => {
        const { mockPrisma } = setupMocks();
        mockPrisma.meditation.update.mockRejectedValue(new Error('db down'));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { status, body } = await parseResponse(await takedown());

        expect(status).toBe(500);
        expect(body).toEqual({ error: 'Failed to take down meditation' });
        consoleError.mockRestore();
    });
});
