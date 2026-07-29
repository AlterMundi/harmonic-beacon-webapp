import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { createRequest, parseResponse } from '@/__tests__/helpers';

/**
 * /api/ops/admission: staff-only lookup, batch generation/import, and
 * comp/override issuance.
 *
 * Auth is exercised through the real cookie path: the mocked WebSession row
 * decides who the caller is — staff role, attendee (ticket session), or
 * nobody — so the tests prove both that attendees cannot read or mutate
 * admission data and that each role gets exactly its permitted operations.
 */

const PEPPER = 'test-pepper-test-pepper-test-pepper-32';
const SESSION_ID = '3f6b1a2e-1234-4abc-9def-0123456789ab';

const staffRow = (role: string) => ({
    id: `staff-${role.toLowerCase()}`,
    email: `${role.toLowerCase()}@harmonicbeacon.com`,
    name: role,
    role,
    disabledAt: null,
});

const staffSession = (role: string) => ({
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    staffUser: staffRow(role),
});

const attendeeSession = {
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    staffUser: null,
};

const eventRow = {
    id: SESSION_ID,
    title: 'Saturday Session',
    language: 'ENGLISH',
    scheduledAt: new Date('2026-08-01T18:00:00Z'),
    attendeeCap: 150,
};

const entitlementRow = {
    id: '8c9d0e1f-1234-4abc-9def-0123456789ab',
    state: 'BOUND',
    tier: 'GLOBAL_NORTH',
    codeLastFour: 'AB3F',
    boundEmail: 'buyer@example.com',
    boundAt: new Date('2026-07-29T00:00:00Z'),
    expiresAt: new Date('2026-08-02T18:00:00Z'),
    revokedAt: null,
    revocationReason: null,
    createdAt: new Date('2026-07-28T00:00:00Z'),
    scheduledSession: eventRow,
};

function authed(url: string, options: Parameters<typeof createRequest>[1] = {}) {
    return createRequest(url, {
        ...options,
        headers: { cookie: 'hb_session=token', ...(options.headers ?? {}) },
    });
}

type MockFn = ReturnType<typeof vi.fn>;
type MockPrisma = {
    webSession: { findUnique: MockFn };
    ticketEntitlement: {
        findUnique: MockFn;
        findMany: MockFn;
        count: MockFn;
        create: MockFn;
        createMany: MockFn;
    };
    scheduledSession: { findUnique: MockFn };
    auditLog: { create: MockFn };
    $transaction: MockFn;
};

