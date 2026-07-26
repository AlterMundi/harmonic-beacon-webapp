import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequest, parseResponse, mockParams } from '@/__tests__/helpers';

const ADMIN_SESSION = {
    user: { id: 'zitadel-admin-1', email: 'admin@example.com', name: 'Admin', role: 'ADMIN' },
};

function mockAuth(session: unknown) {
    vi.doMock('@/auth', () => ({ auth: vi.fn().mockResolvedValue(session) }));
}

function mockDb(
    report: Record<string, unknown> | null = {
        id: 'report-1',
        status: 'OPEN',
        acknowledgedAt: null,
        resolvedAt: null,
    },
    overrides: Record<string, unknown> = {},
) {
    const mockPrisma = {
        report: {
            findUnique: vi.fn().mockResolvedValue(report),
            update: vi.fn().mockImplementation(({ data }) =>
                Promise.resolve({ id: 'report-1', resolution: null, ...data }),
            ),
        },
        user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-admin-1' }) },
        auditLog: { create: vi.fn().mockResolvedValue({}) },
        ...overrides,
    };
    vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
    return mockPrisma;
}

function triage(body: unknown) {
    return createRequest('/api/admin/reports/report-1', { method: 'PATCH', body });
}

describe('PATCH /api/admin/reports/[id]', () => {
    beforeEach(() => {
        vi.resetModules();
    });

    it('returns 401 when not authenticated', async () => {
        mockAuth(null);
        mockDb();

        const { PATCH } = await import('../route');
        const res = await PATCH(triage({ status: 'TRIAGED' }), mockParams({ id: 'report-1' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(401);
        expect(body).toEqual({ error: 'Authentication required' });
    });

    it('returns 403 for a LISTENER', async () => {
        mockAuth({ user: { id: 'zitadel-l-1', email: 'l@example.com', name: 'L', role: 'LISTENER' } });
        const mockPrisma = mockDb();

        const { PATCH } = await import('../route');
        const res = await PATCH(triage({ status: 'TRIAGED' }), mockParams({ id: 'report-1' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(403);
        expect(body).toEqual({ error: 'Insufficient permissions' });
        expect(mockPrisma.report.update).not.toHaveBeenCalled();
    });

    it('returns 403 for a PROVIDER', async () => {
        mockAuth({ user: { id: 'zitadel-p-1', email: 'p@example.com', name: 'P', role: 'PROVIDER' } });
        mockDb();

        const { PATCH } = await import('../route');
        const res = await PATCH(triage({ status: 'DISMISSED' }), mockParams({ id: 'report-1' }));

        expect(res.status).toBe(403);
    });

    it('stamps acknowledgedAt on the first move off OPEN', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb();

        const { PATCH } = await import('../route');
        const res = await PATCH(triage({ status: 'TRIAGED' }), mockParams({ id: 'report-1' }));

        expect(res.status).toBe(200);
        const call = mockPrisma.report.update.mock.calls[0][0];
        expect(call.data.status).toBe('TRIAGED');
        expect(call.data.acknowledgedAt).toBeInstanceOf(Date);
        expect(call.data.resolvedAt).toBeNull();
        expect(call.data.handledById).toBe('db-admin-1');
    });

    it('does not stamp acknowledgedAt on a no-op OPEN to OPEN write', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb();

        const { PATCH } = await import('../route');
        await PATCH(triage({ status: 'OPEN' }), mockParams({ id: 'report-1' }));

        expect(mockPrisma.report.update.mock.calls[0][0].data.acknowledgedAt).toBeNull();
    });

    it('never overwrites an existing acknowledgedAt', async () => {
        const firstSeen = new Date('2026-07-20T08:00:00.000Z');
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb({
            id: 'report-1',
            status: 'TRIAGED',
            acknowledgedAt: firstSeen,
            resolvedAt: null,
        });

        const { PATCH } = await import('../route');
        await PATCH(triage({ status: 'RESOLVED', resolution: 'Content hidden.' }), mockParams({ id: 'report-1' }));

        expect(mockPrisma.report.update.mock.calls[0][0].data.acknowledgedAt).toBe(firstSeen);
    });

    it('sets resolvedAt on RESOLVED and records the resolution', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb();

        const { PATCH } = await import('../route');
        const res = await PATCH(
            triage({ status: 'RESOLVED', resolution: 'Meditation hidden pending rewrite.' }),
            mockParams({ id: 'report-1' }),
        );

        expect(res.status).toBe(200);
        const call = mockPrisma.report.update.mock.calls[0][0];
        expect(call.data.resolvedAt).toBeInstanceOf(Date);
        expect(call.data.resolution).toBe('Meditation hidden pending rewrite.');
    });

    it('sets resolvedAt on DISMISSED too', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb();

        const { PATCH } = await import('../route');
        await PATCH(triage({ status: 'DISMISSED' }), mockParams({ id: 'report-1' }));

        expect(mockPrisma.report.update.mock.calls[0][0].data.resolvedAt).toBeInstanceOf(Date);
    });

    it('clears resolvedAt when a closed report is reopened', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb({
            id: 'report-1',
            status: 'RESOLVED',
            acknowledgedAt: new Date('2026-07-20T08:00:00.000Z'),
            resolvedAt: new Date('2026-07-21T08:00:00.000Z'),
        });

        const { PATCH } = await import('../route');
        await PATCH(triage({ status: 'OPEN' }), mockParams({ id: 'report-1' }));

        expect(mockPrisma.report.update.mock.calls[0][0].data.resolvedAt).toBeNull();
    });

    it('writes an audit entry recording the transition and the role snapshot', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb();

        const { PATCH } = await import('../route');
        await PATCH(
            triage({ status: 'RESOLVED', resolution: 'Provider warned.' }),
            mockParams({ id: 'report-1' }),
        );

        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
            data: {
                actorId: 'db-admin-1',
                actorRole: 'ADMIN',
                action: 'report.triage',
                targetType: 'REPORT',
                targetId: 'report-1',
                metadata: {
                    previousStatus: 'OPEN',
                    newStatus: 'RESOLVED',
                    acknowledged: true,
                    resolution: 'Provider warned.',
                },
            },
        });
    });

    it('still triages when the audit write fails', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb(undefined, {
            auditLog: { create: vi.fn().mockRejectedValue(new Error('audit table unreachable')) },
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

        const { PATCH } = await import('../route');
        const res = await PATCH(triage({ status: 'TRIAGED' }), mockParams({ id: 'report-1' }));

        expect(res.status).toBe(200);
        expect(mockPrisma.report.update).toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();

        consoleError.mockRestore();
    });

    it('returns 404 for an unknown report', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb(null);

        const { PATCH } = await import('../route');
        const res = await PATCH(triage({ status: 'TRIAGED' }), mockParams({ id: 'nope' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(404);
        expect(body).toEqual({ error: 'Report not found' });
        expect(mockPrisma.report.update).not.toHaveBeenCalled();
    });

    it('rejects an unknown status', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb();

        const { PATCH } = await import('../route');
        const res = await PATCH(triage({ status: 'CLOSED' }), mockParams({ id: 'report-1' }));
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'status must be one of OPEN, TRIAGED, RESOLVED, DISMISSED' });
        expect(mockPrisma.report.update).not.toHaveBeenCalled();
    });

    it('rejects a missing status', async () => {
        mockAuth(ADMIN_SESSION);
        mockDb();

        const { PATCH } = await import('../route');
        const res = await PATCH(triage({ resolution: 'looks fine' }), mockParams({ id: 'report-1' }));

        expect(res.status).toBe(400);
    });

    it('rejects an oversized resolution', async () => {
        mockAuth(ADMIN_SESSION);
        mockDb();

        const { PATCH } = await import('../route');
        const res = await PATCH(
            triage({ status: 'RESOLVED', resolution: 'x'.repeat(4001) }),
            mockParams({ id: 'report-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'resolution must be 4000 characters or fewer' });
    });

    it('leaves resolution untouched when the field is absent', async () => {
        mockAuth(ADMIN_SESSION);
        const mockPrisma = mockDb();

        const { PATCH } = await import('../route');
        await PATCH(triage({ status: 'TRIAGED' }), mockParams({ id: 'report-1' }));

        expect(mockPrisma.report.update.mock.calls[0][0].data).not.toHaveProperty('resolution');
    });

    it('returns 400 on an unparseable body', async () => {
        mockAuth(ADMIN_SESSION);
        mockDb();

        const { PATCH } = await import('../route');
        const res = await PATCH(
            createRequest('/api/admin/reports/report-1', { method: 'PATCH' }),
            mockParams({ id: 'report-1' }),
        );
        const { status, body } = await parseResponse(res);

        expect(status).toBe(400);
        expect(body).toEqual({ error: 'Invalid JSON body' });
    });
});
