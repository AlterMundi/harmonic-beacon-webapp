import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseResponse } from '@/__tests__/helpers';

describe('GET /api/health/ready', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 200 when the database query succeeds', async () => {
        const mockPrisma = { $queryRaw: vi.fn().mockResolvedValue([{ '?column?': 1 }]) };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../ready/route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(200);
        expect(body).toEqual({ status: 'ok', checks: { database: 'ok' } });
    });

    it('returns 503 when the database query rejects', async () => {
        const mockPrisma = {
            $queryRaw: vi.fn().mockRejectedValue(
                new Error('connection refused: password authentication failed for user "beacon" at 10.0.0.5:5432'),
            ),
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../ready/route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(503);
        expect(body).toEqual({ status: 'error', checks: { database: 'unreachable' } });
    });

    it('does not leak connection details or raw error text in the response body', async () => {
        const mockPrisma = {
            $queryRaw: vi.fn().mockRejectedValue(
                new Error('secret-leak postgres://beacon:hunter2@db.internal:5432/harmonic_beacon'),
            ),
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const { GET } = await import('../ready/route');
        const response = await GET();
        const { status, body } = await parseResponse(response);

        expect(status).toBe(503);
        const serialized = JSON.stringify(body);
        expect(serialized).not.toContain('postgres://');
        expect(serialized).not.toContain('hunter2');
        expect(serialized).not.toContain('secret-leak');
    });

    it('does not leak the database password into the server log', async () => {
        // The response body is only half the exposure. In the cloud deploy stdout
        // is shipped to a log aggregator, and a pg auth failure puts the whole
        // connection string — password included — in error.message.
        const mockPrisma = {
            $queryRaw: vi.fn().mockRejectedValue(
                new Error('auth failed for postgresql://beacon:hunter2@db.internal:5432/harmonic_beacon'),
            ),
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));

        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            const { GET } = await import('../ready/route');
            await GET();

            expect(errorSpy).toHaveBeenCalled();
            const logged = errorSpy.mock.calls.flat().map(String).join(' ');
            expect(logged).not.toContain('hunter2');
            // Host and user must survive — a redacted line still has to be useful.
            expect(logged).toContain('db.internal:5432');
            expect(logged).toContain('beacon');
        } finally {
            errorSpy.mockRestore();
        }
    });
});
