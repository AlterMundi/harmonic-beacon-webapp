import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseResponse } from '@/__tests__/helpers';

describe('GET /api/health', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 200 with status, uptime, and version without querying the database', async () => {
        const queryRaw = vi.fn();
        const mockPrisma = { $queryRaw: queryRaw };

        // Liveness must never touch the database — mock it and assert it's
        // never called, which is the whole point of separating this from
        // /api/health/ready.
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        const data = body as { status: string; uptime: number; version: string };
        expect(data.status).toBe('ok');
        expect(typeof data.uptime).toBe('number');
        expect(typeof data.version).toBe('string');
        expect(queryRaw).not.toHaveBeenCalled();
    });
});
