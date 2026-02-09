import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

describe('GET /api/scheduled-sessions', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns LIVE and SCHEDULED sessions by default', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const scheduledAt = new Date('2025-01-02T14:00:00Z');
        const startedAt = new Date('2025-01-02T14:01:00Z');

        const mockSessions = [
            {
                id: 'ss-1',
                title: 'Live Beacon',
                description: 'A live session',
                status: 'LIVE',
                scheduledAt,
                startedAt,
                createdAt: new Date(),
                provider: { id: 'provider-1', name: 'Provider User' },
                _count: { participants: 5 },
            },
            {
                id: 'ss-2',
                title: 'Upcoming Session',
                description: 'Coming soon',
                status: 'SCHEDULED',
                scheduledAt: new Date('2025-01-03T10:00:00Z'),
                startedAt: null,
                createdAt: new Date(),
                provider: { id: 'provider-2', name: 'Another Provider' },
                _count: { participants: 0 },
            },
        ];

        const mockPrisma = {
            scheduledSession: { findMany: vi.fn().mockResolvedValue(mockSessions) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/scheduled-sessions'));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { sessions: Array<{ id: string; status: string; participantCount: number }> };
        expect(data.sessions).toHaveLength(2);
        expect(data.sessions[0].id).toBe('ss-1');
        expect(data.sessions[0].status).toBe('LIVE');
        expect(data.sessions[0].participantCount).toBe(5);
        expect(data.sessions[1].status).toBe('SCHEDULED');

        // Verify default filter is SCHEDULED + LIVE
        expect(mockPrisma.scheduledSession.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { status: { in: ['SCHEDULED', 'LIVE'] } },
            }),
        );
    });

    it('filters by status query param', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            scheduledSession: { findMany: vi.fn().mockResolvedValue([]) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        await GET(createRequest('/api/scheduled-sessions', {
            searchParams: { status: 'ENDED' },
        }));

        expect(mockPrisma.scheduledSession.findMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { status: { in: ['ENDED'] } },
            }),
        );
    });

    it('returns empty array', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            scheduledSession: { findMany: vi.fn().mockResolvedValue([]) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/scheduled-sessions'));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { sessions: unknown[] };
        expect(data.sessions).toEqual([]);
    });

    it('includes participant count', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockSessions = [
            {
                id: 'ss-1',
                title: 'Session',
                description: null,
                status: 'LIVE',
                scheduledAt: null,
                startedAt: new Date('2025-01-01T10:00:00Z'),
                createdAt: new Date(),
                provider: { id: 'provider-1', name: 'Provider' },
                _count: { participants: 12 },
            },
        ];

        const mockPrisma = {
            scheduledSession: { findMany: vi.fn().mockResolvedValue(mockSessions) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/scheduled-sessions'));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { sessions: Array<{ participantCount: number; provider: { id: string; name: string } }> };
        expect(data.sessions[0].participantCount).toBe(12);
        expect(data.sessions[0].provider).toEqual({ id: 'provider-1', name: 'Provider' });
    });
});
