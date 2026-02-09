import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

describe('GET /api/provider/sessions', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn() },
            scheduledSession: { findMany: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/invite-codes', () => ({
            generateRoomName: vi.fn().mockReturnValue('session-abc12345'),
        }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns provider sessions with participant and invite counts', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockSessions = [
            {
                id: 'sess-1',
                title: 'Group Healing',
                description: 'Healing session',
                roomName: 'session-abc12345',
                status: 'SCHEDULED',
                scheduledAt: new Date('2025-03-01T10:00:00Z'),
                startedAt: null,
                endedAt: null,
                durationSeconds: null,
                createdAt: new Date('2025-02-01'),
                _count: { participants: 3, invites: 5 },
            },
        ];

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            scheduledSession: { findMany: vi.fn().mockResolvedValue(mockSessions) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/invite-codes', () => ({
            generateRoomName: vi.fn(),
        }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { sessions: Array<{
            id: string;
            participantCount: number;
            inviteCount: number;
            scheduledAt: string;
        }> };
        expect(data.sessions).toHaveLength(1);
        expect(data.sessions[0].id).toBe('sess-1');
        expect(data.sessions[0].participantCount).toBe(3);
        expect(data.sessions[0].inviteCount).toBe(5);
        expect(data.sessions[0].scheduledAt).toBe('2025-03-01T10:00:00.000Z');

        // Verify scoped to provider
        expect(mockPrisma.scheduledSession.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { providerId: 'db-uuid-1' },
            }),
        );
    });

    it('returns empty array when provider has no sessions', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            scheduledSession: { findMany: vi.fn().mockResolvedValue([]) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/invite-codes', () => ({
            generateRoomName: vi.fn(),
        }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { sessions: unknown[] };
        expect(data.sessions).toEqual([]);
    });
});

describe('POST /api/provider/sessions', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn() },
            scheduledSession: { create: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/invite-codes', () => ({
            generateRoomName: vi.fn().mockReturnValue('session-abc12345'),
        }));

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions', {
            method: 'POST',
            body: { title: 'Test' },
        });
        const response = await POST(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('creates session with title and generated roomName', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const createdSession = {
            id: 'sess-new',
            title: 'Healing Circle',
            description: null,
            roomName: 'session-abc12345',
            providerId: 'db-uuid-1',
            status: 'SCHEDULED',
            scheduledAt: null,
            createdAt: new Date('2025-02-01'),
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            scheduledSession: { create: vi.fn().mockResolvedValue(createdSession) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/invite-codes', () => ({
            generateRoomName: vi.fn().mockReturnValue('session-abc12345'),
        }));

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions', {
            method: 'POST',
            body: { title: 'Healing Circle' },
        });
        const response = await POST(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(201);
        const data = body as { session: { id: string; title: string; roomName: string } };
        expect(data.session.id).toBe('sess-new');
        expect(data.session.title).toBe('Healing Circle');
        expect(data.session.roomName).toBe('session-abc12345');

        expect(mockPrisma.scheduledSession.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                title: 'Healing Circle',
                roomName: 'session-abc12345',
                providerId: 'db-uuid-1',
            }),
        });
    });

    it('returns 400 when title is missing', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-prov-123', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-uuid-1' }) },
            scheduledSession: { create: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma }));
        vi.doMock('@/lib/invite-codes', () => ({
            generateRoomName: vi.fn(),
        }));

        const { POST } = await import('../route');
        const request = createRequest('/api/provider/sessions', {
            method: 'POST',
            body: { description: 'No title here' },
        });
        const response = await POST(request);
        const { status, body } = await parseResponse(response);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Title is required' });
    });
});
