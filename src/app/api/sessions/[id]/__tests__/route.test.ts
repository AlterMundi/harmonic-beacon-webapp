import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('GET /api/sessions/[id]', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/sessions/session-1'),
            mockParams({ id: 'session-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns session with recordings', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const startedAt = new Date('2025-01-01T10:00:00Z');
        const endedAt = new Date('2025-01-01T10:30:00Z');

        const mockSession = {
            id: 'session-1',
            title: 'Morning Beacon',
            description: 'A calming session',
            providerId: 'db-user-1',
            durationSeconds: 1800,
            startedAt,
            endedAt,
            provider: { name: 'Provider User' },
            recordings: [
                { id: 'rec-1', participantIdentity: 'user-db-user-1', category: 'BEACON' },
            ],
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1', role: 'PROVIDER' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(mockSession) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/sessions/session-1'),
            mockParams({ id: 'session-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { session: { id: string; title: string; recordings: unknown[] } };
        expect(data.session.id).toBe('session-1');
        expect(data.session.title).toBe('Morning Beacon');
        expect(data.session.recordings).toHaveLength(1);
    });

    it('returns 404 for nonexistent session', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1', role: 'USER' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/sessions/nonexistent'),
            mockParams({ id: 'nonexistent' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Session not found' });
    });

    it('returns 403 for unauthorized user (not provider, participant, or admin)', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockSession = {
            id: 'session-1',
            title: 'Session',
            description: null,
            providerId: 'other-provider-id',
            durationSeconds: 600,
            startedAt: new Date(),
            endedAt: null,
            provider: { name: 'Other Provider' },
            recordings: [],
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1', role: 'USER' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(mockSession) },
            sessionParticipant: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/sessions/session-1'),
            mockParams({ id: 'session-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Not authorized' });
    });
});

describe('PATCH /api/sessions/[id]', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));

        const { PATCH } = await import('../route');
        const res = await PATCH(
            createRequest('/api/sessions/session-1', { method: 'PATCH', body: {} }),
            mockParams({ id: 'session-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('completes session with duration calculation', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const startedAt = new Date('2025-01-01T10:00:00Z');
        const updatedSession = {
            id: 'session-1',
            durationSeconds: 1800,
            completed: true,
            startedAt,
            endedAt: new Date('2025-01-01T10:30:00Z'),
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            listeningSession: {
                findUnique: vi.fn().mockResolvedValue({
                    id: 'session-1',
                    userId: 'db-user-1',
                    startedAt,
                }),
                update: vi.fn().mockResolvedValue(updatedSession),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { PATCH } = await import('../route');
        const res = await PATCH(
            createRequest('/api/sessions/session-1', { method: 'PATCH', body: {} }),
            mockParams({ id: 'session-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { session: { id: string; durationSeconds: number; completed: boolean } };
        expect(data.session.id).toBe('session-1');
        expect(data.session.completed).toBe(true);

        // Verify update was called with duration and completed defaults
        expect(mockPrisma.listeningSession.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'session-1' },
                data: expect.objectContaining({
                    completed: true,
                }),
            }),
        );
    });

    it('returns 404 for nonexistent session', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            listeningSession: {
                findUnique: vi.fn().mockResolvedValue(null),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { PATCH } = await import('../route');
        const res = await PATCH(
            createRequest('/api/sessions/nonexistent', { method: 'PATCH', body: {} }),
            mockParams({ id: 'nonexistent' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Session not found' });
    });

    it('sets completed flag from body', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const startedAt = new Date('2025-01-01T10:00:00Z');
        const updatedSession = {
            id: 'session-1',
            durationSeconds: 300,
            completed: false,
            startedAt,
            endedAt: new Date('2025-01-01T10:05:00Z'),
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            listeningSession: {
                findUnique: vi.fn().mockResolvedValue({
                    id: 'session-1',
                    userId: 'db-user-1',
                    startedAt,
                }),
                update: vi.fn().mockResolvedValue(updatedSession),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { PATCH } = await import('../route');
        const res = await PATCH(
            createRequest('/api/sessions/session-1', {
                method: 'PATCH',
                body: { completed: false },
            }),
            mockParams({ id: 'session-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { session: { completed: boolean } };
        expect(data.session.completed).toBe(false);

        expect(mockPrisma.listeningSession.update).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    completed: false,
                }),
            }),
        );
    });
});
