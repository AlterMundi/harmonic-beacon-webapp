#!/usr/bin/env node

import { pathToFileURL } from 'node:url';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

export const PRODUCTION_ACCOUNT_ISSUER = 'https://account.harmonicbeacon.com';
export const PRODUCTION_DATABASE_NAME = 'beacon';
export const STAGING_ACCOUNT_ISSUER = 'https://account-staging.harmonicbeacon.com';
export const STAGING_DATABASE_NAME = 'beacon_live_staging';
export const RECEIPT_SCHEMA = 'live.account-attendance-email-backfill.v1' as const;
export type DeploymentTarget = 'production' | 'staging';

const TARGETS = {
    production: {
        accountIssuer: PRODUCTION_ACCOUNT_ISSUER,
        databaseName: PRODUCTION_DATABASE_NAME,
        markerName: 'LIVE_PRODUCTION_ENVIRONMENT',
        markerValue: 'production',
    },
    staging: {
        accountIssuer: STAGING_ACCOUNT_ISSUER,
        databaseName: STAGING_DATABASE_NAME,
        markerName: 'LIVE_STAGING_ENVIRONMENT',
        markerValue: 'live-staging',
    },
} as const;

type AggregateRow = {
    target_count: bigint | number;
    would_update_count: bigint | number;
    no_verified_source_count: bigint | number;
    ambiguous_source_count: bigint | number;
    over_limit_source_count: bigint | number;
    affected_feed_entry_count: bigint | number;
};

export type BackfillInspection = {
    targetCount: number;
    wouldUpdateCount: number;
    noVerifiedSourceCount: number;
    ambiguousSourceCount: number;
    overLimitSourceCount: number;
    affectedFeedEntryCount: number;
};

export type BackfillReceipt = {
    schema: typeof RECEIPT_SCHEMA;
    mode: 'dry-run' | 'apply';
    outcome: 'no-op' | 'would-update' | 'updated';
    before: BackfillInspection;
    updatedCount: number;
    after: BackfillInspection;
};

function fail(message: string): never {
    throw new Error(message);
}

function count(value: bigint | number, label: string): number {
    const parsed = typeof value === 'bigint' ? Number(value) : value;
    if (!Number.isSafeInteger(parsed) || parsed < 0) fail(`invalid aggregate ${label}`);
    return parsed;
}

function inspection(row: AggregateRow | undefined): BackfillInspection {
    if (!row) fail('backfill inspection returned no aggregate row');
    return {
        targetCount: count(row.target_count, 'target_count'),
        wouldUpdateCount: count(row.would_update_count, 'would_update_count'),
        noVerifiedSourceCount: count(row.no_verified_source_count, 'no_verified_source_count'),
        ambiguousSourceCount: count(row.ambiguous_source_count, 'ambiguous_source_count'),
        overLimitSourceCount: count(row.over_limit_source_count, 'over_limit_source_count'),
        affectedFeedEntryCount: count(row.affected_feed_entry_count, 'affected_feed_entry_count'),
    };
}

const SOURCE_CTE = Prisma.sql`
    "sources" AS (
        SELECT
            "account_issuer",
            "account_subject",
            COUNT(DISTINCT "account_email") FILTER (
                WHERE "account_email_verified" = TRUE AND "account_email" IS NOT NULL
            ) AS "verified_email_count",
            MIN("account_email") FILTER (
                WHERE "account_email_verified" = TRUE AND "account_email" IS NOT NULL
            ) AS "source_email"
        FROM "web_sessions"
        WHERE "account_issuer" IS NOT NULL AND "account_subject" IS NOT NULL
        GROUP BY "account_issuer", "account_subject"
    )
`;

