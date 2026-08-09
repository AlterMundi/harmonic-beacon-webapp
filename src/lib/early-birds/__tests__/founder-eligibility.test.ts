import { beforeEach, describe, expect, it, vi } from 'vitest';

const tx = vi.hoisted(() => ({
    $queryRaw: vi.fn(),
    earlyBirdFounderEligibilityProjection: {
        findUnique: vi.fn(),
        create: vi.fn(),
    },
}));
const prisma = vi.hoisted(() => ({
    $transaction: vi.fn((callback: (client: typeof tx) => unknown) => callback(tx)),
}));

vi.mock('@/lib/db', () => ({ prisma }));

import {
    applyFounderEligibilityProjection,
    FounderEligibilityAccountNotFoundError,
    FounderEligibilityConflictError,
    founderEligibilityHash,
} from '../founder-eligibility';
import type { FounderPriceEligibility } from '../membership-contract';

const NOW = new Date('2026-08-08T12:00:00Z');
const eligibility: FounderPriceEligibility = {
    offer: { code: 'EARLY_BIRDS_FOUNDERS_V1', revision: 1 },
    canonical_price: { currency: 'USD', amount_minor: 500 },
    billing_period: 'MONTHLY',
    granted_at: '2026-08-06T12:00:00Z',
};

function row(overrides: Record<string, unknown> = {}) {
    return {
        accountId: 'listener-1',
        offerCode: eligibility.offer.code,
        offerRevision: eligibility.offer.revision,
        currency: eligibility.canonical_price.currency,
        amountMinor: eligibility.canonical_price.amount_minor,
        billingPeriod: eligibility.billing_period,
        grantedAt: new Date(eligibility.granted_at),
        eligibilityHash: founderEligibilityHash(eligibility),
        observedAt: NOW,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    } as never;
}

describe('positive-only Founder eligibility projection', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        tx.$queryRaw.mockResolvedValue([{ id: 'listener-1' }]);
        tx.earlyBirdFounderEligibilityProjection.findUnique.mockResolvedValue(null);
        tx.earlyBirdFounderEligibilityProjection.create.mockResolvedValue(row());
    });

    it('returns ABSENT without writing when canonical evidence is null', async () => {
        await expect(applyFounderEligibilityProjection('listener-1', null, NOW))
            .resolves.toBe('ABSENT');
        expect(tx.earlyBirdFounderEligibilityProjection.create).not.toHaveBeenCalled();
    });

    it('applies the first positive evidence and replays exact evidence', async () => {
        await expect(applyFounderEligibilityProjection('listener-1', eligibility, NOW))
            .resolves.toBe('APPLIED');
        expect(tx.earlyBirdFounderEligibilityProjection.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                accountId: 'listener-1',
                currency: 'USD',
                amountMinor: 500,
                billingPeriod: 'MONTHLY',
                eligibilityHash: founderEligibilityHash(eligibility),
            }),
        });

        tx.earlyBirdFounderEligibilityProjection.findUnique.mockResolvedValue(row());
        await expect(applyFounderEligibilityProjection('listener-1', eligibility, NOW))
            .resolves.toBe('REPLAYED');
    });

    it('replays equivalent timestamp spellings after UTC millisecond normalization', async () => {
        tx.earlyBirdFounderEligibilityProjection.findUnique.mockResolvedValue(row());
        const equivalents = [
            '2026-08-06T09:00:00-03:00',
            '2026-08-06T12:00:00.000Z',
            '2026-08-06T12:00:00.000000000Z',
        ];
        for (const grantedAt of equivalents) {
            await expect(applyFounderEligibilityProjection('listener-1', {
                ...eligibility,
                granted_at: grantedAt,
            }, NOW)).resolves.toBe('REPLAYED');
        }
    });

    it('preserves positive evidence against null or a conflicting positive payload', async () => {
        tx.earlyBirdFounderEligibilityProjection.findUnique.mockResolvedValue(row());
        await expect(applyFounderEligibilityProjection('listener-1', null, NOW))
            .rejects.toBeInstanceOf(FounderEligibilityConflictError);
        await expect(applyFounderEligibilityProjection('listener-1', {
            ...eligibility,
            offer: { ...eligibility.offer, revision: 2 },
        }, NOW)).rejects.toBeInstanceOf(FounderEligibilityConflictError);
        expect(tx.earlyBirdFounderEligibilityProjection.create).not.toHaveBeenCalled();
    });

    it('fails before any evidence lookup when the local account is absent', async () => {
        tx.$queryRaw.mockResolvedValue([]);
        await expect(applyFounderEligibilityProjection('missing', eligibility, NOW))
            .rejects.toBeInstanceOf(FounderEligibilityAccountNotFoundError);
        expect(tx.earlyBirdFounderEligibilityProjection.findUnique).not.toHaveBeenCalled();
    });
});
