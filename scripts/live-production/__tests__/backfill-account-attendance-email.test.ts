import { readFile } from 'node:fs/promises';
import type { PrismaClient } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    PRODUCTION_ACCOUNT_ISSUER,
    STAGING_ACCOUNT_ISSUER,
    backfillAccountAttendanceEmail,
    parseArguments,
    validateTargetEnvironment,
} from '../backfill-account-attendance-email';

const before = {
    target_count: 5,
    would_update_count: 2,
    no_verified_source_count: 1,
    ambiguous_source_count: 1,
    over_limit_source_count: 1,
    affected_feed_entry_count: 1,
};
const after = {
    target_count: 3,
    would_update_count: 0,
    no_verified_source_count: 1,
    ambiguous_source_count: 1,
    over_limit_source_count: 1,
    affected_feed_entry_count: 0,
};

function prismaWith(rows: unknown[]) {
    const queryRaw = vi.fn();
    for (const result of rows) queryRaw.mockResolvedValueOnce(result);
    const transaction = vi.fn(async (work: (tx: { $queryRaw: typeof queryRaw }) => unknown) =>
        work({ $queryRaw: queryRaw }));
    return {
        prisma: { $transaction: transaction } as unknown as PrismaClient,
        queryRaw,
        transaction,
    };
}

describe('Live Account attendance email metadata backfill', () => {
    beforeEach(() => vi.restoreAllMocks());

    it('defaults to dry-run and requires one explicit apply flag', () => {
        expect(parseArguments(['--target', 'production'])).toEqual({ target: 'production', apply: false });
        expect(parseArguments(['--target', 'staging', '--dry-run'])).toEqual({ target: 'staging', apply: false });
        expect(parseArguments(['--apply', '--target', 'production'])).toEqual({ target: 'production', apply: true });
        for (const invalid of [[], ['apply'], ['--apply', '--dry-run'], ['--target', 'other'], ['--unknown']]) {
            expect(() => parseArguments(invalid)).toThrow();
        }
    });

    it('requires exact production enablement, issuer and database markers', () => {
        const environment = {
            LIVE_ACCOUNT_ATTENDANCE_EMAIL_BACKFILL_ENABLED: '1',
            LIVE_PRODUCTION_ENVIRONMENT: 'production',
            BEACON_ACCOUNT_ISSUER_URL: PRODUCTION_ACCOUNT_ISSUER,
            DATABASE_URL: 'postgresql://unused@postgres/beacon',
        };
        expect(validateTargetEnvironment('production', environment).pathname).toBe('/beacon');
        expect(() => validateTargetEnvironment('production', { ...environment,
            LIVE_ACCOUNT_ATTENDANCE_EMAIL_BACKFILL_ENABLED: undefined })).toThrow(/disabled/);
        expect(() => validateTargetEnvironment('production', { ...environment,
            LIVE_PRODUCTION_ENVIRONMENT: 'staging' })).toThrow(/environment marker/);
        expect(() => validateTargetEnvironment('production', { ...environment,
            BEACON_ACCOUNT_ISSUER_URL: 'https://account-staging.harmonicbeacon.com' })).toThrow(/issuer marker/);
        expect(() => validateTargetEnvironment('production', { ...environment,
            DATABASE_URL: 'postgresql://unused@postgres/beacon_test' })).toThrow(/other than beacon/);

        expect(validateTargetEnvironment('staging', {
            LIVE_ACCOUNT_ATTENDANCE_EMAIL_BACKFILL_ENABLED: '1',
            LIVE_STAGING_ENVIRONMENT: 'live-staging',
            BEACON_ACCOUNT_ISSUER_URL: STAGING_ACCOUNT_ISSUER,
            DATABASE_URL: 'postgresql://unused@postgres/beacon_live_staging',
        }).pathname).toBe('/beacon_live_staging');
    });

    it('dry-runs with one aggregate read and emits no identity or email', async () => {
        const { prisma, queryRaw, transaction } = prismaWith([[before]]);
        const receipt = await backfillAccountAttendanceEmail(prisma, { accountIssuer: PRODUCTION_ACCOUNT_ISSUER });

        expect(receipt).toEqual({
            schema: 'live.account-attendance-email-backfill.v1',
            mode: 'dry-run',
            outcome: 'would-update',
            before: {
                targetCount: 5,
                wouldUpdateCount: 2,
                noVerifiedSourceCount: 1,
                ambiguousSourceCount: 1,
                overLimitSourceCount: 1,
                affectedFeedEntryCount: 1,
            },
            updatedCount: 0,
            after: expect.any(Object),
        });
        expect(receipt.after).toEqual(receipt.before);
        expect(queryRaw).toHaveBeenCalledTimes(1);
        expect(transaction).toHaveBeenCalledWith(expect.any(Function), expect.objectContaining({
            isolationLevel: 'Serializable',
        }));
        expect(JSON.stringify(receipt)).not.toMatch(/@|issuer|subject|ticket|participant|entryId/i);
    });

    it('applies once and revalidates every aggregate inside the transaction', async () => {
        const { prisma, queryRaw } = prismaWith([[before], [{ updated_count: 2 }], [after]]);
        const receipt = await backfillAccountAttendanceEmail(prisma, {
            apply: true, accountIssuer: PRODUCTION_ACCOUNT_ISSUER,
        });

        expect(receipt).toMatchObject({
            mode: 'apply', outcome: 'updated', updatedCount: 2,
            before: { targetCount: 5, wouldUpdateCount: 2, affectedFeedEntryCount: 1 },
            after: { targetCount: 3, wouldUpdateCount: 0 },
        });
        expect(queryRaw).toHaveBeenCalledTimes(3);
    });

    it('fails the transaction when update and postcondition aggregates diverge', async () => {
        const mismatched = { ...after, ambiguous_source_count: 0 };
        const { prisma } = prismaWith([[before], [{ updated_count: 2 }], [mismatched]]);
        await expect(backfillAccountAttendanceEmail(prisma, {
            apply: true, accountIssuer: PRODUCTION_ACCOUNT_ISSUER,
        })).rejects.toThrow(/revalidation mismatch/);
    });

    it('keeps the executable SQL scoped to exact opaque identity and metadata-only fields', async () => {
        const source = await readFile(new URL('../backfill-account-attendance-email.ts', import.meta.url), 'utf8');
        for (const required of [
            '"source"."account_issuer" = "ticket"."account_issuer"',
            '"source"."account_subject" = "ticket"."account_id"',
            '"ticket"."account_issuer" = ${accountIssuer}',
            '"account_email_verified" = TRUE',
            'COUNT(DISTINCT "account_email")',
            'COUNT(DISTINCT "participant"."id")',
            '"ticket"."account_email" IS NULL',
            '"ticket"."account_email_verified" IS NULL',
            '"ticket"."bound_email" IS NULL',
            '"ticket"."tier" = \'COMP\'',
            '"ticket"."code_last_four" = \'FREE\'',
            '"session"."public_access" = TRUE',
            '"commerce"."id" IS NULL',
        ]) expect(source).toContain(required);
        for (const forbidden of ['UPDATE "live_presence_intervals"', 'UPDATE "session_participants"',
            'UPDATE "commerce_entitlements"', 'fetch(', 'next_cursor']) {
            expect(source).not.toContain(forbidden);
        }
    });
});
