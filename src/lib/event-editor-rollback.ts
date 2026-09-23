import { Prisma, type PrismaClient } from '@prisma/client';

/** Conservative one-way boundary: old binaries cannot interpret editor state. */
export async function verifyEventEditorRollbackSafety(prisma: Pick<PrismaClient, '$transaction'>) {
    return prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '30s'");
        await tx.$executeRawUnsafe('LOCK TABLE "scheduled_sessions", "audit_logs" IN ACCESS EXCLUSIVE MODE');
        // to_jsonb also works before the additive editor migration exists.
        const rows = await tx.$queryRawUnsafe<Array<{ incompatible: boolean }>>(`
            SELECT (
                EXISTS (SELECT 1 FROM "scheduled_sessions" s
                    WHERE to_jsonb(s)->>'is_published' = 'false'
                       OR to_jsonb(s)->>'checkout_url' IS NOT NULL)
                OR EXISTS (SELECT 1 FROM "audit_logs"
                    WHERE "action" IN ('event.created', 'event.updated'))
            ) AS incompatible
        `);
        if (rows.length !== 1 || rows[0].incompatible !== false) {
            throw new Error('event_editor_old_binary_rollback_refused');
        }
        return { eligibleForOldBinaryRollback: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 30_000, timeout: 60_000 });
}
