import { randomUUID } from 'node:crypto';

import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
    applyMembershipProjection,
    EarlyBirdProjectionConflictError,
    membershipAccessDecision,
    type EarlyBirdMembershipProjectionCommand,
} from '../membership';

const listenerDatabaseUrl = process.env.LISTENER_TEST_DATABASE_URL;
if (listenerDatabaseUrl) process.env.DATABASE_URL = listenerDatabaseUrl;
const postgres = listenerDatabaseUrl ? describe : describe.skip;
let prisma: PrismaClient;
const suffix = randomUUID().slice(0, 8);
const accounts = [
    `listener-continuity-pg-replay-${suffix}`,
    `listener-continuity-pg-conflict-${suffix}`,
    `listener-continuity-pg-cutover-${suffix}`,
];
const ACTIVATED = '2026-08-10T12:00:00.000Z';
const THROUGH = '2026-09-10T12:00:00.000Z';

function command(
    accountId: string,
    overrides: Partial<EarlyBirdMembershipProjectionCommand> = {},
): EarlyBirdMembershipProjectionCommand {
    return {
        schema_version: 'early-bird-membership.command.v2',
        account_id: accountId,
        membership_revision: 1,
        state: 'ACTIVE',
        source: 'PAYPAL',
        offer: { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: 1 },
        effective_at: ACTIVATED,
        paid_through: THROUGH,
        grace_until: null,
        provider: 'paypal',
        current_price: { currency: 'USD', amount_minor: 500 },
        reason_code: 'PAYMENT_SUCCEEDED',
        founder_continuity: {
            episode_id: randomUUID(),
            revision: 1,
            state: 'ACTIVE',
            offer: { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: 1 },
            canonical_price: { currency: 'USD', amount_minor: 500 },
            billing_period: 'MONTHLY',
            activated_at: ACTIVATED,
            service_through: THROUGH,
            ended_at: null,
            terminal_reason: null,
        },
        ...overrides,
    };
}

