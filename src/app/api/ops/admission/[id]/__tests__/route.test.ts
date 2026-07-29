import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createRequest, mockParams, parseResponse } from '@/__tests__/helpers';

/**
 * /api/ops/admission/[id]: single-entitlement detail, revoke, and
 * clear/rebind. Both mutations demand a mandatory non-PII reason, are limited
 * to ADMIN and OPERATOR, and write an audit row; the tests also prove a
 * facilitator can never silently rebind a ticket.
 */

const ENTITLEMENT_ID = '8c9d0e1f-1234-4abc-9def-0123456789ab';

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

const entitlementRow = {
    id: ENTITLEMENT_ID,
    state: 'BOUND',
    tier: 'GLOBAL_NORTH',
    codeLastFour: 'AB3F',
    boundEmail: 'buyer@example.com',
    boundAt: new Date('2026-07-29T00:00:00Z'),
    expiresAt: new Date('2026-08-02T18:00:00Z'),
    revokedAt: null,
    revocationReason: null,
    createdAt: new Date('2026-07-28T00:00:00Z'),
    scheduledSession: {
        id: '3f6b1a2e-1234-4abc-9def-0123456789ab',
        title: 'Saturday Session',
        language: 'ENGLISH',
        scheduledAt: new Date('2026-08-01T18:00:00Z'),
    },
};

function authed(body: unknown) {
    return createRequest(`http://localhost/api/ops/admission/${ENTITLEMENT_ID}`, {
        method: 'POST',
        headers: { cookie: 'hb_session=token' },
        body,
    });
}

const params = mockParams({ id: ENTITLEMENT_ID });

type MockFn = ReturnType<typeof vi.fn>;
type MockPrisma = {
    webSession: { findUnique: MockFn; updateMany: MockFn };
    ticketEntitlement: { findUnique: MockFn; update: MockFn };
    auditLog: { create: MockFn };
    $transaction: MockFn;
};

