import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

describe('GET /api/sessions', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/sessions'));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns paginated sessions with limit/offset', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const startedAt = new Date('2025-01-01T10:00:00Z');
        const endedAt = new Date('2025-01-01T10:30:00Z');

        const mockSessions = [
            {
                id: 'session-1',
                type: 'LIVE',
                durationSeconds: 1800,
                completed: true,
                startedAt,
                endedAt,
                meditation: null,
            },
        ];

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            listeningSession: {
                findMany: vi.fn().mockResolvedValue(mockSessions),
                count: vi.fn().mockResolvedValue(15),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/sessions', {
            searchParams: { limit: '5', offset: '10' },
        }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { sessions: unknown[]; total: number };
        expect(data.total).toBe(15);
        expect(data.sessions).toHaveLength(1);
        expect(data.sessions[0]).toEqual({
            id: 'session-1',
            type: 'LIVE',
            durationSeconds: 1800,
            completed: true,
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            meditation: null,
        });

        // Verify pagination params were passed
        expect(mockPrisma.listeningSession.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ take: 5, skip: 10 }),
        );
    });

    it('returns empty sessions array', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            listeningSession: {
                findMany: vi.fn().mockResolvedValue([]),
                count: vi.fn().mockResolvedValue(0),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/sessions'));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { sessions: unknown[]; total: number };
        expect(data.sessions).toEqual([]);
        expect(data.total).toBe(0);
    });

    it('returns 404 when user not found', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/sessions'));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'User not found' });
    });
});

describe('POST /api/sessions', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));

        const { POST } = await import('../route');
        const res = await POST(createRequest('/api/sessions', {
            method: 'POST',
            body: { type: 'LIVE' },
        }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('creates session with type LIVE', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const startedAt = new Date('2025-01-01T10:00:00Z');
        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            listeningSession: {
                create: vi.fn().mockResolvedValue({
                    id: 'session-new',
                    startedAt,
                }),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { POST } = await import('../route');
        const res = await POST(createRequest('/api/sessions', {
            method: 'POST',
            body: { type: 'LIVE' },
        }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { sessionId: string; startedAt: string };
        expect(data.sessionId).toBe('session-new');
        expect(data.startedAt).toBe(startedAt.toISOString());

        expect(mockPrisma.listeningSession.create).toHaveBeenCalledWith({
            data: {
                userId: 'db-user-1',
                type: 'LIVE',
                meditationId: null,
                durationSeconds: 0,
            },
        });
    });

    it('creates session with type MEDITATION and meditationId', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const startedAt = new Date('2025-01-01T10:00:00Z');
        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            listeningSession: {
                create: vi.fn().mockResolvedValue({
                    id: 'session-med',
                    startedAt,
                }),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { POST } = await import('../route');
        const res = await POST(createRequest('/api/sessions', {
            method: 'POST',
            body: { type: 'MEDITATION', meditationId: 'med-1' },
        }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { sessionId: string; startedAt: string };
        expect(data.sessionId).toBe('session-med');

        expect(mockPrisma.listeningSession.create).toHaveBeenCalledWith({
            data: {
                userId: 'db-user-1',
                type: 'MEDITATION',
                meditationId: 'med-1',
                durationSeconds: 0,
            },
        });
    });

    it('validates type field', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));

        const { POST } = await import('../route');
        const res = await POST(createRequest('/api/sessions', {
            method: 'POST',
            body: { type: 'INVALID' },
        }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'type must be LIVE or MEDITATION' });
    });
});
