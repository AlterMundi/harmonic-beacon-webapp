import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseResponse } from '@/__tests__/helpers';

describe('GET /api/sessions/my-recordings', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(null) }));
        vi.doMock('@/lib/db', () => ({ prisma: {}, default: {} }));

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns sessions with recordings', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const endedAt = new Date('2025-01-01T11:00:00Z');

        const mockSessions = [
            {
                id: 'session-1',
                title: 'Morning Beacon',
                endedAt,
                durationSeconds: 1800,
                provider: { name: 'Provider User' },
                recordings: [
                    { id: 'rec-1', category: 'BEACON' },
                    { id: 'rec-2', category: 'PARTICIPANT' },
                ],
            },
        ];

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            scheduledSession: { findMany: vi.fn().mockResolvedValue(mockSessions) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { sessions: Array<{
            id: string;
            title: string;
            providerName: string;
            endedAt: string;
            durationSeconds: number;
            hasBeaconRecording: boolean;
            trackCount: number;
        }> };

        expect(data.sessions).toHaveLength(1);
        expect(data.sessions[0]).toEqual({
            id: 'session-1',
            title: 'Morning Beacon',
            providerName: 'Provider User',
            endedAt: endedAt.toISOString(),
            durationSeconds: 1800,
            hasBeaconRecording: true,
            trackCount: 2,
        });
    });

    it('returns empty array when no recordings', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            scheduledSession: { findMany: vi.fn().mockResolvedValue([]) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const res = await GET();
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { sessions: unknown[] };
        expect(data.sessions).toEqual([]);
    });

    it('checks user by zitadelId', async () => {
        const zitadelId = 'zitadel-subject-789';

        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: zitadelId, email: 'user@example.com', name: 'Test User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-1' }) },
            scheduledSession: { findMany: vi.fn().mockResolvedValue([]) },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        await GET();

        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
            where: { zitadelId },
            select: { id: true },
        });
    });
});
