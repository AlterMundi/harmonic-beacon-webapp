import { prisma } from '@/lib/db';

const DAY_MS = 24 * 60 * 60 * 1_000;

/** Conservative bounded retention; never removes canonical product accounts. */
export async function cleanupAccountAuthorityRecords(now = new Date(), limit = 500): Promise<void> {
    const rateCutoff = new Date(now.getTime() - DAY_MS);
    const auditCutoff = new Date(now.getTime() - 7 * DAY_MS);
    const bounded = Math.max(1, Math.min(limit, 1_000));
    await prisma.$executeRaw`
            DELETE FROM "beacon_account_auth_throttles" WHERE "key" IN (
                SELECT "key" FROM "beacon_account_auth_throttles"
                WHERE "updated_at" < ${rateCutoff}
                  AND ("blocked_until" IS NULL OR "blocked_until" < ${now})
                ORDER BY "updated_at" ASC LIMIT ${bounded}
            )`;
    await prisma.$executeRaw`
            DELETE FROM "beacon_account_action_tokens" WHERE "id" IN (
                SELECT "id" FROM "beacon_account_action_tokens"
                WHERE ("consumed_at" < ${auditCutoff} OR "expires_at" < ${auditCutoff})
                ORDER BY "expires_at" ASC LIMIT ${bounded}
            )`;
    await prisma.$executeRaw`
            DELETE FROM "beacon_oauth_access_tokens" WHERE "id" IN (
                SELECT "id" FROM "beacon_oauth_access_tokens"
                WHERE "expires_at" < ${auditCutoff} ORDER BY "expires_at" ASC LIMIT ${bounded}
            )`;
    await prisma.$executeRaw`
            DELETE FROM "beacon_oauth_refresh_tokens" WHERE "id" IN (
                SELECT "id" FROM "beacon_oauth_refresh_tokens"
                WHERE ("revoked" < ${auditCutoff} OR "expires_at" < ${auditCutoff})
                ORDER BY "expires_at" ASC LIMIT ${bounded}
            )`;
    await prisma.$executeRaw`
            DELETE FROM "listener_account_sessions" WHERE "id" IN (
                SELECT "id" FROM "listener_account_sessions"
                WHERE "expires_at" < ${auditCutoff} ORDER BY "expires_at" ASC LIMIT ${bounded}
            )`;
    await prisma.$executeRaw`
            DELETE FROM "early_bird_auth_sessions" WHERE "id" IN (
                SELECT "id" FROM "early_bird_auth_sessions"
                WHERE "expires_at" < ${auditCutoff} ORDER BY "expires_at" ASC LIMIT ${bounded}
            )`;
}
