import type { EarlyBirdMembershipProjection } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { listeningAccessDecision, serializeEarlyBirdListeningAccess } from '../access';
import {
    EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
    type EarlyBirdQuotaSnapshot,
} from '../quota';

const NOW = new Date('2026-08-08T12:00:00.000Z');

function membership(overrides: Partial<EarlyBirdMembershipProjection> = {}): EarlyBirdMembershipProjection {
    return {
        id: '00000000-0000-4000-8000-000000000001',
        accountId: 'listener-1',
        revision: 1,
        commandHash: 'a'.repeat(64),
        state: 'ACTIVE',
        source: 'PAYPAL',
        offerCode: 'EARLY_BIRDS_FOUNDERS_V1',
        offerRevision: 1,
        effectiveAt: NOW,
        paidThrough: new Date('2026-09-08T12:00:00.000Z'),
        graceUntil: null,
        provider: 'paypal',
        amountMinor: 500,
        currency: 'USD',
        reasonCode: 'PAYMENT_CONFIRMED',
        synthetic: false,
        founderContinuityEpisodeId: '00000000-0000-4000-8000-000000000101',
        founderContinuityRevision: 1,
        founderContinuityState: 'ACTIVE',
        founderContinuityOfferCode: 'EARLY_BIRDS_FOUNDERS_V1',
        founderContinuityOfferRevision: 1,
        founderContinuityCurrency: 'USD',
        founderContinuityAmountMinor: 500,
        founderContinuityBillingPeriod: 'MONTHLY',
        founderContinuityActivatedAt: NOW,
        founderContinuityServiceThrough: new Date('2026-09-08T12:00:00.000Z'),
        founderContinuityEndedAt: null,
        founderContinuityTerminalReason: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function quota(overrides: Partial<EarlyBirdQuotaSnapshot> = {}): EarlyBirdQuotaSnapshot {
    return {
        policy: 'personal-7-day-v1',
        status: 'available',
        cycleStartedAt: NOW,
        cycleEndsAt: new Date(NOW.getTime() + 604_800_000),
        baseAllowanceMs: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
        bonusAllowanceMs: 0,
        consumedMs: 0,
        remainingMs: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
        activelyConsuming: false,
        exhaustsAt: null,
        nextCycleAt: new Date(NOW.getTime() + 604_800_000),
        ...overrides,
    };
}

describe('Listener access contract', () => {
    it('gives active canonical membership priority and never exposes a consuming quota', () => {
        expect(listeningAccessDecision(membership(), quota(), NOW)).toMatchObject({
            allowed: true,
            kind: 'membership',
            allowedUntil: new Date('2026-09-08T12:00:00.000Z'),
            quota: null,
            serverNow: NOW,
        });
    });

    it('allows registered ordinary Free before the anchor without predicting a boundary', () => {
        const unstarted = quota({
            status: 'not-started',
            cycleStartedAt: null,
            cycleEndsAt: null,
            nextCycleAt: null,
        });
        expect(listeningAccessDecision(null, unstarted, NOW)).toMatchObject({
            allowed: true,
            kind: 'free-quota',
            allowedUntil: null,
            quota: unstarted,
        });
    });

    it('reports predicted exhaustion only while actively metering', () => {
        const exhaustsAt = new Date(NOW.getTime() + 500);
        expect(listeningAccessDecision(null, quota({
            status: 'listening',
            remainingMs: 500,
            activelyConsuming: true,
            exhaustsAt,
        }), NOW)).toMatchObject({
            allowed: true,
            kind: 'free-quota',
            allowedUntil: exhaustsAt,
        });
        expect(listeningAccessDecision(null, quota({ remainingMs: 500 }), NOW).allowedUntil).toBeNull();
    });

    it('denies exhausted Free and serializes the exact frozen wire fields', () => {
        const access = listeningAccessDecision(null, quota({
            status: 'exhausted',
            consumedMs: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
            remainingMs: 0,
        }), NOW);
        expect(access).toMatchObject({ allowed: false, kind: 'denied', allowedUntil: null });
        expect(serializeEarlyBirdListeningAccess(access)).toEqual({
            allowed: false,
            kind: 'denied',
            allowedUntil: null,
            quota: {
                policy: 'personal-7-day-v1',
                status: 'exhausted',
                cycleStartedAt: NOW.toISOString(),
                cycleEndsAt: new Date(NOW.getTime() + 604_800_000).toISOString(),
                baseAllowanceMs: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
                bonusAllowanceMs: 0,
                consumedMs: EARLY_BIRD_QUOTA_BASE_ALLOWANCE_MS,
                remainingMs: 0,
                activelyConsuming: false,
                exhaustsAt: null,
                nextCycleAt: new Date(NOW.getTime() + 604_800_000).toISOString(),
            },
        });
    });
});
