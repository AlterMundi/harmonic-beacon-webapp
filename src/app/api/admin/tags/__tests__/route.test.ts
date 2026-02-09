import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

describe('POST /api/admin/tags', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            tag: { create: vi.fn(), delete: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { POST } = await import('../route');
        const request = createRequest('/api/admin/tags', {
            method: 'POST',
            body: { name: 'Calm', category: 'mood' },
        });
        const response = await POST(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('creates tag with auto-generated slug', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const createdTag = {
            id: 'tag-1',
            name: 'Deep Sleep',
            slug: 'deep-sleep',
            category: 'mood',
        };

        const mockPrisma = {
            tag: { create: vi.fn().mockResolvedValue(createdTag) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { POST } = await import('../route');
        const request = createRequest('/api/admin/tags', {
            method: 'POST',
            body: { name: 'Deep Sleep', category: 'mood' },
        });
        const response = await POST(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { tag: Record<string, unknown> };
        expect(data.tag.name).toBe('Deep Sleep');
        expect(data.tag.slug).toBe('deep-sleep');

        // Verify prisma.create was called with the auto-generated slug
        expect(mockPrisma.tag.create).toHaveBeenCalledWith({
            data: {
                name: 'Deep Sleep',
                slug: 'deep-sleep',
                category: 'mood',
            },
        });
    });

    it('validates that name and category are required', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            tag: { create: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { POST } = await import('../route');

        // Missing category
        const request = createRequest('/api/admin/tags', {
            method: 'POST',
            body: { name: 'Calm' },
        });
        const response = await POST(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Name and category are required' });
        expect(mockPrisma.tag.create).not.toHaveBeenCalled();
    });
});

describe('DELETE /api/admin/tags', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('deletes tag by id query param', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            tag: { delete: vi.fn().mockResolvedValue({ id: 'tag-1' }) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { DELETE } = await import('../route');
        const request = createRequest('/api/admin/tags', {
            method: 'DELETE',
            searchParams: { id: 'tag-1' },
        });
        const response = await DELETE(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(body).toEqual({ success: true });

        expect(mockPrisma.tag.delete).toHaveBeenCalledWith({
            where: { id: 'tag-1' },
        });
    });

    it('returns 400 when id is missing', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            tag: { delete: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { DELETE } = await import('../route');
        const request = createRequest('/api/admin/tags', {
            method: 'DELETE',
        });
        const response = await DELETE(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Tag ID is required' });
        expect(mockPrisma.tag.delete).not.toHaveBeenCalled();
    });
});
