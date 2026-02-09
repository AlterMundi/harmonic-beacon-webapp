import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

describe('GET /api/invites/[code]', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 404 for invalid code', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            sessionInvite: { findUnique: vi.fn().mockResolvedValue(null) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/invites/INVALID'),
            mockParams({ code: 'INVALID' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Invalid invite code' });
    });

    it('returns 410 for expired invite', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockInvite = {
            code: 'EXPIRED-CODE',
            sessionId: 'ss-1',
            expiresAt: new Date(Date.now() - 3600000), // 1 hour ago
            maxUses: 0,
            usedCount: 0,
            session: {
                id: 'ss-1',
                title: 'Session',
                description: null,
                status: 'LIVE',
                scheduledAt: null,
                provider: { name: 'Provider' },
                _count: { participants: 0 },
            },
        };

        const mockPrisma = {
            sessionInvite: { findUnique: vi.fn().mockResolvedValue(mockInvite) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/invites/EXPIRED-CODE'),
            mockParams({ code: 'EXPIRED-CODE' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(410);
        expect(body).toEqual({ error: 'Invite is no longer valid' });
    });

    it('returns 410 for fully used invite', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockInvite = {
            code: 'USED-CODE',
            sessionId: 'ss-1',
            expiresAt: new Date(Date.now() + 3600000), // still valid time-wise
            maxUses: 5,
            usedCount: 5, // fully used
            session: {
                id: 'ss-1',
                title: 'Session',
                description: null,
                status: 'LIVE',
                scheduledAt: null,
                provider: { name: 'Provider' },
                _count: { participants: 5 },
            },
        };

        const mockPrisma = {
            sessionInvite: { findUnique: vi.fn().mockResolvedValue(mockInvite) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/invites/USED-CODE'),
            mockParams({ code: 'USED-CODE' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(410);
        expect(body).toEqual({ error: 'Invite is no longer valid' });
    });

    it('returns session info for valid invite', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const scheduledAt = new Date('2025-01-02T14:00:00Z');

        const mockInvite = {
            code: 'VALID-CODE',
            sessionId: 'ss-1',
            expiresAt: new Date(Date.now() + 3600000),
            maxUses: 10,
            usedCount: 3,
            session: {
                id: 'ss-1',
                title: 'Morning Beacon',
                description: 'A calming beacon session',
                status: 'LIVE',
                scheduledAt,
                provider: { name: 'Provider User' },
                _count: { participants: 7 },
            },
        };

        const mockPrisma = {
            sessionInvite: { findUnique: vi.fn().mockResolvedValue(mockInvite) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/invites/VALID-CODE'),
            mockParams({ code: 'VALID-CODE' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as {
            invite: { code: string; sessionId: string };
            session: {
                id: string; title: string; description: string;
                status: string; scheduledAt: string;
                providerName: string; participantCount: number;
            };
        };

        expect(data.invite).toEqual({
            code: 'VALID-CODE',
            sessionId: 'ss-1',
        });
        expect(data.session).toEqual({
            id: 'ss-1',
            title: 'Morning Beacon',
            description: 'A calming beacon session',
            status: 'LIVE',
            scheduledAt: scheduledAt.toISOString(),
            providerName: 'Provider User',
            participantCount: 7,
        });
    });

    it('returns 410 when session has ended', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockInvite = {
            code: 'ENDED-SESSION',
            sessionId: 'ss-1',
            expiresAt: new Date(Date.now() + 3600000),
            maxUses: 0,
            usedCount: 0,
            session: {
                id: 'ss-1',
                title: 'Ended Session',
                description: null,
                status: 'ENDED',
                scheduledAt: null,
                provider: { name: 'Provider' },
                _count: { participants: 3 },
            },
        };

        const mockPrisma = {
            sessionInvite: { findUnique: vi.fn().mockResolvedValue(mockInvite) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/invites/ENDED-SESSION'),
            mockParams({ code: 'ENDED-SESSION' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(410);
        expect(body).toEqual({ error: 'Session has ended' });
    });

    it('returns session status and provider name', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockInvite = {
            code: 'SCHEDULED-CODE',
            sessionId: 'ss-2',
            expiresAt: null, // no expiration
            maxUses: 0, // unlimited
            usedCount: 0,
            session: {
                id: 'ss-2',
                title: 'Upcoming Beacon',
                description: 'Scheduled for tomorrow',
                status: 'SCHEDULED',
                scheduledAt: new Date('2025-01-03T10:00:00Z'),
                provider: { name: 'Beacon Master' },
                _count: { participants: 0 },
            },
        };

        const mockPrisma = {
            sessionInvite: { findUnique: vi.fn().mockResolvedValue(mockInvite) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(
            createRequest('/api/invites/SCHEDULED-CODE'),
            mockParams({ code: 'SCHEDULED-CODE' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as {
            session: { status: string; providerName: string; participantCount: number };
        };
        expect(data.session.status).toBe('SCHEDULED');
        expect(data.session.providerName).toBe('Beacon Master');
        expect(data.session.participantCount).toBe(0);
    });
});
