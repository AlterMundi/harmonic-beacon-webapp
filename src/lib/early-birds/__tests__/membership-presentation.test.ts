import type { EarlyBirdMembershipProjection } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { listenerMembershipPresentation } from '../membership-presentation';

const NOW = new Date('2026-08-07T12:00:00.000Z');

function projection(overrides: Partial<EarlyBirdMembershipProjection> = {}): EarlyBirdMembershipProjection {
    return {
        id: '00000000-0000-4000-8000-000000000001',
        accountId: 'listener-1',
        revision: 9,
        commandHash: 'a'.repeat(64),
        state: 'ACTIVE',
        source: 'PAYPAL',
        offerCode: 'EARLY_BIRDS_FOUNDERS_V1',
        offerRevision: 1,
        effectiveAt: NOW,
        paidThrough: new Date('2026-09-07T12:00:00.000Z'),
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
        founderContinuityServiceThrough: new Date('2026-09-07T12:00:00.000Z'),
        founderContinuityEndedAt: null,
        founderContinuityTerminalReason: null,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

describe('public Listener membership presentation', () => {
    it('exposes only a normalized Founder provider and lifecycle state', () => {
        const result = listenerMembershipPresentation(projection({
            state: 'CANCELLED_PENDING_END',
            founderContinuityState: 'CANCELLED_PENDING_END',
            provider: 'provider-internal-value',
            reasonCode: 'PRIVATE_REASON',
        }), NOW);

        expect(result).toEqual({ kind: 'founder', provider: 'paypal', state: 'ending' });
        expect(JSON.stringify(result)).not.toMatch(/PRIVATE_REASON|provider-internal-value|PAYPAL/);
    });

    it.each([
        ['ACTIVE', 'ACTIVE', 'active'],
        ['GRACE', 'GRACE', 'grace'],
        ['CANCELLED_PENDING_END', 'CANCELLED_PENDING_END', 'ending'],
    ] as const)('normalizes current %s continuity without exposing the raw enum', (state, continuityState, expected) => {
        expect(listenerMembershipPresentation(projection({
            state,
            founderContinuityState: continuityState,
            graceUntil: state === 'GRACE' ? new Date('2026-09-07T12:00:00.000Z') : null,
        }), NOW)).toEqual({
            kind: 'founder',
            provider: 'paypal',
            state: expected,
        });
    });

    it.each(['EXPIRED', 'REFUNDED', 'REVOKED', 'PENDING'] as const)(
        'removes the Founder badge for terminal or non-authoritative %s membership',
        (state) => {
            expect(listenerMembershipPresentation(projection({
                state,
                founderContinuityState: state === 'PENDING' ? null : 'ENDED',
            }), NOW)).toEqual({ kind: 'none', state: 'none' });
        },
    );

    it('distinguishes invitation and preview access without exposing FREE or synthetic internals', () => {
        expect(listenerMembershipPresentation(projection({
            source: 'FREE',
            founderContinuityState: null,
        }), NOW))
            .toEqual({ kind: 'invitation', state: 'active' });
        expect(listenerMembershipPresentation(projection({
            source: null,
            synthetic: true,
            founderContinuityState: null,
        }), NOW))
            .toEqual({ kind: 'preview', state: 'active' });
    });

    it('does not infer Founder status from offer or price fields', () => {
        expect(listenerMembershipPresentation(projection({ source: null, synthetic: false }), NOW))
            .toEqual({ kind: 'none', state: 'none' });
        expect(listenerMembershipPresentation(projection({
            source: 'PAYPAL',
            offerCode: 'FUTURE_PRODUCT',
        }), NOW)).toEqual({ kind: 'none', state: 'none' });
        expect(listenerMembershipPresentation(projection({
            source: 'MERCADO_PAGO',
            offerCode: null,
        }), NOW)).toEqual({ kind: 'none', state: 'none' });
        expect(listenerMembershipPresentation(null, NOW)).toEqual({ kind: 'none', state: 'none' });
    });
});
