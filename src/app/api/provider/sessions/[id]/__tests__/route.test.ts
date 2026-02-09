import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('GET /api/provider/sessions/[id]', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn() },
            scheduledSession: { findUnique: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({
            getEgressClient: vi.fn(),
        }));
        vi.doMock('fs', () => ({
            existsSync: vi.fn().mockReturnValue(false),
        }));

        const { GET } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1');
        const response = await GET(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns session with invites, participants, and recordings', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockSession = {
            id: 'sess-1',
            title: 'Healing Circle',
            providerId: 'db-uuid-1',
            status: 'LIVE',
            roomName: 'session-abc12345',
            invites: [{ id: 'inv-1', code: 'ABC123', createdAt: new Date() }],
            participants: [
                {
                    user: { id: 'user-1', name: 'Alice', email: 'alice@example.com' },
                    joinedAt: new Date(),
                },
            ],
            recordings: [
                {
                    id: 'rec-1',
                    participantIdentity: 'provider-123',
                    category: 'SESSION',
                    active: true,
                    egressId: 'egress-1',
                },
            ],
            _count: { participants: 1 },
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(mockSession) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({
            getEgressClient: vi.fn(),
        }));
        vi.doMock('fs', () => ({
            existsSync: vi.fn().mockReturnValue(false),
        }));

        const { GET } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1');
        const response = await GET(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { session: { id: string; invites: unknown[]; participants: unknown[]; recordings: unknown[] } };
        expect(data.session.id).toBe('sess-1');
        expect(data.session.invites).toHaveLength(1);
        expect(data.session.participants).toHaveLength(1);
        expect(data.session.recordings).toHaveLength(1);
    });

    it('returns 404 when session not found', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({
            getEgressClient: vi.fn(),
        }));
        vi.doMock('fs', () => ({
            existsSync: vi.fn().mockReturnValue(false),
        }));

        const { GET } = await import('../route');
        const request = createRequest('/api/provider/sessions/nonexistent');
        const response = await GET(request, mockParams({ id: 'nonexistent' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Session not found' });
    });

    it('returns 403 when provider does not own the session', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockSession = {
            id: 'sess-1',
            providerId: 'other-provider-uuid',
            invites: [],
            participants: [],
            recordings: [],
            _count: { participants: 0 },
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'my-db-uuid' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(mockSession) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({
            getEgressClient: vi.fn(),
        }));
        vi.doMock('fs', () => ({
            existsSync: vi.fn().mockReturnValue(false),
        }));

        const { GET } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1');
        const response = await GET(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Not authorized' });
    });
});

