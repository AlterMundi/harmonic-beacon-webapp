import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse } from '@/__tests__/helpers';

const LISTENER_SESSION = {
    user: { id: 'zitadel-listener-1', email: 'listener@example.com', name: 'Listener', role: 'LISTENER' },
};

function mockAuth(session: unknown) {
    vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(session) }));
}

function mockDb(overrides: Record<string, unknown> = {}) {
    const mockPrisma = {
        user: {
            findUnique: vi.fn().mockResolvedValue({ id: 'db-listener-1' }),
            count: vi.fn().mockResolvedValue(1),
        },
        meditation: { count: vi.fn().mockResolvedValue(1) },
        scheduledSession: { count: vi.fn().mockResolvedValue(1) },
        report: {
            findFirst: vi.fn().mockResolvedValue(null),
            create: vi.fn().mockResolvedValue({
                id: 'report-1',
                status: 'OPEN',
                createdAt: new Date('2026-07-26T10:00:00.000Z'),
            }),
        },
        ...overrides,
    };
    vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
    return mockPrisma;
}

function fileReport(body: unknown) {
    return createRequest('/api/reports', { method: 'POST', body });
}

describe('POST /api/reports', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        mockAuth(null);
        mockDb();

        const { POST } = await import('../route');
        const res = await POST(fileReport({ targetType: 'MEDITATION', targetId: 'med-1', reason: 'SAFETY' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('lets any authenticated user file a report', async () => {
        mockAuth(LISTENER_SESSION);
        const mockPrisma = mockDb();

        const { POST } = await import('../route');
        const res = await POST(fileReport({
            targetType: 'MEDITATION',
            targetId: 'med-1',
            reason: 'THERAPEUTIC_CLAIM',
            detail: 'Claims to cure insomnia.',
        }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(201);
        expect(body).toEqual({
            report: { id: 'report-1', status: 'OPEN', createdAt: '2026-07-26T10:00:00.000Z' },
        });
        expect(mockPrisma.report.create).toHaveBeenCalledWith({
            data: {
                reporterId: 'db-listener-1',
                targetType: 'MEDITATION',
                targetId: 'med-1',
                reason: 'THERAPEUTIC_CLAIM',
                detail: 'Claims to cure insomnia.',
            },
            select: { id: true, status: true, createdAt: true },
        });
    });

    it('resolves the reporter by zitadelId, not by using the subject as a uuid', async () => {
        mockAuth(LISTENER_SESSION);
        const mockPrisma = mockDb();

        const { POST } = await import('../route');
        await POST(fileReport({ targetType: 'USER', targetId: 'user-9', reason: 'SPAM' }));

        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
            where: { zitadelId: 'zitadel-listener-1' },
            select: { id: true },
        });
    });

    it('rejects a second open report from the same reporter against the same target', async () => {
        mockAuth(LISTENER_SESSION);
        const mockPrisma = mockDb({
            report: {
                findFirst: vi.fn().mockResolvedValue({ id: 'report-existing' }),
                create: vi.fn(),
            },
        });

        const { POST } = await import('../route');
        const res = await POST(fileReport({ targetType: 'MEDITATION', targetId: 'med-1', reason: 'SAFETY' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(409);
        expect(body).toEqual({
            error: 'You already have an open report against this target',
            reportId: 'report-existing',
        });
        expect(mockPrisma.report.create).not.toHaveBeenCalled();

        // Scoped to OPEN, reporter, and target — not to the reason, or a reporter
        // could stack five reports on one target by cycling categories.
        expect(mockPrisma.report.findFirst).toHaveBeenCalledWith({
            where: {
                reporterId: 'db-listener-1',
                targetType: 'MEDITATION',
                targetId: 'med-1',
                status: 'OPEN',
            },
            select: { id: true },
        });
    });

    it('allows a fresh report once the earlier one is no longer open', async () => {
        mockAuth(LISTENER_SESSION);
        // findFirst filters on status OPEN, so a RESOLVED predecessor returns null.
        const mockPrisma = mockDb();

        const { POST } = await import('../route');
        const res = await POST(fileReport({ targetType: 'MEDITATION', targetId: 'med-1', reason: 'SAFETY' }));

        expect(res.status).toBe(201);
        expect(mockPrisma.report.create).toHaveBeenCalled();
    });

    it('does not suppress a different reporter reporting the same target', async () => {
        mockAuth({ user: { ...LISTENER_SESSION.user, id: 'zitadel-listener-2' } });
        const mockPrisma = mockDb({
            user: {
                findUnique: vi.fn().mockResolvedValue({ id: 'db-listener-2' }),
                count: vi.fn().mockResolvedValue(1),
            },
        });

        const { POST } = await import('../route');
        const res = await POST(fileReport({ targetType: 'MEDITATION', targetId: 'med-1', reason: 'SAFETY' }));

        expect(res.status).toBe(201);
        expect(mockPrisma.report.findFirst).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({ reporterId: 'db-listener-2' }),
            }),
        );
    });

    it('rejects an unknown targetType', async () => {
        mockAuth(LISTENER_SESSION);
        const mockPrisma = mockDb();

        const { POST } = await import('../route');
        const res = await POST(fileReport({ targetType: 'PLAYLIST', targetId: 'p-1', reason: 'SAFETY' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'targetType must be one of MEDITATION, SESSION, USER' });
        expect(mockPrisma.report.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown reason', async () => {
        mockAuth(LISTENER_SESSION);
        mockDb();

        const { POST } = await import('../route');
        const res = await POST(fileReport({ targetType: 'MEDITATION', targetId: 'med-1', reason: 'RUDE' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({
            error: 'reason must be one of SAFETY, THERAPEUTIC_CLAIM, COPYRIGHT, SPAM, OTHER',
        });
    });

    it('rejects a missing targetId', async () => {
        mockAuth(LISTENER_SESSION);
        mockDb();

        const { POST } = await import('../route');
        const res = await POST(fileReport({ targetType: 'MEDITATION', reason: 'SAFETY' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'targetId is required' });
    });

    it('rejects an oversized detail', async () => {
        mockAuth(LISTENER_SESSION);
        mockDb();

        const { POST } = await import('../route');
        const res = await POST(fileReport({
            targetType: 'MEDITATION',
            targetId: 'med-1',
            reason: 'OTHER',
            detail: 'x'.repeat(4001),
        }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'detail must be 4000 characters or fewer' });
    });

    it('returns 404 when the reported target does not exist', async () => {
        mockAuth(LISTENER_SESSION);
        const mockPrisma = mockDb({
            meditation: { count: vi.fn().mockResolvedValue(0) },
        });

        const { POST } = await import('../route');
        const res = await POST(fileReport({ targetType: 'MEDITATION', targetId: 'nope', reason: 'SAFETY' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Report target not found' });
        expect(mockPrisma.report.create).not.toHaveBeenCalled();
    });

    it('checks the right table for each target type', async () => {
        mockAuth(LISTENER_SESSION);
        const mockPrisma = mockDb();

        const { POST } = await import('../route');
        await POST(fileReport({ targetType: 'SESSION', targetId: 'sess-1', reason: 'SAFETY' }));

        expect(mockPrisma.scheduledSession.count).toHaveBeenCalledWith({ where: { id: 'sess-1' } });
        expect(mockPrisma.meditation.count).not.toHaveBeenCalled();
    });

    it('returns 404 when the reporter has no user row', async () => {
        mockAuth(LISTENER_SESSION);
        mockDb({
            user: { findUnique: vi.fn().mockResolvedValue(null), count: vi.fn() },
        });

        const { POST } = await import('../route');
        const res = await POST(fileReport({ targetType: 'MEDITATION', targetId: 'med-1', reason: 'SAFETY' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'User not found' });
    });

    it('returns 400 on an unparseable body', async () => {
        mockAuth(LISTENER_SESSION);
        mockDb();

        const { POST } = await import('../route');
        const request = createRequest('/api/reports', { method: 'POST' });
        const res = await POST(request);
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Invalid JSON body' });
    });

    it('does not leak the raw error on a DB failure', async () => {
        mockAuth(LISTENER_SESSION);
        mockDb({
            report: {
                findFirst: vi.fn().mockResolvedValue(null),
                create: vi.fn().mockRejectedValue(
                    new Error('connect failed: postgresql://beacon:s3cr3t@db:5432/beacon'),
                ),
            },
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { POST } = await import('../route');
        const res = await POST(fileReport({ targetType: 'MEDITATION', targetId: 'med-1', reason: 'SAFETY' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(500);
        expect(body).toEqual({ error: 'Failed to file report' });
        expect(JSON.stringify(body)).not.toContain('s3cr3t');
        expect(consoleError.mock.calls.flat().join(' ')).not.toContain('s3cr3t');

        consoleError.mockRestore();
    });
});
