import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('GET /api/admin/meditations/[id]/audio', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            meditation: { findUnique: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('fs/promises', () => ({
            readFile: vi.fn(),
            access: vi.fn(),
        }));

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/meditations/med-1/audio');
        const response = await GET(request, mockParams({ id: 'med-1' }));
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
            meditation: { findUnique: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('fs/promises', () => ({
            readFile: vi.fn(),
            access: vi.fn(),
        }));

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/meditations/med-1/audio');
        const response = await GET(request, mockParams({ id: 'med-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Insufficient permissions' });
    });

    it('resolves path from MEDITATIONS_PATH for APPROVED', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockMeditation = {
            id: 'med-1',
            filePath: 'morning_calm.ogg',
            status: 'APPROVED',
        };

        const mockPrisma = {
            meditation: { findUnique: vi.fn().mockResolvedValue(mockMeditation) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const audioBuffer = Buffer.from('fake-audio-data');
        const mockAccess = vi.fn().mockResolvedValue(undefined);
        const mockReadFile = vi.fn().mockResolvedValue(audioBuffer);
        vi.doMock('fs/promises', () => ({
            access: mockAccess,
            readFile: mockReadFile,
        }));

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/meditations/med-1/audio');
        const response = await GET(request, mockParams({ id: 'med-1' }));

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('audio/ogg');

        // For APPROVED meditations, the file is read from MEDITATIONS_PATH (public/audio/meditations)
        // The path passed to access/readFile should contain the meditations directory, not uploads
        expect(mockAccess).toHaveBeenCalledWith(
            expect.stringContaining('meditations'),
        );
        expect(mockReadFile).toHaveBeenCalledWith(
            expect.stringContaining('meditations'),
        );
    });

    it('resolves path from UPLOADS_PATH for PENDING', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockMeditation = {
            id: 'med-2',
            filePath: 'pending_track.ogg',
            status: 'PENDING',
        };

        const mockPrisma = {
            meditation: { findUnique: vi.fn().mockResolvedValue(mockMeditation) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const audioBuffer = Buffer.from('fake-pending-audio');
        const mockAccess = vi.fn().mockResolvedValue(undefined);
        const mockReadFile = vi.fn().mockResolvedValue(audioBuffer);
        vi.doMock('fs/promises', () => ({
            access: mockAccess,
            readFile: mockReadFile,
        }));

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/meditations/med-2/audio');
        const response = await GET(request, mockParams({ id: 'med-2' }));

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('audio/ogg');

        // For PENDING meditations, the file is read from UPLOADS_PATH
        expect(mockAccess).toHaveBeenCalledWith(
            expect.stringContaining('uploads'),
        );
        expect(mockReadFile).toHaveBeenCalledWith(
            expect.stringContaining('uploads'),
        );
    });

    it('returns 404 when file not found', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockMeditation = {
            id: 'med-3',
            filePath: 'missing_file.ogg',
            status: 'PENDING',
        };

        const mockPrisma = {
            meditation: { findUnique: vi.fn().mockResolvedValue(mockMeditation) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        vi.doMock('fs/promises', () => ({
            access: vi.fn().mockRejectedValue(new Error('ENOENT: no such file or directory')),
            readFile: vi.fn(),
        }));

        const { GET } = await import('../route');
        const request = createRequest('/api/admin/meditations/med-3/audio');
        const response = await GET(request, mockParams({ id: 'med-3' }));

        expect(response.status).toBe(404);
    });
});