postgres('Listener Founder continuity PostgreSQL projection', () => {
    beforeAll(async () => {
        ({ prisma } = await import('@/lib/db'));
        await prisma.earlyBirdUser.createMany({
            data: accounts.map((id, index) => ({
                id,
                name: `Continuity Test ${index}`,
                email: `continuity-${suffix}-${index}@example.invalid`,
                emailVerified: true,
            })),
        });
    });

    afterAll(async () => {
        for (const accountId of accounts) {
            await prisma.$executeRaw`
                DELETE FROM "early_bird_retired_membership_projection_audit"
                WHERE "account_id" = ${accountId}
            `;
        }
        await prisma.earlyBirdUser.deleteMany({ where: { id: { in: accounts } } });
        await prisma.$disconnect();
    });

    it('atomically converges concurrent exact retries to one continuity snapshot', async () => {
        const exact = command(accounts[0]);
        const results = await Promise.all([
            applyMembershipProjection(exact),
            applyMembershipProjection(exact),
        ]);
        expect(results.map((result) => result.outcome).sort()).toEqual(['APPLIED', 'REPLAYED']);
        const projection = await prisma.earlyBirdMembershipProjection.findUniqueOrThrow({
            where: { accountId: accounts[0] },
        });
        expect(projection).toMatchObject({
            revision: 1,
            founderContinuityEpisodeId: exact.founder_continuity?.episode_id,
            founderContinuityState: 'ACTIVE',
            founderContinuityAmountMinor: 500,
        });
        expect(membershipAccessDecision(projection, new Date('2026-08-11T12:00:00.000Z')).allowed).toBe(true);
    });

    it('rejects a conflicting concurrent revision and persists an ENDED tombstone', async () => {
        const first = command(accounts[1]);
        const conflicting = command(accounts[1], {
            founder_continuity: { ...first.founder_continuity!, episode_id: randomUUID() },
        });
        const results = await Promise.allSettled([
            applyMembershipProjection(first),
            applyMembershipProjection(conflicting),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((result) => result.status === 'rejected');
        expect(rejected).toMatchObject({ reason: expect.any(EarlyBirdProjectionConflictError) });

        const persisted = await prisma.earlyBirdMembershipProjection.findUniqueOrThrow({
            where: { accountId: accounts[1] },
        });

        const endedAt = '2026-09-10T12:00:00.000Z';
        await applyMembershipProjection(command(accounts[1], {
            membership_revision: 2,
            state: 'EXPIRED',
            paid_through: endedAt,
            reason_code: 'SERVICE_ENDED',
            founder_continuity: {
                ...first.founder_continuity!,
                episode_id: persisted.founderContinuityEpisodeId!,
                revision: 2,
                state: 'ENDED',
                service_through: endedAt,
                ended_at: endedAt,
                terminal_reason: 'SERVICE_ENDED',
            },
        }));
        const ended = await prisma.earlyBirdMembershipProjection.findUniqueOrThrow({
            where: { accountId: accounts[1] },
        });
        expect(ended).toMatchObject({
            founderContinuityState: 'ENDED',
            founderContinuityEndedAt: new Date(endedAt),
            founderContinuityTerminalReason: 'SERVICE_ENDED',
        });
        expect(membershipAccessDecision(ended, new Date('2026-09-11T12:00:00.000Z')).allowed).toBe(false);
    });

    it('keeps the retired positive-only rows audit-only and outside Prisma runtime', async () => {
        const tables = await prisma.$queryRaw<Array<{
            retiredEligibility: string | null;
            retiredMembership: string | null;
            activeEligibility: string | null;
        }>>`
            SELECT
                to_regclass('early_bird_retired_founder_eligibility_audit')::text AS "retiredEligibility",
                to_regclass('early_bird_retired_membership_projection_audit')::text AS "retiredMembership",
                to_regclass('early_bird_founder_eligibility_projections')::text AS "activeEligibility"
        `;
        expect(tables).toEqual([{
            retiredEligibility: 'early_bird_retired_founder_eligibility_audit',
            retiredMembership: 'early_bird_retired_membership_projection_audit',
            activeEligibility: null,
        }]);
        expect('earlyBirdFounderEligibilityProjection' in prisma).toBe(false);
    });

    it('retires a v1 hash so command.v2 can converge at the same membership revision', async () => {
        const accountId = accounts[2];
        await prisma.earlyBirdMembershipProjection.create({
            data: {
                accountId,
                revision: 7,
                commandHash: '1'.repeat(64),
                state: 'ACTIVE',
                source: 'PAYPAL',
                offerCode: 'EARLY_BIRDS_FOUNDERS_V1',
                offerRevision: 1,
                effectiveAt: new Date(ACTIVATED),
                paidThrough: new Date(THROUGH),
                provider: 'paypal',
                amountMinor: 500,
                currency: 'USD',
                reasonCode: 'LEGACY_V1_SYNTHETIC',
            },
        });
        await prisma.$executeRaw`
            INSERT INTO "early_bird_retired_membership_projection_audit"
            SELECT * FROM "early_bird_membership_projections"
            WHERE "account_id" = ${accountId}
        `;
        await prisma.earlyBirdMembershipProjection.delete({ where: { accountId } });

        const applied = await applyMembershipProjection(command(accountId, { membership_revision: 7 }));
        expect(applied.outcome).toBe('APPLIED');
        expect(applied.projection).toMatchObject({
            revision: 7,
            founderContinuityState: 'ACTIVE',
        });
        const retired = await prisma.$queryRaw<Array<{ commandHash: string }>>`
            SELECT "command_hash" AS "commandHash"
            FROM "early_bird_retired_membership_projection_audit"
            WHERE "account_id" = ${accountId}
        `;
        expect(retired).toEqual([{ commandHash: '1'.repeat(64) }]);
    });
});
