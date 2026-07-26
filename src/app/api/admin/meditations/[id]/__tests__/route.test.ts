import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('PATCH /api/admin/meditations/[id]', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    const meditationRecord = {
        id: 'med-1',
        title: 'Morning Calm',
        filePath: 'morning_calm.ogg',
        status: 'PENDING',
        isPublished: false,
        isFeatured: false,
        rejectionReason: null,
        reviewedAt: null,
    };

    // BUSINESS_RULES.md §2.1: LANGUAGE plus one of MOOD/TECHNIQUE/DURATION.
    // Shape matches the route's `select: { tag: { select: { category: true } } }`.
    const publishableTags = [
        { tag: { category: 'LANGUAGE' } },
        { tag: { category: 'MOOD' } },
    ];

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: "db-admin-1", role: "ADMIN" }) },
            auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
            meditation: { findUnique: vi.fn(), update: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('fs/promises', () => ({
            rename: vi.fn(),
            copyFile: vi.fn(),
            unlink: vi.fn(),
            mkdir: vi.fn(),
        }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/meditations/med-1', {
            method: 'PATCH',
            body: { status: 'APPROVED' },
        });
        const response = await PATCH(request, mockParams({ id: 'med-1' }));
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
            user: { findUnique: vi.fn().mockResolvedValue({ id: "db-admin-1", role: "ADMIN" }) },
            auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
            meditation: { findUnique: vi.fn(), update: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('fs/promises', () => ({
            rename: vi.fn(),
            copyFile: vi.fn(),
            unlink: vi.fn(),
            mkdir: vi.fn(),
        }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/meditations/med-1', {
            method: 'PATCH',
            body: { status: 'APPROVED' },
        });
        const response = await PATCH(request, mockParams({ id: 'med-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Insufficient permissions' });
    });

    it('approves meditation (sets status=APPROVED, isPublished=true)', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const updatedMeditation = {
            ...meditationRecord,
            status: 'APPROVED',
            isPublished: true,
            isFeatured: false,
            reviewedAt: new Date('2025-06-01'),
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: "db-admin-1", role: "ADMIN" }) },
            auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(meditationRecord),
                update: vi.fn().mockResolvedValue(updatedMeditation),
            },
            meditationTag: { findMany: vi.fn().mockResolvedValue(publishableTags) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('fs/promises', () => ({
            rename: vi.fn().mockResolvedValue(undefined),
            copyFile: vi.fn(),
            unlink: vi.fn(),
            mkdir: vi.fn().mockResolvedValue(undefined),
        }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/meditations/med-1', {
            method: 'PATCH',
            body: { status: 'APPROVED' },
        });
        const response = await PATCH(request, mockParams({ id: 'med-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { meditation: Record<string, unknown> };
        expect(data.meditation.status).toBe('APPROVED');
        expect(data.meditation.isPublished).toBe(true);

        // Verify prisma update was called with correct data
        expect(mockPrisma.meditation.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'med-1' },
                data: expect.objectContaining({
                    status: 'APPROVED',
                    isPublished: true,
                    rejectionReason: null,
                }),
            }),
        );

        // And the action reached the audit log. This assertion exists because
        // without it the test passed while `logAdminAction` failed silently on
        // every run — audit writes are non-fatal by design, so an unmocked
        // `auditLog` produced a green test that verified only the graceful-failure
        // path. BUSINESS_RULES §1.3 promises every administrative action is
        // logged; that promise needs an assertion, not an absence of errors.
        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    action: 'meditation.approve',
                    targetType: 'MEDITATION',
                    targetId: 'med-1',
                    actorRole: 'ADMIN',
                }),
            }),
        );
    });

    it('moves file on approve', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const updatedMeditation = {
            ...meditationRecord,
            status: 'APPROVED',
            isPublished: true,
            reviewedAt: new Date('2025-06-01'),
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: "db-admin-1", role: "ADMIN" }) },
            auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(meditationRecord),
                update: vi.fn().mockResolvedValue(updatedMeditation),
            },
            meditationTag: { findMany: vi.fn().mockResolvedValue(publishableTags) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const mockRename = vi.fn().mockResolvedValue(undefined);
        const mockMkdir = vi.fn().mockResolvedValue(undefined);
        vi.doMock('fs/promises', () => ({
            rename: mockRename,
            copyFile: vi.fn(),
            unlink: vi.fn(),
            mkdir: mockMkdir,
        }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/meditations/med-1', {
            method: 'PATCH',
            body: { status: 'APPROVED' },
        });
        await PATCH(request, mockParams({ id: 'med-1' }));

        // Verify mkdir was called to ensure target directory exists
        expect(mockMkdir).toHaveBeenCalledWith(
            expect.any(String),
            { recursive: true },
        );

        // Verify rename was called with source and destination paths containing the filePath
        expect(mockRename).toHaveBeenCalledWith(
            expect.stringContaining('morning_calm.ogg'),
            expect.stringContaining('morning_calm.ogg'),
        );
    });

    it('rejects meditation with reason', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const updatedMeditation = {
            ...meditationRecord,
            status: 'REJECTED',
            isPublished: false,
            rejectionReason: 'Audio quality too low',
            reviewedAt: new Date('2025-06-01'),
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: "db-admin-1", role: "ADMIN" }) },
            auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(meditationRecord),
                update: vi.fn().mockResolvedValue(updatedMeditation),
            },
            // Untagged: rejection is not subject to the publication tag rules.
            meditationTag: { findMany: vi.fn().mockResolvedValue([]) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('fs/promises', () => ({
            rename: vi.fn(),
            copyFile: vi.fn(),
            unlink: vi.fn(),
            mkdir: vi.fn(),
        }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/meditations/med-1', {
            method: 'PATCH',
            body: { status: 'REJECTED', rejectionReason: 'Audio quality too low' },
        });
        const response = await PATCH(request, mockParams({ id: 'med-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { meditation: Record<string, unknown> };
        expect(data.meditation.status).toBe('REJECTED');
        expect(data.meditation.isPublished).toBe(false);

        // Verify rejection reason is passed to update
        expect(mockPrisma.meditation.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: 'REJECTED',
                    rejectionReason: 'Audio quality too low',
                    isPublished: false,
                }),
            }),
        );
    });

    it('returns 404 for nonexistent meditation', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: "db-admin-1", role: "ADMIN" }) },
            auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(null),
                update: vi.fn(),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('fs/promises', () => ({
            rename: vi.fn(),
            copyFile: vi.fn(),
            unlink: vi.fn(),
            mkdir: vi.fn(),
        }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/meditations/nonexistent', {
            method: 'PATCH',
            body: { status: 'APPROVED' },
        });
        const response = await PATCH(request, mockParams({ id: 'nonexistent' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Meditation not found' });
    });

    it('handles cross-filesystem rename fallback', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const updatedMeditation = {
            ...meditationRecord,
            status: 'APPROVED',
            isPublished: true,
            reviewedAt: new Date('2025-06-01'),
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: "db-admin-1", role: "ADMIN" }) },
            auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(meditationRecord),
                update: vi.fn().mockResolvedValue(updatedMeditation),
            },
            meditationTag: { findMany: vi.fn().mockResolvedValue(publishableTags) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        // rename fails (cross-device), copyFile + unlink succeed
        const mockRename = vi.fn().mockRejectedValue(new Error('EXDEV: cross-device link not permitted'));
        const mockCopyFile = vi.fn().mockResolvedValue(undefined);
        const mockUnlink = vi.fn().mockResolvedValue(undefined);
        const mockMkdir = vi.fn().mockResolvedValue(undefined);
        vi.doMock('fs/promises', () => ({
            rename: mockRename,
            copyFile: mockCopyFile,
            unlink: mockUnlink,
            mkdir: mockMkdir,
        }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/admin/meditations/med-1', {
            method: 'PATCH',
            body: { status: 'APPROVED' },
        });
        const response = await PATCH(request, mockParams({ id: 'med-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);

        // Verify rename was attempted first
        expect(mockRename).toHaveBeenCalled();

        // Verify fallback: copyFile then unlink
        expect(mockCopyFile).toHaveBeenCalledWith(
            expect.stringContaining('morning_calm.ogg'),
            expect.stringContaining('morning_calm.ogg'),
        );
        expect(mockUnlink).toHaveBeenCalledWith(
            expect.stringContaining('morning_calm.ogg'),
        );
    });
});

