import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('GET /api/meditations/[id]/audio', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    const publishedMeditation = {
        filePath: 'morning_calm.ogg',
        isPublished: true,
        status: 'APPROVED',
        isHidden: false,
    };

    function setupMocks(existing: Record<string, unknown> | null = publishedMeditation) {
        const mockPrisma = {
            meditation: { findUnique: vi.fn().mockResolvedValue(existing) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const mockStreamFile = vi.fn().mockReturnValue(
            new Response('fake-audio-data', { status: 200, headers: { 'Content-Type': 'audio/ogg' } }),
        );
        vi.doMock('@/lib/stream-file', () => ({ streamFile: mockStreamFile }));

        return { mockPrisma, mockStreamFile };
    }

    async function get(id = 'med-1') {
        const { GET } = await import('../route');
        return GET(createRequest(`/api/meditations/${id}/audio`), mockParams({ id }));
    }

    it('streams a published meditation', async () => {
        const { mockStreamFile } = setupMocks();

        const response = await get();

        expect(response.status).toBe(200);
        expect(mockStreamFile).toHaveBeenCalled();
    });

    it('refuses a hidden meditation', async () => {
        // A takedown that leaves the file streamable to anyone holding the id has
        // taken nothing down. CONTENT_POLICY.md §6.1 / BUSINESS_RULES.md §2.1.
        const { mockStreamFile } = setupMocks({ ...publishedMeditation, isHidden: true });

        const { status, body } = await parseResponse(await get());

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Not found' });
        expect(mockStreamFile).not.toHaveBeenCalled();
    });

    it('refuses an unpublished meditation', async () => {
        setupMocks({ ...publishedMeditation, isPublished: false, status: 'PENDING' });

        const { status } = await parseResponse(await get());

        expect(status).toBe(404);
    });

    it('returns 404 when the meditation does not exist', async () => {
        setupMocks(null);

        const { status } = await parseResponse(await get('nonexistent'));

        expect(status).toBe(404);
    });

    it('returns 404 when the file is missing from disk', async () => {
        const { mockStreamFile } = setupMocks();
        mockStreamFile.mockReturnValue(null);

        const { status, body } = await parseResponse(await get());

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'File not found' });
    });
});
