import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('GET /api/scheduled-sessions/[id]/token', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));
        vi.doMock('@/lib/livekit-server', () => ({ createSessionToken: vi.fn() }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/scheduled-sessions/ss-1/token'),
            mockParams({ id: 'ss-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 404 for nonexistent session', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1', name: 'Test User', email: 'user@example.com' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({ createSessionToken: vi.fn() }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/scheduled-sessions/nonexistent/token'),
            mockParams({ id: 'nonexistent' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Session not found' });
    });

    it('provider gets canPublish=true token', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-provider-1', email: 'provider@example.com', name: 'Provider', role: 'PROVIDER' },
            }),
        }));

        const mockSession = {
            id: 'ss-1',
            title: 'Live Session',
            status: 'LIVE',
            roomName: 'room-ss-1',
            providerId: 'db-provider-1',
            startedAt: new Date('2025-01-01T10:00:00Z'),
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-provider-1', name: 'Provider', email: 'provider@example.com' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(mockSession) },
            sessionParticipant: {
                findUnique: vi.fn().mockResolvedValue(null),
                upsert: vi.fn().mockResolvedValue({}),
            },
            sessionRecording: { findFirst: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({
            createSessionToken: vi.fn().mockResolvedValue('mock-token-provider'),
        }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/scheduled-sessions/ss-1/token'),
            mockParams({ id: 'ss-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { token: string; canPublish: boolean; room: string };
        expect(data.token).toBe('mock-token-provider');
        expect(data.canPublish).toBe(true);
        expect(data.room).toBe('room-ss-1');
    });

    it('listener gets canPublish=false token for LIVE session', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-listener-1', email: 'listener@example.com', name: 'Listener', role: 'USER' },
            }),
        }));

        const mockSession = {
            id: 'ss-1',
            title: 'Live Session',
            status: 'LIVE',
            roomName: 'room-ss-1',
            providerId: 'other-provider-id',
            startedAt: new Date('2025-01-01T10:00:00Z'),
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-listener-1', name: 'Listener', email: 'listener@example.com' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(mockSession) },
            sessionParticipant: {
                findUnique: vi.fn().mockResolvedValue(null),
                upsert: vi.fn().mockResolvedValue({}),
            },
            sessionRecording: { findFirst: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({
            createSessionToken: vi.fn().mockResolvedValue('mock-token-listener'),
        }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/scheduled-sessions/ss-1/token'),
            mockParams({ id: 'ss-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { token: string; canPublish: boolean };
        expect(data.token).toBe('mock-token-listener');
        expect(data.canPublish).toBe(false);
    });

    it('listener cannot join SCHEDULED session without invite', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-listener-1', email: 'listener@example.com', name: 'Listener', role: 'USER' },
            }),
        }));

        const mockSession = {
            id: 'ss-1',
            title: 'Upcoming Session',
            status: 'SCHEDULED',
            roomName: 'room-ss-1',
            providerId: 'other-provider-id',
            startedAt: null,
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-listener-1', name: 'Listener', email: 'listener@example.com' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(mockSession) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({ createSessionToken: vi.fn() }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/scheduled-sessions/ss-1/token'),
            mockParams({ id: 'ss-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Session is not live yet' });
    });

    it('valid invite allows joining LIVE session with canPublish from invite', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-listener-1', email: 'listener@example.com', name: 'Listener', role: 'USER' },
            }),
        }));

        const mockSession = {
            id: 'ss-1',
            title: 'Live Session',
            status: 'LIVE',
            roomName: 'room-ss-1',
            providerId: 'other-provider-id',
            startedAt: new Date('2025-01-01T10:00:00Z'),
        };

        const mockInvite = {
            id: 'invite-1',
            code: 'VALID-CODE',
            sessionId: 'ss-1',
            canPublish: true,
            expiresAt: new Date(Date.now() + 3600000), // 1 hour from now
            maxUses: 10,
            usedCount: 3,
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-listener-1', name: 'Listener', email: 'listener@example.com' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(mockSession) },
            sessionParticipant: {
                findUnique: vi.fn().mockResolvedValue(null),
                upsert: vi.fn().mockResolvedValue({}),
            },
            sessionInvite: {
                findUnique: vi.fn().mockResolvedValue(mockInvite),
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            sessionRecording: { findFirst: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({
            createSessionToken: vi.fn().mockResolvedValue('mock-token-invited'),
        }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/scheduled-sessions/ss-1/token', {
                searchParams: { invite: 'VALID-CODE' },
            }),
            mockParams({ id: 'ss-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { token: string; canPublish: boolean };
        expect(data.token).toBe('mock-token-invited');
        expect(data.canPublish).toBe(true);

        // Verify invite usage was incremented
        expect(mockPrisma.sessionInvite.updateMany).toHaveBeenCalled();
    });

    it('expired invite returns 400', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-listener-1', email: 'listener@example.com', name: 'Listener', role: 'USER' },
            }),
        }));

        const mockSession = {
            id: 'ss-1',
            title: 'Live Session',
            status: 'LIVE',
            roomName: 'room-ss-1',
            providerId: 'other-provider-id',
            startedAt: new Date(),
        };

        const mockInvite = {
            id: 'invite-1',
            code: 'EXPIRED-CODE',
            sessionId: 'ss-1',
            canPublish: false,
            expiresAt: new Date(Date.now() - 3600000), // 1 hour ago (expired)
            maxUses: 0,
            usedCount: 0,
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-listener-1', name: 'Listener', email: 'listener@example.com' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(mockSession) },
            sessionParticipant: { findUnique: vi.fn().mockResolvedValue(null) },
            sessionInvite: { findUnique: vi.fn().mockResolvedValue(mockInvite) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({ createSessionToken: vi.fn() }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/scheduled-sessions/ss-1/token', {
                searchParams: { invite: 'EXPIRED-CODE' },
            }),
            mockParams({ id: 'ss-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Invite has expired' });
    });

    it('used invite (maxUses reached) returns 400', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-listener-1', email: 'listener@example.com', name: 'Listener', role: 'USER' },
            }),
        }));

        const mockSession = {
            id: 'ss-1',
            title: 'Live Session',
            status: 'LIVE',
            roomName: 'room-ss-1',
            providerId: 'other-provider-id',
            startedAt: new Date(),
        };

        const mockInvite = {
            id: 'invite-1',
            code: 'USED-CODE',
            sessionId: 'ss-1',
            canPublish: false,
            expiresAt: new Date(Date.now() + 3600000), // still valid time-wise
            maxUses: 5,
            usedCount: 5, // maxUses reached
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-listener-1', name: 'Listener', email: 'listener@example.com' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(mockSession) },
            sessionParticipant: { findUnique: vi.fn().mockResolvedValue(null) },
            sessionInvite: { findUnique: vi.fn().mockResolvedValue(mockInvite) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({ createSessionToken: vi.fn() }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/scheduled-sessions/ss-1/token', {
                searchParams: { invite: 'USED-CODE' },
            }),
            mockParams({ id: 'ss-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Invite usage limit reached' });
    });

    it('tracks new participant join via upsert', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-listener-1', email: 'listener@example.com', name: 'Listener', role: 'USER' },
            }),
        }));

        const mockSession = {
            id: 'ss-1',
            title: 'Live Session',
            status: 'LIVE',
            roomName: 'room-ss-1',
            providerId: 'other-provider-id',
            startedAt: new Date('2025-01-01T10:00:00Z'),
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-listener-1', name: 'Listener', email: 'listener@example.com' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(mockSession) },
            sessionParticipant: {
                findUnique: vi.fn().mockResolvedValue(null),
                upsert: vi.fn().mockResolvedValue({}),
            },
            sessionRecording: { findFirst: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({
            createSessionToken: vi.fn().mockResolvedValue('mock-token'),
        }));

        const { GET } = await import('../route');
        await GET(
            createRequest('/api/scheduled-sessions/ss-1/token'),
            mockParams({ id: 'ss-1' }),
        );

        expect(mockPrisma.sessionParticipant.upsert).toHaveBeenCalledWith({
            where: {
                sessionId_userId: { sessionId: 'ss-1', userId: 'db-listener-1' },
            },
            create: { sessionId: 'ss-1', userId: 'db-listener-1' },
            update: { leftAt: null, durationSeconds: null },
        });
    });

    it('handles reconnect (existing participant) — resets leftAt', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-listener-1', email: 'listener@example.com', name: 'Listener', role: 'USER' },
            }),
        }));

        const mockSession = {
            id: 'ss-1',
            title: 'Live Session',
            status: 'LIVE',
            roomName: 'room-ss-1',
            providerId: 'other-provider-id',
            startedAt: new Date('2025-01-01T10:00:00Z'),
        };

        const existingParticipant = {
            id: 'participant-1',
            sessionId: 'ss-1',
            userId: 'db-listener-1',
            leftAt: new Date('2025-01-01T10:15:00Z'),
        };

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-listener-1', name: 'Listener', email: 'listener@example.com' }) },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(mockSession) },
            sessionParticipant: {
                findUnique: vi.fn().mockResolvedValue(existingParticipant),
                upsert: vi.fn().mockResolvedValue({}),
            },
            sessionRecording: { findFirst: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        vi.doMock('@/lib/livekit-server', () => ({
            createSessionToken: vi.fn().mockResolvedValue('mock-token-reconnect'),
        }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/scheduled-sessions/ss-1/token'),
            mockParams({ id: 'ss-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { token: string };
        expect(data.token).toBe('mock-token-reconnect');

        // Upsert is still called to reset leftAt on reconnect
        expect(mockPrisma.sessionParticipant.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
                update: { leftAt: null, durationSeconds: null },
            }),
        );
    });
});
