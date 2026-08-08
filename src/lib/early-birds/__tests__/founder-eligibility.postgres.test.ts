import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '@/lib/db';

import {
    applyFounderEligibilityProjection,
    FounderEligibilityConflictError,
} from '../founder-eligibility';
import type { FounderPriceEligibility } from '../membership-contract';

const postgres = process.env.LISTENER_TEST_DATABASE_URL ? describe : describe.skip;
const accountIds = ['listener-founder-pg-identical', 'listener-founder-pg-conflict'];
const eligibility: FounderPriceEligibility = {
    offer: { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: 1 },
    canonical_price: { currency: 'USD', amount_minor: 200 },
    billing_period: 'MONTHLY',
    granted_at: '2026-08-06T12:00:00Z',
};

postgres('Founder eligibility PostgreSQL convergence', () => {
    beforeAll(async () => {
        await prisma.earlyBirdUser.createMany({
            data: accountIds.map((id, index) => ({
                id,
                name: `Synthetic Listener ${index}`,
                email: `founder-pg-${index}@example.invalid`,
                emailVerified: true,
            })),
            skipDuplicates: true,
        });
    });

    afterAll(async () => {
        await prisma.earlyBirdUser.deleteMany({ where: { id: { in: accountIds } } });
        await prisma.$disconnect();
    });

    it('converges concurrent identical evidence to one positive row', async () => {
        const outcomes = await Promise.all([
            applyFounderEligibilityProjection(accountIds[0], eligibility),
            applyFounderEligibilityProjection(accountIds[0], eligibility),
        ]);
        expect(outcomes.sort()).toEqual(['APPLIED', 'REPLAYED']);
        await expect(prisma.earlyBirdFounderEligibilityProjection.count({
            where: { accountId: accountIds[0] },
        })).resolves.toBe(1);
    });

    it('preserves one winner when concurrent positive evidence conflicts', async () => {
        const conflicting: FounderPriceEligibility = {
            ...eligibility,
            offer: { ...eligibility.offer, revision: 2 },
        };
        const results = await Promise.allSettled([
            applyFounderEligibilityProjection(accountIds[1], eligibility),
            applyFounderEligibilityProjection(accountIds[1], conflicting),
        ]);
        expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
        const rejected = results.find((result) => result.status === 'rejected');
        expect(rejected).toMatchObject({ reason: expect.any(FounderEligibilityConflictError) });
        await expect(prisma.earlyBirdFounderEligibilityProjection.count({
            where: { accountId: accountIds[1] },
        })).resolves.toBe(1);
    });
});
