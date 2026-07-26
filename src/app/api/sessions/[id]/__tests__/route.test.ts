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
                    type: 'LIVE',
                    startedAt,
                    meditation: null,
                    scheduledSession: null,
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

});

// BUSINESS_RULES.md §2.3. The client used to assert `completed`; the server now
// derives it. Each case fixes the elapsed listen time by backdating startedAt,
// since the route computes the duration itself from startedAt to now.
describe('PATCH /api/sessions/[id] - server-computed completed', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    interface ListenOptions {
        type: 'LIVE' | 'MEDITATION' | 'SCHEDULED_SESSION';
        elapsedSeconds: number;
        meditationDurationSeconds?: number | null;
        scheduledSessionStatus?: string | null;
    }

    function setupMocks(options: ListenOptions) {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const startedAt = new Date(Date.now() - options.elapsedSeconds * 1000);

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            listeningSession: {
                findUnique: vi.fn().mockResolvedValue({
                    id: 'session-1',
                    userId: 'db-user-1',
                    type: options.type,
                    startedAt,
                    meditation:
                        options.meditationDurationSeconds === undefined ||
                        options.meditationDurationSeconds === null
                            ? null
                            : { durationSeconds: options.meditationDurationSeconds },
                    scheduledSession: options.scheduledSessionStatus
                        ? { status: options.scheduledSessionStatus }
                        : null,
                }),
                // Echoes back what the route asked for, so the response reflects
                // the computed value rather than a fixture.
                update: vi.fn().mockImplementation(({ data }) =>
                    Promise.resolve({
                        id: 'session-1',
                        durationSeconds: data.durationSeconds,
                        completed: data.completed,
                        startedAt,
                        endedAt: data.endedAt,
                    }),
                ),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        return { mockPrisma };
    }

    async function patch(body: unknown = {}) {
        const { PATCH } = await import('../route');
        return PATCH(
            createRequest('/api/sessions/session-1', { method: 'PATCH', body }),
            mockParams({ id: 'session-1' }),
        );
    }

    it('ignores a client-supplied completed: true on a short listen', async () => {
        const { mockPrisma } = setupMocks({ type: 'MEDITATION', elapsedSeconds: 10, meditationDurationSeconds: 600 });

        const { status, body } = await parseResponse(await patch({ completed: true }));

        expect(status).toBe(200);
        expect((body as { session: { completed: boolean } }).session.completed).toBe(false);
        expect(mockPrisma.listeningSession.update).toHaveBeenCalledWith(
            expect.objectContaining({ data: expect.objectContaining({ completed: false }) }),
        );
    });

    it('ignores a client-supplied completed: false on a full listen', async () => {
        setupMocks({ type: 'MEDITATION', elapsedSeconds: 590, meditationDurationSeconds: 600 });

        const { status, body } = await parseResponse(await patch({ completed: false }));

        expect(status).toBe(200);
        expect((body as { session: { completed: boolean } }).session.completed).toBe(true);
    });

    it('completes a MEDITATION at 85% of the track', async () => {
        setupMocks({ type: 'MEDITATION', elapsedSeconds: 510, meditationDurationSeconds: 600 });

        const { body } = await parseResponse(await patch());

        expect((body as { session: { completed: boolean } }).session.completed).toBe(true);
    });

    it('does not complete a MEDITATION below 85% of the track', async () => {
        setupMocks({ type: 'MEDITATION', elapsedSeconds: 480, meditationDurationSeconds: 600 });

        const { body } = await parseResponse(await patch());

        expect((body as { session: { completed: boolean } }).session.completed).toBe(false);
    });

    it('falls back to the 60s floor for a 0-duration (pre-backfill) meditation', async () => {
        setupMocks({ type: 'MEDITATION', elapsedSeconds: 300, meditationDurationSeconds: 0 });

        const { body } = await parseResponse(await patch());

        expect((body as { session: { completed: boolean } }).session.completed).toBe(true);
    });

    it('does not complete a sub-60s listen of a 0-duration meditation', async () => {
        setupMocks({ type: 'MEDITATION', elapsedSeconds: 30, meditationDurationSeconds: 0 });

        const { body } = await parseResponse(await patch());

        expect((body as { session: { completed: boolean } }).session.completed).toBe(false);
    });

    it('completes a SCHEDULED_SESSION listen when the event ended', async () => {
        setupMocks({ type: 'SCHEDULED_SESSION', elapsedSeconds: 30, scheduledSessionStatus: 'ENDED' });

        const { body } = await parseResponse(await patch());

        expect((body as { session: { completed: boolean } }).session.completed).toBe(true);
    });

    it('does not complete a SCHEDULED_SESSION listen while the event is still live', async () => {
        setupMocks({ type: 'SCHEDULED_SESSION', elapsedSeconds: 3600, scheduledSessionStatus: 'LIVE' });

        const { body } = await parseResponse(await patch());

        expect((body as { session: { completed: boolean } }).session.completed).toBe(false);
    });

    it('completes a LIVE listen of at least 60 seconds', async () => {
        setupMocks({ type: 'LIVE', elapsedSeconds: 90 });

        const { body } = await parseResponse(await patch());

        expect((body as { session: { completed: boolean } }).session.completed).toBe(true);
    });

    it('does not complete a LIVE listen under 60 seconds', async () => {
        setupMocks({ type: 'LIVE', elapsedSeconds: 20 });

        const { body } = await parseResponse(await patch());

        expect((body as { session: { completed: boolean } }).session.completed).toBe(false);
    });

    it('accepts a request with no JSON body at all', async () => {
        setupMocks({ type: 'LIVE', elapsedSeconds: 90 });

        const { PATCH } = await import('../route');
        const res = await PATCH(
            createRequest('/api/sessions/session-1', { method: 'PATCH' }),
            mockParams({ id: 'session-1' }),
        );
        const { status } = await parseResponse(res);

        expect(status).toBe(200);
    });
});
