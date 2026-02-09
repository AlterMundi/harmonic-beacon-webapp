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

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
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
            meditation: {
                findUnique: vi.fn().mockResolvedValue(meditationRecord),
                update: vi.fn().mockResolvedValue(updatedMeditation),
            },
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
            meditation: {
                findUnique: vi.fn().mockResolvedValue(meditationRecord),
                update: vi.fn().mockResolvedValue(updatedMeditation),
            },
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
            meditation: {
                findUnique: vi.fn().mockResolvedValue(meditationRecord),
                update: vi.fn().mockResolvedValue(updatedMeditation),
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
            meditation: {
                findUnique: vi.fn().mockResolvedValue(meditationRecord),
                update: vi.fn().mockResolvedValue(updatedMeditation),
            },
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