// BUSINESS_RULES.md §2.1: a meditation must carry a LANGUAGE tag at publication,
// plus at least one of MOOD, TECHNIQUE or DURATION.
describe('PATCH /api/admin/meditations/[id] - publication tag rules', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    const pendingMeditation = {
        id: 'med-1',
        title: 'Morning Calm',
        filePath: 'morning_calm.ogg',
        status: 'PENDING',
        isPublished: false,
        isFeatured: false,
        rejectionReason: null,
        reviewedAt: null,
    };

    function setupMocks(
        tagCategories: string[],
        meditation: Record<string, unknown> = pendingMeditation,
    ) {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: "db-admin-1", role: "ADMIN" }) },
            auditLog: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(meditation),
                update: vi.fn().mockResolvedValue({
                    ...meditation,
                    status: 'APPROVED',
                    isPublished: true,
                    reviewedAt: new Date('2025-06-01'),
                }),
            },
            meditationTag: {
                findMany: vi.fn().mockResolvedValue(
                    tagCategories.map((category) => ({ tag: { category } })),
                ),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const mockRename = vi.fn().mockResolvedValue(undefined);
        vi.doMock('fs/promises', () => ({
            rename: mockRename,
            copyFile: vi.fn(),
            unlink: vi.fn(),
            mkdir: vi.fn().mockResolvedValue(undefined),
        }));

        return { mockPrisma, mockRename };
    }

    async function approve() {
        const { PATCH } = await import('../route');
        return PATCH(
            createRequest('/api/admin/meditations/med-1', {
                method: 'PATCH',
                body: { status: 'APPROVED' },
            }),
            mockParams({ id: 'med-1' }),
        );
    }

    it('rejects approval when the LANGUAGE tag is missing', async () => {
        const { mockPrisma } = setupMocks(['MOOD']);

        const { status, body } = await parseResponse(await approve());

        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('LANGUAGE');
        expect(mockPrisma.meditation.update).not.toHaveBeenCalled();
    });

    it('rejects approval when no MOOD, TECHNIQUE or DURATION tag is present', async () => {
        const { mockPrisma } = setupMocks(['LANGUAGE']);

        const { status, body } = await parseResponse(await approve());

        expect(status).toBe(400);
        expect((body as { error: string }).error).toContain('MOOD, TECHNIQUE or DURATION');
        expect(mockPrisma.meditation.update).not.toHaveBeenCalled();
    });

    it('names both requirements when the meditation has no tags', async () => {
        setupMocks([]);

        const { status, body } = await parseResponse(await approve());

        expect(status).toBe(400);
        const error = (body as { error: string }).error;
        expect(error).toContain('a LANGUAGE tag');
        expect(error).toContain('at least one MOOD, TECHNIQUE or DURATION tag');
    });

    it('does not move the audio file when the tag check fails', async () => {
        const { mockRename } = setupMocks([]);

        await approve();

        expect(mockRename).not.toHaveBeenCalled();
    });

    it('approves with LANGUAGE + TECHNIQUE', async () => {
        const { mockPrisma } = setupMocks(['LANGUAGE', 'TECHNIQUE']);

        const { status } = await parseResponse(await approve());

        expect(status).toBe(200);
        expect(mockPrisma.meditation.update).toHaveBeenCalled();
    });

    it('approves with LANGUAGE + DURATION', async () => {
        const { mockPrisma } = setupMocks(['DURATION', 'LANGUAGE']);

        const { status } = await parseResponse(await approve());

        expect(status).toBe(200);
        expect(mockPrisma.meditation.update).toHaveBeenCalled();
    });

    it('refuses to publish a meditation that has been taken down', async () => {
        // CONTENT_POLICY.md §6.1: a Provider's withdrawal stays withdrawn. The
        // row is still in the PENDING queue, so the refusal is what keeps a
        // reviewer from approving it back into the catalogue.
        const { mockPrisma, mockRename } = setupMocks(['LANGUAGE', 'MOOD'], {
            ...pendingMeditation,
            isHidden: true,
        });

        const { status, body } = await parseResponse(await approve());

        expect(status).toBe(409);
        expect((body as { error: string }).error).toContain('taken down');
        expect(mockPrisma.meditation.update).not.toHaveBeenCalled();
        expect(mockRename).not.toHaveBeenCalled();
    });

    it('still lets an Admin unhide a taken-down meditation', async () => {
        // The refusal is scoped to the publishing write; the visibility-only
        // branch must stay reachable or nothing could ever be put back up.
        const { mockPrisma } = setupMocks(['LANGUAGE', 'MOOD'], {
            ...pendingMeditation,
            status: 'APPROVED',
            isPublished: true,
            isHidden: true,
        });

        const { PATCH } = await import('../route');
        const response = await PATCH(
            createRequest('/api/admin/meditations/med-1', { method: 'PATCH', body: { isHidden: false } }),
            mockParams({ id: 'med-1' }),
        );

        expect(response.status).toBe(200);
        expect(mockPrisma.meditation.update).toHaveBeenCalledWith({
            where: { id: 'med-1' },
            data: { isHidden: false },
        });
    });

    it('does not re-check tags on an already-published meditation', async () => {
        // The Featured toggle PATCHes status: 'APPROVED' too. Blocking that on a
        // publication rule would make an unrelated admin action fail.
        const { mockPrisma } = setupMocks([], {
            ...pendingMeditation,
            status: 'APPROVED',
            isPublished: true,
        });

        const { status } = await parseResponse(await approve());

        expect(status).toBe(200);
        expect(mockPrisma.meditationTag.findMany).not.toHaveBeenCalled();
    });
});

