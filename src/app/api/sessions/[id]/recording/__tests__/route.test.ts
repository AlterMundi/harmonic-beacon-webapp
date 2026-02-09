import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('GET /api/sessions/[id]/recording', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));
        vi.doMock('@/lib/stream-file', () => ({ streamFile: vi.fn() }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/sessions/session-1/recording', {
                searchParams: { recordingId: 'rec-1' },
            }),
            mockParams({ id: 'session-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 400 when recordingId is missing', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1', role: 'USER' }) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('@/lib/stream-file', () => ({ streamFile: vi.fn() }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/sessions/session-1/recording'),
            mockParams({ id: 'session-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'recordingId required' });
    });

    it('returns 404 when recording not found', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1', role: 'USER' }) },
            sessionRecording: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('@/lib/stream-file', () => ({ streamFile: vi.fn() }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/sessions/session-1/recording', {
                searchParams: { recordingId: 'rec-nonexistent' },
            }),
            mockParams({ id: 'session-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Recording not found' });
    });

    it('returns 403 when not authorized (not provider, participant, or admin)', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockRecording = {
            id: 'rec-1',
            sessionId: 'session-1',
            filePath: '/recordings/rec-1.ogg',
            session: { id: 'session-1', providerId: 'other-provider-id' },
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1', role: 'USER' }) },
            sessionRecording: { findUnique: vi.fn().mockResolvedValue(mockRecording) },
            sessionParticipant: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('@/lib/stream-file', () => ({ streamFile: vi.fn() }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/sessions/session-1/recording', {
                searchParams: { recordingId: 'rec-1' },
            }),
            mockParams({ id: 'session-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Not authorized' });
    });

    it('streams file successfully for authorized provider', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockRecording = {
            id: 'rec-1',
            sessionId: 'session-1',
            filePath: '/recordings/rec-1.ogg',
            session: { id: 'session-1', providerId: 'db-user-1' },
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1', role: 'PROVIDER' }) },
            sessionRecording: { findUnique: vi.fn().mockResolvedValue(mockRecording) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const mockStreamResponse = new Response('audio-data', {
            status: 200,
            headers: { 'Content-Type': 'audio/ogg' },
        });
        vi.doMock('@/lib/stream-file', () => ({
            streamFile: vi.fn().mockReturnValue(mockStreamResponse),
        }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/sessions/session-1/recording', {
                searchParams: { recordingId: 'rec-1' },
            }),
            mockParams({ id: 'session-1' }),
        );

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type')).toBe('audio/ogg');
    });

    it('returns 404 when file not found on disk', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockRecording = {
            id: 'rec-1',
            sessionId: 'session-1',
            filePath: '/recordings/missing.ogg',
            session: { id: 'session-1', providerId: 'db-user-1' },
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1', role: 'PROVIDER' }) },
            sessionRecording: { findUnique: vi.fn().mockResolvedValue(mockRecording) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        // streamFile returns null when file doesn't exist on disk
        vi.doMock('@/lib/stream-file', () => ({
            streamFile: vi.fn().mockReturnValue(null),
        }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/sessions/session-1/recording', {
                searchParams: { recordingId: 'rec-1' },
            }),
            mockParams({ id: 'session-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Recording file not found' });
    });
});