describe('/api/ops/admission', () => {
    let mockPrisma: MockPrisma;

    beforeEach(() => {
        vi.resetModules();
        process.env.TICKET_CODE_PEPPER = PEPPER;
        mockPrisma = {
            webSession: { findUnique: vi.fn().mockResolvedValue(staffSession('ADMIN')) },
            ticketEntitlement: {
                findUnique: vi.fn().mockResolvedValue(null),
                findMany: vi.fn().mockResolvedValue([]),
                count: vi.fn().mockResolvedValue(0),
                create: vi.fn().mockImplementation(async ({ data }) => ({ id: 'new-entitlement-id', ...data })),
                createMany: vi.fn().mockImplementation(async ({ data }) => ({ count: data.length })),
            },
            scheduledSession: { findUnique: vi.fn().mockResolvedValue(eventRow) },
            auditLog: { create: vi.fn().mockResolvedValue({}) },
            $transaction: vi.fn().mockImplementation(async (arg: unknown) =>
                Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(mockPrisma)),
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
    });

    afterEach(() => {
        delete process.env.TICKET_CODE_PEPPER;
    });

    async function loadRoute() {
        return import('../route');
    }

    describe('authentication', () => {
        it('rejects an unauthenticated lookup with 401', async () => {
            mockPrisma.webSession.findUnique.mockResolvedValue(null);
            const { GET } = await loadRoute();
            const { status } = await parseResponse(await GET(createRequest('http://localhost/api/ops/admission?q=AB3F')));
            expect(status).toBe(401);
        });

        it('rejects an attendee ticket session on lookup', async () => {
            mockPrisma.webSession.findUnique.mockResolvedValue(attendeeSession);
            const { GET } = await loadRoute();
            const { status } = await parseResponse(await GET(authed('http://localhost/api/ops/admission?q=AB3F')));
            expect(status).toBe(401);
        });

        it('rejects an attendee ticket session on mutation', async () => {
            mockPrisma.webSession.findUnique.mockResolvedValue(attendeeSession);
            const { POST } = await loadRoute();
            const { status } = await parseResponse(await POST(authed('http://localhost/api/ops/admission', {
                method: 'POST',
                body: { action: 'generate', sessionId: SESSION_ID, tier: 'GLOBAL_NORTH', count: 1 },
            })));
            expect(status).toBe(401);
            expect(mockPrisma.ticketEntitlement.createMany).not.toHaveBeenCalled();
        });
    });

    describe('lookup', () => {
        it('finds entitlements by normalized email', async () => {
            mockPrisma.ticketEntitlement.findMany.mockResolvedValue([entitlementRow]);
            const { GET } = await loadRoute();
            const { status, body } = await parseResponse(
                await GET(authed('http://localhost/api/ops/admission?q=%20Buyer@Example.COM%20')),
            );
            expect(status).toBe(200);
            expect(mockPrisma.ticketEntitlement.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { boundEmail: 'buyer@example.com' } }),
            );
            const results = (body as { results: unknown[] }).results;
            expect(results).toHaveLength(1);
            expect(results[0]).toMatchObject({
                state: 'BOUND',
                tier: 'GLOBAL_NORTH',
                boundEmail: 'buyer@example.com',
                codeLastFour: 'AB3F',
                event: { title: 'Saturday Session' },
            });
        });

        it('finds entitlements by code last-four, uppercased', async () => {
            mockPrisma.ticketEntitlement.findMany.mockResolvedValue([entitlementRow]);
            const { GET } = await loadRoute();
            const { status } = await parseResponse(await GET(authed('http://localhost/api/ops/admission?q=ab3f')));
            expect(status).toBe(200);
            expect(mockPrisma.ticketEntitlement.findMany).toHaveBeenCalledWith(
                expect.objectContaining({ where: { codeLastFour: 'AB3F' } }),
            );
        });

        it('finds a single entitlement by UUID, 404 when absent', async () => {
            const { GET } = await loadRoute();
            const missing = await parseResponse(await GET(authed(`http://localhost/api/ops/admission?q=${entitlementRow.id}`)));
            expect(missing.status).toBe(404);

            mockPrisma.ticketEntitlement.findUnique.mockResolvedValue(entitlementRow);
            const found = await parseResponse(await GET(authed(`http://localhost/api/ops/admission?q=${entitlementRow.id}`)));
            expect(found.status).toBe(200);
        });

        it('allows a facilitator to look tickets up', async () => {
            mockPrisma.webSession.findUnique.mockResolvedValue(staffSession('FACILITATOR'));
            mockPrisma.ticketEntitlement.findMany.mockResolvedValue([]);
            const { GET } = await loadRoute();
            const { status } = await parseResponse(await GET(authed('http://localhost/api/ops/admission?q=AB3F')));
            expect(status).toBe(200);
        });

        it('rejects a malformed query', async () => {
            const { GET } = await loadRoute();
            const { status } = await parseResponse(await GET(authed('http://localhost/api/ops/admission?q=hello')));
            expect(status).toBe(400);
        });
    });

    describe('generate', () => {
        function generateBody(count = 3) {
            return { action: 'generate', sessionId: SESSION_ID, tier: 'GLOBAL_NORTH', count };
        }

        it('creates digests only and returns the one-time CSV export', async () => {
            const { POST } = await loadRoute();
            const { status, body } = await parseResponse(
                await POST(authed('http://localhost/api/ops/admission', { method: 'POST', body: generateBody(3) })),
            );
            expect(status).toBe(201);

            const created = mockPrisma.ticketEntitlement.createMany.mock.calls[0][0].data;
            expect(created).toHaveLength(3);
            for (const row of created) {
                expect(row.codeDigest).toMatch(/^[0-9a-f]{64}$/);
                expect(row.codeLastFour).toMatch(/^[A-Z2-9]{4}$/);
                expect(row).not.toHaveProperty('code');
                expect(row.tier).toBe('GLOBAL_NORTH');
                expect(row.issuedByUserId).toBe('staff-admin');
            }

            const csv = (body as { csv: string }).csv;
            const lines = csv.trim().split('\n');
            expect(lines[0]).toBe('code,tier,event,url');
            expect(lines).toHaveLength(4);
            expect(lines[1]).toContain('GLOBAL_NORTH');
            expect(lines[1]).toContain('Saturday Session');
            // The exported plaintext code matches the stored digest/last-four.
            const exportedCode = lines[1].split(',')[0];
            expect(exportedCode.endsWith(created[0].codeLastFour)).toBe(true);

            expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    actorUserId: 'staff-admin',
                    action: 'ticket.batch_generate',
                    targetType: 'SCHEDULED_SESSION',
                    targetId: SESSION_ID,
                    metadata: { tier: 'GLOBAL_NORTH', count: 3 },
                }),
            });
        });

        it('rejects a batch that would exceed the 150-attendee cap', async () => {
            mockPrisma.ticketEntitlement.count.mockResolvedValue(149);
            const { POST } = await loadRoute();
            const { status, body } = await parseResponse(
                await POST(authed('http://localhost/api/ops/admission', { method: 'POST', body: generateBody(2) })),
            );
            expect(status).toBe(409);
            expect((body as { error: string }).error).toBe('cap_exceeded');
            expect(mockPrisma.ticketEntitlement.createMany).not.toHaveBeenCalled();
        });

        it('allows a batch that fills the cap exactly', async () => {
            mockPrisma.ticketEntitlement.count.mockResolvedValue(148);
            const { POST } = await loadRoute();
            const { status } = await parseResponse(
                await POST(authed('http://localhost/api/ops/admission', { method: 'POST', body: generateBody(2) })),
            );
            expect(status).toBe(201);
        });

        it('denies OPERATOR and FACILITATOR batch generation', async () => {
            for (const role of ['OPERATOR', 'FACILITATOR']) {
                mockPrisma.webSession.findUnique.mockResolvedValue(staffSession(role));
                const { POST } = await loadRoute();
                const { status } = await parseResponse(
                    await POST(authed('http://localhost/api/ops/admission', { method: 'POST', body: generateBody(1) })),
                );
                expect(status).toBe(403);
            }
        });
    });

    describe('import', () => {
        const csv = 'code,tier\nAAAA-BBBB-CCCC-DDDD,GLOBAL_SOUTH\nEEEE-FFFF-GGGG-HHHH,GLOBAL_SOUTH\n';

        it('imports codes idempotently via digest skip-duplicates', async () => {
            mockPrisma.ticketEntitlement.createMany.mockResolvedValue({ count: 1 });
            const { POST } = await loadRoute();
            const { status, body } = await parseResponse(
                await POST(authed('http://localhost/api/ops/admission', {
                    method: 'POST',
                    body: { action: 'import', sessionId: SESSION_ID, tier: 'GLOBAL_SOUTH', csv },
                })),
            );
            expect(status).toBe(201);
            expect(body).toMatchObject({ created: 1, skipped: 1 });
            expect(mockPrisma.ticketEntitlement.createMany).toHaveBeenCalledWith(
                expect.objectContaining({ skipDuplicates: true }),
            );
            expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
                data: expect.objectContaining({ action: 'ticket.batch_import' }),
            });
        });

        it('enforces the cap for imports too', async () => {
            mockPrisma.ticketEntitlement.count.mockResolvedValue(150);
            const { POST } = await loadRoute();
            const { status } = await parseResponse(
                await POST(authed('http://localhost/api/ops/admission', {
                    method: 'POST',
                    body: { action: 'import', sessionId: SESSION_ID, tier: 'GLOBAL_SOUTH', csv },
                })),
            );
            expect(status).toBe(409);
        });

        it('rejects malformed CSV', async () => {
            const { POST } = await loadRoute();
            const { status, body } = await parseResponse(
                await POST(authed('http://localhost/api/ops/admission', {
                    method: 'POST',
                    body: { action: 'import', sessionId: SESSION_ID, tier: 'GLOBAL_SOUTH', csv: 'garbage' },
                })),
            );
            expect(status).toBe(400);
            expect((body as { error: string }).error).toBe('invalid_csv');
        });
    });

    describe('comp/override issuance', () => {
        it('issues a comp entitlement for ADMIN with a one-time CSV', async () => {
            const { POST } = await loadRoute();
            const { status, body } = await parseResponse(
                await POST(authed('http://localhost/api/ops/admission', {
                    method: 'POST',
                    body: { action: 'comp', sessionId: SESSION_ID, tier: 'COMP', reason: 'press guest, producer approved' },
                })),
            );
            expect(status).toBe(201);

            const created = mockPrisma.ticketEntitlement.create.mock.calls[0][0].data;
            expect(created.tier).toBe('COMP');
            expect(created.codeDigest).toMatch(/^[0-9a-f]{64}$/);
            expect(created).not.toHaveProperty('code');
            // Scoped to the one event and expiring after it.
            expect(created.scheduledSessionId).toBe(SESSION_ID);
            expect(new Date(created.expiresAt).getTime()).toBeGreaterThan(eventRow.scheduledAt.getTime());

            expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    action: 'ticket.comp_issue',
                    reason: 'press guest, producer approved',
                    metadata: { tier: 'COMP' },
                }),
            });

            const csv = (body as { csv: string }).csv;
            expect(csv.trim().split('\n')).toHaveLength(2);
        });

        it('lets an OPERATOR issue only a documented SUPPORT_OVERRIDE', async () => {
            mockPrisma.webSession.findUnique.mockResolvedValue(staffSession('OPERATOR'));
            const { POST } = await loadRoute();

            const override = await parseResponse(await POST(authed('http://localhost/api/ops/admission', {
                method: 'POST',
                body: { action: 'comp', sessionId: SESSION_ID, tier: 'SUPPORT_OVERRIDE', reason: 'support case 7: buyer locked out' },
            })));
            expect(override.status).toBe(201);

            const comp = await parseResponse(await POST(authed('http://localhost/api/ops/admission', {
                method: 'POST',
                body: { action: 'comp', sessionId: SESSION_ID, tier: 'COMP', reason: 'press guest' },
            })));
            expect(comp.status).toBe(403);
        });

        it('denies a FACILITATOR any comp issuance', async () => {
            mockPrisma.webSession.findUnique.mockResolvedValue(staffSession('FACILITATOR'));
            const { POST } = await loadRoute();
            const { status } = await parseResponse(await POST(authed('http://localhost/api/ops/admission', {
                method: 'POST',
                body: { action: 'comp', sessionId: SESSION_ID, tier: 'SUPPORT_OVERRIDE', reason: 'support case 7' },
            })));
            expect(status).toBe(403);
        });

        it('requires a reason', async () => {
            const { POST } = await loadRoute();
            const { status, body } = await parseResponse(await POST(authed('http://localhost/api/ops/admission', {
                method: 'POST',
                body: { action: 'comp', sessionId: SESSION_ID, tier: 'COMP', reason: '  ' },
            })));
            expect(status).toBe(400);
            expect((body as { error: string }).error).toBe('reason_required');
        });

        it('counts the comp against the attendee cap', async () => {
            mockPrisma.ticketEntitlement.count.mockResolvedValue(150);
            const { POST } = await loadRoute();
            const { status } = await parseResponse(await POST(authed('http://localhost/api/ops/admission', {
                method: 'POST',
                body: { action: 'comp', sessionId: SESSION_ID, tier: 'COMP', reason: 'press guest' },
            })));
            expect(status).toBe(409);
        });
    });
});
