import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The two properties that matter for `recordAuditEvent`:
 *
 *   1. It records actor, action, target, and non-PII reason metadata in one
 *      append-only row — the weekend schema carries no role snapshot or
 *      zitadel indirection, the actor is the staff user id directly.
 *   2. It never throws. A failed audit write must not fail the admission
 *      mutation it describes. Both directions are tested: the swallow, and
 *      the fact that the failure is still visible on stderr rather than
 *      silent.
 */

describe('recordAuditEvent', () => {
    let consoleError: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.resetModules();
        consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleError.mockRestore();
    });

    function mockDb(overrides: Record<string, unknown> = {}) {
        const mockPrisma = {
            auditLog: { create: vi.fn().mockResolvedValue({}) },
            ...overrides,
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        return mockPrisma;
    }

    it('writes actor, action, target, reason, and metadata', async () => {
        const mockPrisma = mockDb();

        const { recordAuditEvent } = await import('../audit');
        await recordAuditEvent({
            actorUserId: 'staff-uuid-1',
            action: 'ticket.revoke',
            targetType: 'TICKET_ENTITLEMENT',
            targetId: 'entitlement-uuid-1',
            reason: 'support case 42: duplicate purchase',
            metadata: { last4: 'AB3F', tier: 'GLOBAL_NORTH' },
        });

        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
            data: {
                actorUserId: 'staff-uuid-1',
                action: 'ticket.revoke',
                targetType: 'TICKET_ENTITLEMENT',
                targetId: 'entitlement-uuid-1',
                reason: 'support case 42: duplicate purchase',
                metadata: { last4: 'AB3F', tier: 'GLOBAL_NORTH' },
            },
        });
    });

    it('omits reason and metadata when not supplied, and allows a null CLI actor', async () => {
        const mockPrisma = mockDb();

        const { recordAuditEvent } = await import('../audit');
        await recordAuditEvent({
            actorUserId: null,
            action: 'ticket.batch_generate',
            targetType: 'SCHEDULED_SESSION',
            targetId: 'session-uuid-1',
        });

        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
            data: {
                actorUserId: null,
                action: 'ticket.batch_generate',
                targetType: 'SCHEDULED_SESSION',
                targetId: 'session-uuid-1',
            },
        });
    });

    it('swallows a database failure and reports it on stderr instead of throwing', async () => {
        mockDb({
            auditLog: { create: vi.fn().mockRejectedValue(new Error('connection reset')) },
        });

        const { recordAuditEvent } = await import('../audit');
        await expect(
            recordAuditEvent({
                actorUserId: 'staff-uuid-1',
                action: 'ticket.rebind',
                targetType: 'TICKET_ENTITLEMENT',
                targetId: 'entitlement-uuid-1',
                reason: 'typo in purchase email',
            }),
        ).resolves.toBeUndefined();

        expect(consoleError).toHaveBeenCalledWith(
            expect.stringContaining('ticket.rebind'),
            expect.anything(),
        );
    });
});
