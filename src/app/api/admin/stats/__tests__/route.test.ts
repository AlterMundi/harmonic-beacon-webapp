import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

describe('GET /api/admin/stats', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue(null),
        }));

        const mockPrisma = {
            user: { count: vi.fn() },
            meditation: { count: vi.fn() },
            listeningSession: { count: vi.fn(), aggregate: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 403 for non-admin', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-user-123', email: 'user@example.com', name: 'User', role: 'USER' },
            }),
        }));

        const mockPrisma = {
            user: { count: vi.fn() },
            meditation: { count: vi.fn() },
            listeningSession: { count: vi.fn(), aggregate: vi.fn() },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Insufficient permissions' });
    });

    it('returns aggregated stats', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            user: { count: vi.fn().mockResolvedValue(42) },
            meditation: {
                count: vi.fn()
                    .mockResolvedValueOnce(15)   // totalMeditations
                    .mockResolvedValueOnce(3),    // pendingMeditations
            },
            listeningSession: {
                count: vi.fn().mockResolvedValue(100),
                aggregate: vi.fn().mockResolvedValue({
                    _sum: { durationSeconds: 36000 },
                }),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { stats: Record<string, number> };
        expect(data.stats).toEqual({
            totalUsers: 42,
            totalMeditations: 15,
            pendingMeditations: 3,
            totalSessions: 100,
            totalMinutes: 600, // 36000 / 60
        });
    });

    it('returns zero stats when empty', async () => {
        vi.doMock('@/auth', () => ({
            auth: vi.fn().mockResolvedValue({
                user: { id: 'zitadel-admin-123', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
            }),
        }));

        const mockPrisma = {
            user: { count: vi.fn().mockResolvedValue(0) },
            meditation: {
                count: vi.fn()
                    .mockResolvedValueOnce(0)
                    .mockResolvedValueOnce(0),
            },
            listeningSession: {
                count: vi.fn().mockResolvedValue(0),
                aggregate: vi.fn().mockResolvedValue({
                    _sum: { durationSeconds: null },
                }),
            },
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { stats: Record<string, number> };
        expect(data.stats).toEqual({
            totalUsers: 0,
            totalMeditations: 0,
            pendingMeditations: 0,
            totalSessions: 0,
            totalMinutes: 0,
        });
    });
});