function targetCte(accountIssuer: string) {
    return Prisma.sql`
    "targets" AS (
        SELECT
            "ticket"."id",
            "ticket"."scheduled_session_id",
            "source"."verified_email_count",
            "source"."source_email"
        FROM "ticket_entitlements" AS "ticket"
        INNER JOIN "scheduled_sessions" AS "session"
            ON "session"."id" = "ticket"."scheduled_session_id"
        LEFT JOIN "commerce_entitlements" AS "commerce"
            ON "commerce"."ticket_entitlement_id" = "ticket"."id"
        LEFT JOIN "sources" AS "source"
            ON "source"."account_issuer" = "ticket"."account_issuer"
            AND "source"."account_subject" = "ticket"."account_id"
        WHERE "ticket"."account_email" IS NULL
            AND "ticket"."account_email_verified" IS NULL
            AND "ticket"."bound_email" IS NULL
            AND "ticket"."tier" = 'COMP'::"TicketTier"
            AND "ticket"."code_last_four" = 'FREE'
            AND "ticket"."account_issuer" IS NOT NULL
            AND "ticket"."account_id" IS NOT NULL
            AND "ticket"."account_issuer" = ${accountIssuer}
            AND "session"."public_access" = TRUE
            AND "commerce"."id" IS NULL
    )
`;
}

async function inspectBackfill(
    tx: Prisma.TransactionClient,
    accountIssuer: string,
): Promise<BackfillInspection> {
    const rows = await tx.$queryRaw<AggregateRow[]>(Prisma.sql`
        WITH ${SOURCE_CTE}, ${targetCte(accountIssuer)}
        SELECT
            COUNT(*)::bigint AS "target_count",
            COUNT(*) FILTER (
                WHERE "verified_email_count" = 1 AND char_length("source_email") <= 254
            )::bigint AS "would_update_count",
            COUNT(*) FILTER (
                WHERE COALESCE("verified_email_count", 0) = 0
            )::bigint AS "no_verified_source_count",
            COUNT(*) FILTER (
                WHERE "verified_email_count" > 1
            )::bigint AS "ambiguous_source_count",
            COUNT(*) FILTER (
                WHERE "verified_email_count" = 1 AND char_length("source_email") > 254
            )::bigint AS "over_limit_source_count",
            (
                SELECT COUNT(DISTINCT "participant"."id")::bigint
                FROM "targets" AS "feed_target"
                INNER JOIN "session_participants" AS "participant"
                    ON "participant"."ticket_entitlement_id" = "feed_target"."id"
                    AND "participant"."scheduled_session_id" = "feed_target"."scheduled_session_id"
                INNER JOIN "live_presence_intervals" AS "presence"
                    ON "presence"."participant_id" = "participant"."id"
                    AND "presence"."scheduled_session_id" = "participant"."scheduled_session_id"
                INNER JOIN "scheduled_sessions" AS "feed_session"
                    ON "feed_session"."id" = "participant"."scheduled_session_id"
                WHERE "feed_target"."verified_email_count" = 1
                    AND char_length("feed_target"."source_email") <= 254
                    AND "participant"."staff_user_id" IS NULL
                    AND "feed_session"."is_test" = FALSE
            ) AS "affected_feed_entry_count"
        FROM "targets"
    `);
    return inspection(rows[0]);
}

async function applyBackfill(tx: Prisma.TransactionClient, accountIssuer: string): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ updated_count: bigint | number }>>(Prisma.sql`
        WITH ${SOURCE_CTE}, ${targetCte(accountIssuer)},
        "candidates" AS (
            SELECT "id", "source_email"
            FROM "targets"
            WHERE "verified_email_count" = 1 AND char_length("source_email") <= 254
        ),
        "updated" AS (
            UPDATE "ticket_entitlements" AS "ticket"
            SET
                "account_email" = "candidate"."source_email",
                "account_email_verified" = TRUE,
                "updated_at" = CURRENT_TIMESTAMP
            FROM "candidates" AS "candidate"
            WHERE "ticket"."id" = "candidate"."id"
                AND "ticket"."account_email" IS NULL
                AND "ticket"."account_email_verified" IS NULL
            RETURNING 1
        )
        SELECT COUNT(*)::bigint AS "updated_count" FROM "updated"
    `);
    return count(rows[0]?.updated_count ?? fail('backfill update returned no aggregate row'), 'updated_count');
}

