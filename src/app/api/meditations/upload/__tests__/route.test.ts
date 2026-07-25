import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { parseResponse } from '@/__tests__/helpers';

describe('POST /api/meditations/upload', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    function setupMocks(duration: { seconds?: number; fails?: boolean } = {}) {
        // Stubbed so the suite neither shells out nor depends on ffmpeg being
        // installed. The probe itself is covered for real against generated
        // audio in src/lib/__tests__/audio-duration.test.ts.
        vi.doMock('@/lib/audio-duration', () => ({
            AudioDurationError: class extends Error {},
            getAudioDurationSeconds: duration.fails
                ? vi.fn().mockRejectedValue(new Error('ffprobe failed'))
                : vi.fn().mockResolvedValue(duration.seconds ?? 300),
        }));

        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const createdMeditation = {
            id: 'med-new-1',
            title: 'Uploaded Meditation',
            status: 'PENDING',
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            meditation: {
                create: vi.fn().mockResolvedValue(createdMeditation),
            },
        };

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('fs/promises', () => ({
            writeFile: vi.fn().mockResolvedValue(undefined),
            mkdir: vi.fn().mockResolvedValue(undefined),
        }));

        return { mockPrisma };
    }

    function makeFormDataRequest(formData: FormData): NextRequest {
        return new NextRequest(new URL('/api/meditations/upload', 'http://localhost:3000'), {
            method: 'POST',
            body: formData,
        });
    }

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));
        vi.doMock('@/lib/db', () => ({
            prisma: {
                user: { findUnique: vi.fn() },
                meditation: { create: vi.fn() },
            },
        }));
        vi.doMock('fs/promises', () => ({
            writeFile: vi.fn(),
            mkdir: vi.fn(),
        }));

        const { POST } = await import('../route');

        const file = new File(['audio data'], 'meditation.mp3', { type: 'audio/mpeg' });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', 'Test');

        const response = await POST(makeFormDataRequest(formData));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 400 when no file is provided', async () => {
        setupMocks();

        const { POST } = await import('../route');

        const formData = new FormData();
        formData.append('title', 'No File Meditation');

        const response = await POST(makeFormDataRequest(formData));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Audio file is required' });
    });

    it('returns 400 for invalid file type', async () => {
        setupMocks();

        const { POST } = await import('../route');

        const file = new File(['not audio'], 'document.pdf', { type: 'application/pdf' });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', 'Bad File');

        const response = await POST(makeFormDataRequest(formData));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Invalid audio file type' });
    });

    it('returns 400 when title is missing', async () => {
        setupMocks();

        const { POST } = await import('../route');

        const file = new File(['audio data'], 'meditation.mp3', { type: 'audio/mpeg' });
        const formData = new FormData();
        formData.append('file', file);

        const response = await POST(makeFormDataRequest(formData));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Title is required' });
    });

    it('creates meditation with PENDING status', async () => {
        const { mockPrisma } = setupMocks();

        const { POST } = await import('../route');

        const file = new File(['audio data'], 'ocean_waves.mp3', { type: 'audio/mpeg' });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', 'Ocean Waves');
        formData.append('description', 'Relaxing ocean sounds');
        formData.append('defaultMix', '0.7');

        const response = await POST(makeFormDataRequest(formData));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { meditation: { id: string; title: string; status: string } };
        expect(data.meditation.status).toBe('PENDING');

        expect(mockPrisma.meditation.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    title: 'Ocean Waves',
                    description: 'Relaxing ocean sounds',
                    defaultMix: 0.7,
                    status: 'PENDING',
                    isPublished: false,
                    providerId: 'db-uuid-1',
                }),
            }),
        );
    });

    it('defaults to 0.5 when defaultMix is omitted', async () => {
        const { mockPrisma } = setupMocks();

        const { POST } = await import('../route');

        const file = new File(['audio data'], 'silent.ogg', { type: 'audio/ogg' });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', 'Silent Meditation');

        const response = await POST(makeFormDataRequest(formData));
        const { status } = await parseResponse(response);

        expect(status).toBe(200);
        expect(mockPrisma.meditation.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    defaultMix: 0.5,
                }),
            }),
        );
    });

    it('associates tags from FormData', async () => {
        const { mockPrisma } = setupMocks();

        const { POST } = await import('../route');

        const file = new File(['audio data'], 'calm.ogg', { type: 'audio/ogg' });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', 'Calm Meditation');
        formData.append('tagIds', JSON.stringify(['tag-1', 'tag-2']));

        const response = await POST(makeFormDataRequest(formData));
        const { status } = await parseResponse(response);

        expect(status).toBe(200);
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

    it('generates a safe filename from the title', async () => {
        const { mockPrisma } = setupMocks();

        const { POST } = await import('../route');

        const file = new File(['audio data'], 'original.ogg', { type: 'audio/ogg' });
        const formData = new FormData();
        formData.append('file', file);
        formData.append('title', '  My Special!!! Meditation @#$ ');

        const response = await POST(makeFormDataRequest(formData));
        const { status } = await parseResponse(response);

        expect(status).toBe(200);

        // The filePath stored should be a safe filename: lowercase, underscores, no special chars
        const createCall = mockPrisma.meditation.create.mock.calls[0][0];
        const filePath = createCall.data.filePath as string;
        expect(filePath).toMatch(/^my_special_meditation_\d+\.ogg$/);

        // streamName should also be safe
        const streamName = createCall.data.streamName as string;
        expect(streamName).toMatch(/^meditation-my_special_meditation_\d+$/);
    });

    it('stores the probed duration', async () => {
        // Every upload used to store 0, which made the `completed` rule in
        // BUSINESS_RULES 2.3 unenforceable — it is a fraction of this value.
        const { mockPrisma } = setupMocks({ seconds: 754 });
        const { POST } = await import('../route');

        const formData = new FormData();
        formData.append('file', new File(['audio data'], 'x.ogg', { type: 'audio/ogg' }));
        formData.append('title', 'Probed');

        const { status } = await parseResponse(await POST(makeFormDataRequest(formData)));

        expect(status).toBe(200);
        expect(mockPrisma.meditation.create.mock.calls[0][0].data.durationSeconds).toBe(754);
    });

    it('still accepts the upload when the probe fails, recording duration 0', async () => {
        // A file that plays fine can still confuse ffprobe. Losing a provider's
        // submission over that would be worse than an unknown duration, and 0
        // keeps its old meaning of "not measured" for a later backfill.
        const { mockPrisma } = setupMocks({ fails: true });
        const { POST } = await import('../route');

        const formData = new FormData();
        formData.append('file', new File(['audio data'], 'y.ogg', { type: 'audio/ogg' }));
        formData.append('title', 'Unprobeable');

        const { status } = await parseResponse(await POST(makeFormDataRequest(formData)));

        expect(status).toBe(200);
        expect(mockPrisma.meditation.create.mock.calls[0][0].data.durationSeconds).toBe(0);
    });
});
