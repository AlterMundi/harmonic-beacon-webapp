import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('POST /api/provider/sessions/[id]/cuts', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    function setupMocks(overrides: {
        session?: Record<string, unknown> | null;
        recordings?: Array<Record<string, unknown>>;
        renderError?: boolean;
    } = {}) {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const createdMeditation = {
            id: 'med-new-1',
            title: 'Cut Title',
            status: 'PENDING',
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            scheduledSession: {
                findUnique: vi.fn().mockResolvedValue(
                    overrides.session !== undefined
                        ? overrides.session
                        : { id: 'sess-1', providerId: 'db-uuid-1', status: 'ENDED' },
                ),
            },
            sessionRecording: {
                findMany: vi.fn().mockResolvedValue(
                    overrides.recordings ?? [
                        { filePath: '/data/recordings/session-provider-123.ogg', category: 'SESSION' },
                        { filePath: '/data/recordings/beacon-beacon01.ogg', category: 'BEACON' },
                    ],
                ),
            },
            meditation: {
                create: vi.fn().mockResolvedValue(createdMeditation),
            },
        };

        const mockRenderMixdown = overrides.renderError
            ? vi.fn().mockRejectedValue(new Error('ffmpeg failed'))
            : vi.fn().mockResolvedValue(undefined);

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/ffmpeg-mix', () => ({
            renderMixdown: mockRenderMixdown,
        }));
        vi.doMock('fs/promises', () => ({
            mkdir: vi.fn().mockResolvedValue(undefined),
            unlink: vi.fn().mockResolvedValue(undefined),
        }));

        return { mockPrisma, mockRenderMixdown };
    }

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));
        vi.doMock('@/lib/db', () => ({
            prisma: {
                user: { findUnique: vi.fn() },
                scheduledSession: { findUnique: vi.fn() },
                sessionRecording: { findMany: vi.fn() },
                meditation: { create: vi.fn() },
            },
        }));
        vi.doMock('@/lib/ffmpeg-mix', () => ({
            renderMixdown: vi.fn(),
        }));
        vi.doMock('fs/promises', () => ({
            mkdir: vi.fn().mockResolvedValue(undefined),
            unlink: vi.fn().mockResolvedValue(undefined),
        }));

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/cuts', {
            method: 'POST',
            body: { title: 'Test', inSeconds: 0, outSeconds: 60, mix: 0.5 },
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 404 for nonexistent session', async () => {
        setupMocks({ session: null });

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/nonexistent/cuts', {
            method: 'POST',
            body: { title: 'Test', inSeconds: 0, outSeconds: 60, mix: 0.5 },
        });
        const response = await POST(request, mockParams({ id: 'nonexistent' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Session not found' });
    });

    it('returns 403 when provider does not own the session', async () => {
        setupMocks({
            session: { id: 'sess-1', providerId: 'other-uuid', status: 'ENDED' },
        });

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/cuts', {
            method: 'POST',
            body: { title: 'Test', inSeconds: 0, outSeconds: 60, mix: 0.5 },
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Not authorized' });
    });

    it('validates inSeconds < outSeconds', async () => {
        setupMocks();

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/cuts', {
            method: 'POST',
            body: { title: 'Test', inSeconds: 60, outSeconds: 30, mix: 0.5 },
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Invalid in/out range' });
    });

    it('validates mix is between 0 and 1', async () => {
        setupMocks();

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/cuts', {
            method: 'POST',
            body: { title: 'Test', inSeconds: 0, outSeconds: 60, mix: 1.5 },
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Mix must be between 0 and 1' });
    });

    it('validates title is required', async () => {
        setupMocks();

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/cuts', {
            method: 'POST',
            body: { inSeconds: 0, outSeconds: 60, mix: 0.5 },
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Title is required' });
    });

    it('calls renderMixdown with correct arguments', async () => {
        const { mockRenderMixdown } = setupMocks();

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/cuts', {
            method: 'POST',
            body: { title: 'Healing Cut', inSeconds: 10, outSeconds: 120, mix: 0.7, description: 'A healing cut' },
        });
        await POST(request, mockParams({ id: 'sess-1' }));

        expect(mockRenderMixdown).toHaveBeenCalledWith(
            expect.objectContaining({
                tracks: [
                    { filePath: '/data/recordings/session-provider-123.ogg', category: 'SESSION' },
                    { filePath: '/data/recordings/beacon-beacon01.ogg', category: 'BEACON' },
                ],
                inSeconds: 10,
                outSeconds: 120,
                mix: 0.7,
                outputPath: expect.stringContaining('healing_cut_'),
            }),
        );
    });

    it('creates meditation with PENDING status', async () => {
        const { mockPrisma } = setupMocks();

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/cuts', {
            method: 'POST',
            body: { title: 'Healing Cut', inSeconds: 10, outSeconds: 120, mix: 0.7 },
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { meditation: { id: string; title: string; status: string } };
        expect(data.meditation.status).toBe('PENDING');

        expect(mockPrisma.meditation.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    title: 'Healing Cut',
                    status: 'PENDING',
                    isPublished: false,
                    providerId: 'db-uuid-1',
                    durationSeconds: 110, // floor(120 - 10)
                    defaultMix: 0.7, // matches mix from request body
                }),
            }),
        );
    });

    it('associates tags when tagIds are provided', async () => {
        const { mockPrisma } = setupMocks();

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/cuts', {
            method: 'POST',
            body: { title: 'Tagged Cut', inSeconds: 0, outSeconds: 60, mix: 0.5, tagIds: ['tag-1', 'tag-2'] },
        });
        await POST(request, mockParams({ id: 'sess-1' }));

        expect(mockPrisma.meditation.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    tags: {
                        create: [{ tagId: 'tag-1' }, { tagId: 'tag-2' }],
                    },
                }),
            }),
        );
    });

    it('returns the created meditation', async () => {
        setupMocks();

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1/cuts', {
            method: 'POST',
            body: { title: 'Healing Cut', inSeconds: 10, outSeconds: 120, mix: 0.7 },
        });
        const response = await POST(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { meditation: { id: string; title: string; status: string } };
        expect(data.meditation.id).toBe('med-new-1');
        expect(data.meditation.title).toBe('Cut Title');
        expect(data.meditation.status).toBe('PENDING');
    });
});