export async function backfillAccountAttendanceEmail(
    prisma: PrismaClient,
    options: { apply?: boolean; accountIssuer: string },
): Promise<BackfillReceipt> {
    return prisma.$transaction(async (tx) => {
        const before = await inspectBackfill(tx, options.accountIssuer);
        if (!options.apply) {
            return {
                schema: RECEIPT_SCHEMA,
                mode: 'dry-run',
                outcome: before.wouldUpdateCount > 0 ? 'would-update' : 'no-op',
                before,
                updatedCount: 0,
                after: before,
            };
        }

        const updatedCount = await applyBackfill(tx, options.accountIssuer);
        const after = await inspectBackfill(tx, options.accountIssuer);
        if (
            updatedCount !== before.wouldUpdateCount ||
            after.targetCount !== before.targetCount - updatedCount ||
            after.wouldUpdateCount !== 0 ||
            after.noVerifiedSourceCount !== before.noVerifiedSourceCount ||
            after.ambiguousSourceCount !== before.ambiguousSourceCount ||
            after.overLimitSourceCount !== before.overLimitSourceCount
        ) {
            fail('backfill revalidation mismatch; transaction rolled back');
        }
        return {
            schema: RECEIPT_SCHEMA,
            mode: 'apply',
            outcome: updatedCount > 0 ? 'updated' : 'no-op',
            before,
            updatedCount,
            after,
        };
    }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5_000,
        timeout: 30_000,
    });
}

export function parseArguments(argv: string[]): { target: DeploymentTarget; apply: boolean } {
    let target: DeploymentTarget | undefined;
    let apply = false;
    let modeSeen = false;
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === '--target') {
            const candidate = argv[index + 1];
            if (target || (candidate !== 'production' && candidate !== 'staging')) {
                fail('target must be exactly production or staging');
            }
            target = candidate;
            index += 1;
        } else if (value === '--dry-run' || value === '--apply') {
            if (modeSeen) fail('mode may be specified only once');
            modeSeen = true;
            apply = value === '--apply';
        } else {
            fail('usage: backfill-account-attendance-email.ts --target (production|staging) [--dry-run|--apply]');
        }
    }
    if (!target) fail('explicit --target production or --target staging is required');
    return { target, apply };
}

export function validateTargetEnvironment(
    target: DeploymentTarget,
    environment: Record<string, string | undefined>,
): URL {
    const expected = TARGETS[target];
    if (environment.LIVE_ACCOUNT_ATTENDANCE_EMAIL_BACKFILL_ENABLED !== '1') {
        fail('attendance email backfill is disabled');
    }
    if (environment[expected.markerName] !== expected.markerValue) fail(`exact ${target} environment marker required`);
    if (environment.BEACON_ACCOUNT_ISSUER_URL !== expected.accountIssuer) {
        fail(`exact ${target} Account issuer marker required`);
    }
    const databaseUrl = new URL(environment.DATABASE_URL ?? fail('DATABASE_URL is required'));
    if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) fail('PostgreSQL DATABASE_URL required');
    if (databaseUrl.pathname !== `/${expected.databaseName}`) {
        fail(`refusing a database other than ${expected.databaseName}`);
    }
    return databaseUrl;
}

async function assertDatabaseIdentity(prisma: PrismaClient, target: DeploymentTarget): Promise<void> {
    const rows = await prisma.$queryRaw<Array<{ database_name: string }>>`
        SELECT current_database() AS "database_name"
    `;
    if (rows.length !== 1 || rows[0]?.database_name !== TARGETS[target].databaseName) {
        fail(`connected database is not the ${target} Live database`);
    }
}

export async function main(
    argv = process.argv.slice(2),
    environment: Record<string, string | undefined> = process.env,
): Promise<void> {
    if (process.getuid?.() !== 0) fail('run as root');
    const { target, apply } = parseArguments(argv);
    const databaseUrl = validateTargetEnvironment(target, environment);
    const pool = new Pool({
        connectionString: databaseUrl.toString(),
        max: 1,
        connectionTimeoutMillis: 5_000,
        query_timeout: 30_000,
        statement_timeout: 30_000,
    });
    const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
    try {
        await assertDatabaseIdentity(prisma, target);
        const receipt = await backfillAccountAttendanceEmail(prisma, {
            apply,
            accountIssuer: TARGETS[target].accountIssuer,
        });
        process.stdout.write(`${JSON.stringify({ target, ...receipt })}\n`);
    } finally {
        await prisma.$disconnect();
        await pool.end();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        process.stderr.write(`Live attendance email backfill failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
        process.exitCode = 1;
    });
}
