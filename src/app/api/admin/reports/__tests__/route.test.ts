import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

const ADMIN_SESSION = {
    user: { id: 'zitadel-admin-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
};

function mockAuth(session: unknown) {
    vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(session) }));
}

const OPEN_REPORT = {
    id: 'report-1',
    targetType: 'MEDITATION',
    targetId: 'med-1',
    reason: 'SAFETY',
    detail: 'Unsafe breathwork instruction.',
    status: 'OPEN',
    resolution: null,
    acknowledgedAt: null,
    resolvedAt: null,
    createdAt: new Date('2026-07-26T09:00:00.000Z'),
    reporter: { id: 'db-listener-1', name: 'Listener', email: 'listener@example.com' },
    handledBy: null,
};

function mockDb(overrides: Record<string, unknown> = {}) {
    const mockPrisma = {
        report: {
            findMany: vi.fn().mockResolvedValue([OPEN_REPORT]),
            groupBy: vi.fn().mockResolvedValue([{ status: 'OPEN', _count: { _all: 1 } }]),
        },
        ...overrides,
    };
    vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
    return mockPrisma;
}

describe('GET /api/admin/reports', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        mockAuth(null);
        mockDb();

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/admin/reports'));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 403 for a LISTENER', async () => {
        mockAuth({ user: { id: 'zitadel-l-1', email: 'l@example.com', name: 'L', role: 'LISTENER' } });
        const mockPrisma = mockDb();

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/admin/reports'));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Insufficient permissions' });
        expect(mockPrisma.report.findMany).not.toHaveBeenCalled();
    });

    it('returns 403 for a PROVIDER — the queue is not a Provider surface', async () => {
        mockAuth({ user: { id: 'zitadel-p-1', email: 'p@example.com', name: 'P', role: 'PROVIDER' } });
        mockDb();

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/admin/reports'));

        expect(res.status).toBe(403);
    });

    it('lists reports oldest first so the 24h clock is not buried', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb();

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/admin/reports'));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { reports: Record<string, unknown>[]; counts: Record<string, number> };
        expect(data.reports).toHaveLength(1);
        expect(data.reports[0].createdAt).toBe('2026-07-26T09:00:00.000Z');
        expect(data.counts).toEqual({ OPEN: 1 });

        expect(mockPrisma.report.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ orderBy: { createdAt: 'asc' }, take: 50 }),
        );
    });

    it('filters by status', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb();

        const { GET } = await import('../route');
        await GET(createRequest('/api/admin/reports', { searchParams: { status: 'TRIAGED' } }));

        expect(mockPrisma.report.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ where: { status: 'TRIAGED' } }),
        );
    });

    it('rejects an unknown status filter', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb();

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/admin/reports', { searchParams: { status: 'PENDING' } }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'status must be one of OPEN, TRIAGED, RESOLVED, DISMISSED' });
        expect(mockPrisma.report.findMany).not.toHaveBeenCalled();
    });

    it('caps the page size', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb();

        const { GET } = await import('../route');
        await GET(createRequest('/api/admin/reports', { searchParams: { limit: '5000' } }));

        expect(mockPrisma.report.findMany).toHaveBeenCalledWith(
            expect.objectContaining({ take: 200 }),
        );
    });

    it('rejects a nonsense limit', async () => {
        mockAuth(ADMIN_SESSION);
        mockDb();

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/admin/reports', { searchParams: { limit: 'lots' } }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'limit must be a positive integer' });
    });

    it('still returns a report whose reporter has been anonymised away', async () => {
        // BUSINESS_RULES.md §9.1 anonymises rather than deletes, so the joined row
        // survives with its identifiers stripped; a hard delete nulls the relation
        // outright. Both must leave the report itself actionable.
        mockAuth(ADMIN_SESSION);
        mockDb({
            report: {
                findMany: vi.fn().mockResolvedValue([
                    { ...OPEN_REPORT, reporter: { id: 'db-listener-1', name: null, email: 'deleted-db-listener-1@deleted.invalid' } },
                    { ...OPEN_REPORT, id: 'report-2', reporter: null },
                ]),
                groupBy: vi.fn().mockResolvedValue([{ status: 'OPEN', _count: { _all: 2 } }]),
            },
        });

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/admin/reports'));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(200);
        const data = body as { reports: { id: string; reporter: unknown; targetId: string }[] };
        expect(data.reports).toHaveLength(2);
        expect(data.reports[0].reporter).toEqual({
            id: 'db-listener-1',
            name: null,
            email: 'deleted-db-listener-1@deleted.invalid',
        });
        expect(data.reports[1].reporter).toBeNull();
        expect(data.reports[1].targetId).toBe('med-1');
    });

    it('does not leak the raw error on a DB failure', async () => {
        mockAuth(ADMIN_SESSION);
        mockDb({
            report: {
                findMany: vi.fn().mockRejectedValue(
                    new Error('connect failed: postgresql://beacon:s3cr3t@db:5432/beacon'),
                ),
                groupBy: vi.fn(),
            },
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { GET } = await import('../route');
        const res = await GET(createRequest('/api/admin/reports'));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(500);
        expect(body).toEqual({ error: 'Failed to list reports' });
        expect(consoleError.mock.calls.flat().join(' ')).not.toContain('s3cr3t');

        consoleError.mockRestore();
    });
});