describe('PATCH /api/admin/meditations/[id] - audit trail', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    const meditationRecord = {
        id: 'med-1',
        title: 'Morning Calm',
        filePath: 'morning_calm.ogg',
        status: 'PENDING',
        isPublished: false,
        isFeatured: false,
        isHidden: false,
        rejectionReason: null,
        reviewedAt: null,
    };

    const publishableTags = [{ tag: { category: 'LANGUAGE' } }, { tag: { category: 'MOOD' } }];

    function setupMocks(
        existing: Record<string, unknown> = meditationRecord,
        options: { auditFails?: boolean; role?: string } = {},
    ) {
        const { auditFails = false, role = 'ADMIN' } = options;

        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-admin-1', role: 'LISTENER' }) },
            auditLog: {
                create: auditFails
                    ? vi.fn().mockRejectedValue(new Error('audit table unreachable'))
                    : vi.fn().mockResolvedValue({ id: 'audit-1' }),
            },
            meditation: {
                findUnique: vi.fn().mockResolvedValue(existing),
                update: vi.fn().mockImplementation(({ data }) =>
                    Promise.resolve({ ...existing, ...data })),
            },
            meditationTag: { findMany: vi.fn().mockResolvedValue(publishableTags) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('fs/promises', () => ({
            rename: vi.fn().mockResolvedValue(undefined),
            copyFile: vi.fn(),
            unlink: vi.fn(),
            mkdir: vi.fn().mockResolvedValue(undefined),
        }));

        return { mockPrisma };
    }

    async function patch(body: unknown) {
        const { PATCH } = await import('../route');
        return PATCH(
            createRequest('/api/admin/meditations/med-1', { method: 'PATCH', body }),
            mockParams({ id: 'med-1' }),
        );
    }

    /** Every audit entry written during one request, in order. */
    function auditActions(mockPrisma: ReturnType<typeof setupMocks>['mockPrisma']): string[] {
        return mockPrisma.auditLog.create.mock.calls.map(
            (call) => (call[0] as { data: { action: string } }).data.action,
        );
    }

    it('logs a rejection with the reason the Provider will be given', async () => {
        // TRUST_AND_SAFETY.md §8: "we do not remove content without giving the
        // Provider a reason citing a rule". The reason belongs in the audit entry
        // too, or the log cannot show which rule was cited.
        const { mockPrisma } = setupMocks();

        const response = await patch({ status: 'REJECTED', rejectionReason: 'Therapeutic claim in the description.' });

        expect(response.status).toBe(200);
        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
            data: {
                actorId: 'db-admin-1',
                actorRole: 'ADMIN',
                action: 'meditation.reject',
                targetType: 'MEDITATION',
                targetId: 'med-1',
                metadata: {
                    previousStatus: 'PENDING',
                    published: false,
                    rejectionReason: 'Therapeutic claim in the description.',
                },
            },
        });
    });

    it('logs a hide with the state it moved from', async () => {
        const { mockPrisma } = setupMocks();

        const response = await patch({ isHidden: true });

        expect(response.status).toBe(200);
        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
            data: {
                actorId: 'db-admin-1',
                actorRole: 'ADMIN',
                action: 'meditation.hide',
                targetType: 'MEDITATION',
                targetId: 'med-1',
                metadata: { previousIsHidden: false },
            },
        });
    });

    it('distinguishes an unhide from a hide', async () => {
        const { mockPrisma } = setupMocks({ ...meditationRecord, isHidden: true });

        await patch({ isHidden: false });

        expect(auditActions(mockPrisma)).toEqual(['meditation.unhide']);
        expect(mockPrisma.auditLog.create.mock.calls[0][0].data.metadata).toEqual({ previousIsHidden: true });
    });

    it('writes a separate entry per semantic change in a combined PATCH', async () => {
        // One request can hide and feature at once. Two actions, two entries, so
        // the log stays filterable by action.
        const { mockPrisma } = setupMocks();

        await patch({ isHidden: true, isFeatured: true });

        expect(auditActions(mockPrisma)).toEqual(['meditation.hide', 'meditation.feature']);
    });

    it('logs the feature toggle alongside an approval', async () => {
        const { mockPrisma } = setupMocks();

        await patch({ status: 'APPROVED', isFeatured: true });

        expect(auditActions(mockPrisma)).toEqual(['meditation.approve', 'meditation.feature']);
    });

    it('does not log a feature change that was not requested', async () => {
        const { mockPrisma } = setupMocks();

        await patch({ isHidden: true });

        expect(auditActions(mockPrisma)).toEqual(['meditation.hide']);
    });

    it('snapshots the acting role and does not substitute the actor\'s stored role', async () => {
        // The mocked user row says LISTENER; the session says ADMIN. The snapshot
        // must come from the session, or a later role change rewrites history.
        const { mockPrisma } = setupMocks();

        await patch({ isHidden: true });

        expect(mockPrisma.auditLog.create.mock.calls[0][0].data.actorRole).toBe('ADMIN');
    });

    it('still hides the meditation when the audit write fails', async () => {
        const { mockPrisma } = setupMocks(meditationRecord, { auditFails: true });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await patch({ isHidden: true });
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect((body as { meditation: { isHidden: boolean } }).meditation.isHidden).toBe(true);
        expect(mockPrisma.meditation.update).toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    });

    it('still approves the meditation when the audit write fails', async () => {
        const { mockPrisma } = setupMocks(meditationRecord, { auditFails: true });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const response = await patch({ status: 'APPROVED' });

        expect(response.status).toBe(200);
        expect(mockPrisma.meditation.update).toHaveBeenCalled();

        consoleError.mockRestore();
    });

    it('writes no audit entry when the request is refused', async () => {
        const { mockPrisma } = setupMocks();

        const response = await patch({ status: 'SOMETHING_ELSE' });

        expect(response.status).toBe(400);
        expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
    });
});