describe('/api/ops/admission/[id]', () => {
    let mockPrisma: MockPrisma;

    beforeEach(() => {
        vi.resetModules();
        mockPrisma = {
            webSession: {
                findUnique: vi.fn().mockResolvedValue(staffSession('ADMIN')),
                updateMany: vi.fn().mockResolvedValue({ count: 1 }),
            },
            ticketEntitlement: {
                findUnique: vi.fn().mockResolvedValue(entitlementRow),
                update: vi.fn().mockImplementation(async ({ data }) => ({ id: ENTITLEMENT_ID, ...data })),
            },
            auditLog: { create: vi.fn().mockResolvedValue({}) },
            $transaction: vi.fn().mockImplementation(async (arg: unknown) =>
                Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(mockPrisma)),
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
    });

    async function loadRoute() {
        return import('../route');
    }

    describe('detail lookup', () => {
        it('returns state, bound email, tier, and event for staff', async () => {
            const { GET } = await loadRoute();
            const request = createRequest(`http://localhost/api/ops/admission/${ENTITLEMENT_ID}`, {
                headers: { cookie: 'hb_session=token' },
            });
            const { status, body } = await parseResponse(await GET(request, params));
            expect(status).toBe(200);
            expect((body as { entitlement: unknown }).entitlement).toMatchObject({
                id: ENTITLEMENT_ID,
                state: 'BOUND',
                tier: 'GLOBAL_NORTH',
                boundEmail: 'buyer@example.com',
                event: { title: 'Saturday Session' },
            });
        });

        it('rejects an attendee session', async () => {
            mockPrisma.webSession.findUnique.mockResolvedValue({
                revokedAt: null,
                expiresAt: new Date(Date.now() + 60_000),
                staffUser: null,
            });
            const { GET } = await loadRoute();
            const request = createRequest(`http://localhost/api/ops/admission/${ENTITLEMENT_ID}`, {
                headers: { cookie: 'hb_session=token' },
            });
            const { status } = await parseResponse(await GET(request, params));
            expect(status).toBe(401);
        });
    });

    describe('revoke', () => {
        it('revokes the entitlement and its live web sessions, audited', async () => {
            const { POST } = await loadRoute();
            const { status } = await parseResponse(
                await POST(authed({ action: 'revoke', reason: 'support case 9: refund issued' }), params),
            );
            expect(status).toBe(200);

            expect(mockPrisma.ticketEntitlement.update).toHaveBeenCalledWith({
                where: { id: ENTITLEMENT_ID },
                data: expect.objectContaining({
                    state: 'REVOKED',
                    revokedByUserId: 'staff-admin',
                    revocationReason: 'support case 9: refund issued',
                }),
            });
            // An already-issued attendee cookie must die with the ticket.
            expect(mockPrisma.webSession.updateMany).toHaveBeenCalledWith({
                where: { ticketEntitlementId: ENTITLEMENT_ID, revokedAt: null },
                data: expect.objectContaining({ revokedByUserId: 'staff-admin' }),
            });
            expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    actorUserId: 'staff-admin',
                    action: 'ticket.revoke',
                    targetType: 'TICKET_ENTITLEMENT',
                    targetId: ENTITLEMENT_ID,
                    reason: 'support case 9: refund issued',
                    // No bound email in the audit metadata.
                    metadata: { last4: 'AB3F', tier: 'GLOBAL_NORTH' },
                }),
            });
        });

        it('allows an OPERATOR to revoke', async () => {
            mockPrisma.webSession.findUnique.mockResolvedValue(staffSession('OPERATOR'));
            const { POST } = await loadRoute();
            const { status } = await parseResponse(
                await POST(authed({ action: 'revoke', reason: 'duplicate purchase' }), params),
            );
            expect(status).toBe(200);
        });

        it('refuses to revoke an already-revoked entitlement', async () => {
            mockPrisma.ticketEntitlement.findUnique.mockResolvedValue({ ...entitlementRow, state: 'REVOKED' });
            const { POST } = await loadRoute();
            const { status, body } = await parseResponse(
                await POST(authed({ action: 'revoke', reason: 'refund' }), params),
            );
            expect(status).toBe(409);
            expect((body as { error: string }).error).toBe('already_revoked');
        });

        it('requires a reason', async () => {
            const { POST } = await loadRoute();
            const { status, body } = await parseResponse(await POST(authed({ action: 'revoke' }), params));
            expect(status).toBe(400);
            expect((body as { error: string }).error).toBe('reason_required');
            expect(mockPrisma.ticketEntitlement.update).not.toHaveBeenCalled();
        });
    });

    describe('rebind', () => {
        it('clears the binding and returns the ticket to ISSUED, audited', async () => {
            const { POST } = await loadRoute();
            const { status, body } = await parseResponse(
                await POST(authed({ action: 'rebind', reason: 'buyer typoed email at purchase' }), params),
            );
            expect(status).toBe(200);

            expect(mockPrisma.ticketEntitlement.update).toHaveBeenCalledWith({
                where: { id: ENTITLEMENT_ID },
                data: expect.objectContaining({ boundEmail: null, boundAt: null, state: 'ISSUED' }),
                select: expect.anything(),
            });
            expect(body).toMatchObject({ state: 'ISSUED', boundEmail: null });
            expect(mockPrisma.webSession.updateMany).toHaveBeenCalledWith({
                where: { ticketEntitlementId: ENTITLEMENT_ID, revokedAt: null },
                data: expect.objectContaining({
                    revokedByUserId: 'staff-admin',
                    revocationReason: expect.stringContaining('buyer typoed email'),
                }),
            });

            const audit = mockPrisma.auditLog.create.mock.calls[0][0].data;
            expect(audit.action).toBe('ticket.rebind');
            expect(audit.reason).toBe('buyer typoed email at purchase');
            expect(audit.metadata).toEqual({ last4: 'AB3F', tier: 'GLOBAL_NORTH', cleared: true, hadBinding: true });
        });

        it('rebinds to a new normalized email and keeps the ticket BOUND', async () => {
            const { POST } = await loadRoute();
            const { status } = await parseResponse(
                await POST(authed({ action: 'rebind', email: '  NewBuyer@Example.COM ', reason: 'email transfer per terms' }), params),
            );
            expect(status).toBe(200);
            expect(mockPrisma.ticketEntitlement.update).toHaveBeenCalledWith({
                where: { id: ENTITLEMENT_ID },
                data: expect.objectContaining({ boundEmail: 'newbuyer@example.com', state: 'BOUND' }),
                select: expect.anything(),
            });
            expect(mockPrisma.webSession.updateMany).toHaveBeenCalledOnce();
        });

        it('never lets a FACILITATOR rebind or revoke', async () => {
            mockPrisma.webSession.findUnique.mockResolvedValue(staffSession('FACILITATOR'));
            const { POST } = await loadRoute();
            for (const action of ['rebind', 'revoke']) {
                const { status } = await parseResponse(
                    await POST(authed({ action, reason: 'attempted by facilitator' }), params),
                );
                expect(status).toBe(403);
            }
            expect(mockPrisma.ticketEntitlement.update).not.toHaveBeenCalled();
            expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
        });

        it('requires a reason for rebind', async () => {
            const { POST } = await loadRoute();
            const { status } = await parseResponse(await POST(authed({ action: 'rebind', reason: '' }), params));
            expect(status).toBe(400);
            expect(mockPrisma.ticketEntitlement.update).not.toHaveBeenCalled();
        });

        it('refuses to rebind a revoked entitlement', async () => {
            mockPrisma.ticketEntitlement.findUnique.mockResolvedValue({ ...entitlementRow, state: 'REVOKED' });
            const { POST } = await loadRoute();
            const { status } = await parseResponse(
                await POST(authed({ action: 'rebind', reason: 'mistake' }), params),
            );
            expect(status).toBe(409);
        });

        it('rejects an invalid replacement email', async () => {
            const { POST } = await loadRoute();
            const { status } = await parseResponse(
                await POST(authed({ action: 'rebind', email: 'not-an-email', reason: 'transfer' }), params),
            );
            expect(status).toBe(400);
        });
    });

    it('rejects unknown actions', async () => {
        const { POST } = await loadRoute();
        const { status } = await parseResponse(await POST(authed({ action: 'delete' }), params));
        expect(status).toBe(400);
    });
});
