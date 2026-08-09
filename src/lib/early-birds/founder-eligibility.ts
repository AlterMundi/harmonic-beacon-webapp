import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/db';

import {
    canonicalRfc3339Instant,
    type FounderPriceEligibility,
} from './membership-contract';
import { jcsCanonicalize } from './membership';

export type FounderEligibilityProjectionOutcome = 'ABSENT' | 'APPLIED' | 'REPLAYED';

export class FounderEligibilityConflictError extends Error {
    constructor() {
        super('Canonical Founder price eligibility conflicts with durable local evidence');
        this.name = 'FounderEligibilityConflictError';
    }
}

export class FounderEligibilityAccountNotFoundError extends Error {
    constructor() {
        super('Listener account does not exist');
        this.name = 'FounderEligibilityAccountNotFoundError';
    }
}

function normalizedEligibility(value: FounderPriceEligibility): FounderPriceEligibility {
    if (
        value.offer.code !== 'EARLY_BIRDS_FOUNDERS_V1'
        || !Number.isSafeInteger(value.offer.revision)
        || value.offer.revision < 1
        || value.canonical_price.currency !== 'USD'
        || value.canonical_price.amount_minor !== 500
        || value.billing_period !== 'MONTHLY'
    ) {
        throw new FounderEligibilityConflictError();
    }
    try {
        return {
            ...value,
            granted_at: canonicalRfc3339Instant(value.granted_at, 'Founder granted_at'),
        };
    } catch {
        throw new FounderEligibilityConflictError();
    }
}

export function founderEligibilityHash(eligibility: FounderPriceEligibility): string {
    return createHash('sha256')
        .update(jcsCanonicalize(normalizedEligibility(eligibility)))
        .digest('hex');
}

export async function applyFounderEligibilityProjection(
    accountId: string,
    rawEligibility: FounderPriceEligibility | null,
    observedAt = new Date(),
): Promise<FounderEligibilityProjectionOutcome> {
    return prisma.$transaction(async (tx) => {
        const accounts = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT "id" FROM "early_bird_users" WHERE "id" = ${accountId} FOR UPDATE`,
        );
        if (accounts.length !== 1) throw new FounderEligibilityAccountNotFoundError();

        const existing = await tx.earlyBirdFounderEligibilityProjection.findUnique({
            where: { accountId },
        });
        if (rawEligibility === null) {
            if (existing) throw new FounderEligibilityConflictError();
            return 'ABSENT';
        }

        const eligibility = normalizedEligibility(rawEligibility);
        const eligibilityHash = founderEligibilityHash(eligibility);
        if (existing) {
            const exact = existing.eligibilityHash === eligibilityHash
                && existing.offerCode === eligibility.offer.code
                && existing.offerRevision === eligibility.offer.revision
                && existing.currency === eligibility.canonical_price.currency
                && existing.amountMinor === eligibility.canonical_price.amount_minor
                && existing.billingPeriod === eligibility.billing_period
                && existing.grantedAt.toISOString() === new Date(eligibility.granted_at).toISOString();
            if (!exact) throw new FounderEligibilityConflictError();
            return 'REPLAYED';
        }

        await tx.earlyBirdFounderEligibilityProjection.create({
            data: {
                accountId,
                offerCode: eligibility.offer.code,
                offerRevision: eligibility.offer.revision,
                currency: eligibility.canonical_price.currency,
                amountMinor: eligibility.canonical_price.amount_minor,
                billingPeriod: eligibility.billing_period,
                grantedAt: new Date(eligibility.granted_at),
                eligibilityHash,
                observedAt,
            },
        });
        return 'APPLIED';
    });
}