describe('PATCH /api/provider/sessions/[id]', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    function setupMocks(sessionData: Record<string, unknown> | null = null) {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockStopEgress = vi.fn().mockResolvedValue({});
        const mockEgressClient = { stopEgress: mockStopEgress };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            scheduledSession: {
                findUnique: vi.fn().mockResolvedValue(sessionData),
                update: vi.fn().mockImplementation(({ data }) =>
                    Promise.resolve({ ...sessionData, ...data }),
                ),
            },
            sessionRecording: {
                findMany: vi.fn().mockResolvedValue([]),
                update: vi.fn().mockResolvedValue({}),
                delete: vi.fn().mockResolvedValue({}),
            },
        };

        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({
            getEgressClient: vi.fn().mockReturnValue(mockEgressClient),
        }));
        vi.doMock('fs', () => ({
            existsSync: vi.fn().mockReturnValue(true),
        }));

        return { mockPrisma, mockEgressClient };
    }

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));
        vi.doMock('@/lib/db', () => ({
            prisma: {
                user: { findUnique: vi.fn() },
                scheduledSession: { findUnique: vi.fn(), update: vi.fn() },
                sessionRecording: { findMany: vi.fn() },
            },
        }));
        vi.doMock('@/lib/livekit-server', () => ({
            getEgressClient: vi.fn(),
        }));
        vi.doMock('fs', () => ({
            existsSync: vi.fn(),
        }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1', {
            method: 'PATCH',
            body: { action: 'start' },
        });
        const response = await PATCH(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('start: transitions SCHEDULED to LIVE', async () => {
        const { mockPrisma } = setupMocks({
            id: 'sess-1',
            providerId: 'db-uuid-1',
            status: 'SCHEDULED',
            roomName: 'session-abc12345',
        });

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1', {
            method: 'PATCH',
            body: { action: 'start' },
        });
        const response = await PATCH(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { session: { status: string } };
        expect(data.session.status).toBe('LIVE');
        expect(mockPrisma.scheduledSession.update).toHaveBeenCalledWith({
            where: { id: 'sess-1' },
            data: { status: 'LIVE', startedAt: expect.any(Date) },
        });
    });

    it('start: returns 400 when session is not SCHEDULED', async () => {
        setupMocks({
            id: 'sess-1',
            providerId: 'db-uuid-1',
            status: 'LIVE',
        });

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1', {
            method: 'PATCH',
            body: { action: 'start' },
        });
        const response = await PATCH(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Can only start a SCHEDULED session' });
    });

    it('end: transitions LIVE to ENDED with duration', async () => {
        const startedAt = new Date(Date.now() - 3600 * 1000); // 1 hour ago
        const { mockPrisma } = setupMocks({
            id: 'sess-1',
            providerId: 'db-uuid-1',
            status: 'LIVE',
            startedAt,
        });

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1', {
            method: 'PATCH',
            body: { action: 'end' },
        });
        const response = await PATCH(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { session: { status: string; durationSeconds: number } };
        expect(data.session.status).toBe('ENDED');
        expect(data.session.durationSeconds).toBeGreaterThan(3500); // ~3600 seconds
        expect(mockPrisma.scheduledSession.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'sess-1' },
                data: expect.objectContaining({ status: 'ENDED' }),
            }),
        );
    });

    it('end: stops active recordings', async () => {
        const startedAt = new Date(Date.now() - 600 * 1000);
        const { mockPrisma, mockEgressClient } = setupMocks({
            id: 'sess-1',
            providerId: 'db-uuid-1',
            status: 'LIVE',
            startedAt,
        });

        const activeRecording = {
            id: 'rec-1',
            egressId: 'egress-1',
            filePath: '/data/recordings/test.ogg',
            active: true,
        };
        mockPrisma.sessionRecording.findMany.mockResolvedValue([activeRecording]);

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1', {
            method: 'PATCH',
            body: { action: 'end' },
        });
        const response = await PATCH(request, mockParams({ id: 'sess-1' }));
        const { status } = await parseResponse(response);

        expect(status).toBe(200);
        expect(mockEgressClient.stopEgress).toHaveBeenCalledWith('egress-1');
        // File exists (mocked true), so update rather than delete
        expect(mockPrisma.sessionRecording.update).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: 'rec-1' },
                data: { active: false, stoppedAt: expect.any(Date) },
            }),
        );
    });

    it('end: returns 400 when session is not LIVE', async () => {
        setupMocks({
            id: 'sess-1',
            providerId: 'db-uuid-1',
            status: 'SCHEDULED',
        });

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1', {
            method: 'PATCH',
            body: { action: 'end' },
        });
        const response = await PATCH(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Can only end a LIVE session' });
    });

    it('cancel: sets status to CANCELLED', async () => {
        const { mockPrisma } = setupMocks({
            id: 'sess-1',
            providerId: 'db-uuid-1',
            status: 'SCHEDULED',
        });

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1', {
            method: 'PATCH',
            body: { action: 'cancel' },
        });
        const response = await PATCH(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { session: { status: string } };
        expect(data.session.status).toBe('CANCELLED');
        expect(mockPrisma.scheduledSession.update).toHaveBeenCalledWith({
            where: { id: 'sess-1' },
            data: { status: 'CANCELLED', endedAt: expect.any(Date) },
        });
    });

    it('returns 400 for invalid action', async () => {
        setupMocks({
            id: 'sess-1',
            providerId: 'db-uuid-1',
            status: 'SCHEDULED',
        });

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1', {
            method: 'PATCH',
            body: { action: 'pause' },
        });
        const response = await PATCH(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Invalid action' });
    });

    it('returns 404 when session not found for PATCH', async () => {
        setupMocks(null);

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/sessions/nonexistent', {
            method: 'PATCH',
            body: { action: 'start' },
        });
        const response = await PATCH(request, mockParams({ id: 'nonexistent' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Session not found' });
    });

    it('returns 403 when PATCH is attempted by non-owner', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'my-db-uuid' }) },
            scheduledSession: {
                findUnique: vi.fn().mockResolvedValue({
                    id: 'sess-1',
                    providerId: 'other-provider-uuid',
                    status: 'SCHEDULED',
                }),
                update: vi.fn(),
            },
            sessionRecording: { findMany: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({
            getEgressClient: vi.fn(),
        }));
        vi.doMock('fs', () => ({
            existsSync: vi.fn(),
        }));

        const { PATCH } = await import('../route');
        const request = createRequest('/api/provider/sessions/sess-1', {
            method: 'PATCH',
            body: { action: 'start' },
        });
        const response = await PATCH(request, mockParams({ id: 'sess-1' }));
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Not authorized' });
    });
});
