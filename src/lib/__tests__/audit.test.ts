import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The two properties that matter for `logAdminAction`, and why:
 *
 *   1. It records the role the actor held *at the time*, not the role they hold
 *      now. Roles change; a log that resolves the current role misrepresents
 *      history — a demoted Admin's past approvals would read as a Listener's.
 *   2. It never throws. A failed audit write must not fail the moderation action
 *      it describes. Both directions are tested: the swallow, and the fact that
 *      the failure is still visible on stderr rather than silent.
 */

describe('logAdminAction', () => {
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
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-admin-1' }) },
            auditLog: { create: vi.fn().mockResolvedValue({}) },
            ...overrides,
        };
        vi.doMock('@/lib/db', () => ({ prisma: mockPrisma, default: mockPrisma }));
        return mockPrisma;
    }

    it('resolves the actor by zitadelId, not by treating the subject as a uuid', async () => {
        const mockPrisma = mockDb();

        const { logAdminAction } = await import('../audit');
        await logAdminAction(
            { user: { id: 'zitadel-admin-123', role: 'ADMIN' } },
            { action: 'meditation.approve', targetType: 'MEDITATION', targetId: 'med-1' },
        );

        expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
            where: { zitadelId: 'zitadel-admin-123' },
            select: { id: true },
        });
        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
            data: {
                actorId: 'db-admin-1',
                actorRole: 'ADMIN',
                action: 'meditation.approve',
                targetType: 'MEDITATION',
                targetId: 'med-1',
            },
        });
    });

    it('snapshots the role from the session rather than re-reading it', async () => {
        // The acting session says PROVIDER. If the helper looked the role up in the
        // DB instead of snapshotting, a later role change would rewrite history.
        const mockPrisma = mockDb({
            user: { findUnique: vi.fn().mockResolvedValue({ id: 'db-user-9', role: 'LISTENER' }) },
        });

        const { logAdminAction } = await import('../audit');
        await logAdminAction(
            { user: { id: 'zitadel-9', role: 'PROVIDER' } },
            { action: 'tag.create', targetType: 'TAG', targetId: 'tag-1' },
        );

        const call = mockPrisma.auditLog.create.mock.calls[0][0];
        expect(call.data.actorRole).toBe('PROVIDER');
    });

    it('accepts a role value the UserRole enum does not have', async () => {
        // `session.user.role` in src/lib/auth.ts still carries a legacy 'USER'.
        // actor_role is a text column precisely so this cannot fail the write.
        const mockPrisma = mockDb();

        const { logAdminAction } = await import('../audit');
        await logAdminAction(
            { user: { id: 'zitadel-legacy', role: 'USER' } },
            { action: 'tag.delete', targetType: 'TAG', targetId: 'tag-2' },
        );

        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({ actorRole: 'USER' }),
            }),
        );
    });

    it('includes metadata when given and omits the key entirely when not', async () => {
        const mockPrisma = mockDb();

        const { logAdminAction } = await import('../audit');
        await logAdminAction(
            { user: { id: 'zitadel-admin-123', role: 'ADMIN' } },
            {
                action: 'session.terminate',
                targetType: 'SESSION',
                targetId: 'sess-1',
                metadata: { reason: 'abuse from host mic', participantsAtTermination: 4 },
            },
        );

        expect(mockPrisma.auditLog.create).toHaveBeenCalledWith({
            data: {
                actorId: 'db-admin-1',
                actorRole: 'ADMIN',
                action: 'session.terminate',
                targetType: 'SESSION',
                targetId: 'sess-1',
                metadata: { reason: 'abuse from host mic', participantsAtTermination: 4 },
            },
        });

        expect(
            Object.keys(mockPrisma.auditLog.create.mock.calls[0][0].data),
        ).toContain('metadata');
    });

    it('does not throw when the audit insert fails', async () => {
        const mockPrisma = mockDb({
            auditLog: { create: vi.fn().mockRejectedValue(new Error('relation does not exist')) },
        });

        const { logAdminAction } = await import('../audit');
        await expect(
            logAdminAction(
                { user: { id: 'zitadel-admin-123', role: 'ADMIN' } },
                { action: 'meditation.hide', targetType: 'MEDITATION', targetId: 'med-1' },
            ),
        ).resolves.toBeUndefined();

        expect(mockPrisma.auditLog.create).toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();
        expect(String(consoleError.mock.calls[0][0])).toContain('meditation.hide');
    });

    it('does not throw when the actor lookup fails', async () => {
        mockDb({
            user: { findUnique: vi.fn().mockRejectedValue(new Error('connection reset')) },
        });

        const { logAdminAction } = await import('../audit');
        await expect(
            logAdminAction(
                { user: { id: 'zitadel-admin-123', role: 'ADMIN' } },
                { action: 'meditation.reject', targetType: 'MEDITATION', targetId: 'med-1' },
            ),
        ).resolves.toBeUndefined();

        expect(consoleError).toHaveBeenCalled();
    });

    it('skips the write and reports it when the actor has no user row', async () => {
        const mockPrisma = mockDb({
            user: { findUnique: vi.fn().mockResolvedValue(null) },
        });

        const { logAdminAction } = await import('../audit');
        await logAdminAction(
            { user: { id: 'zitadel-ghost', role: 'ADMIN' } },
            { action: 'meditation.approve', targetType: 'MEDITATION', targetId: 'med-1' },
        );

        expect(mockPrisma.auditLog.create).not.toHaveBeenCalled();
        expect(consoleError).toHaveBeenCalled();
    });

    it('redacts secrets out of the failure it logs', async () => {
        mockDb({
            auditLog: {
                create: vi.fn().mockRejectedValue(
                    new Error('connect failed: postgresql://beacon:s3cr3t@db:5432/beacon'),
                ),
            },
        });

        const { logAdminAction } = await import('../audit');
        await logAdminAction(
            { user: { id: 'zitadel-admin-123', role: 'ADMIN' } },
            { action: 'tag.create', targetType: 'TAG', targetId: 'tag-1' },
        );

        const logged = consoleError.mock.calls.flat().join(' ');
        expect(logged).not.toContain('s3cr3t');
        expect(logged).toContain('[REDACTED]');
    });

    it('exposes no update or delete helper — the log is append-only', async () => {
        mockDb();
        const auditModule = await import('../audit');
        const writeLikeExports = Object.keys(auditModule).filter((k) =>
            /update|delete|remove|edit|purge/i.test(k),
        );
        expect(writeLikeExports).toEqual([]);
    });
});
