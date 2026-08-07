import type { EarlyBirdFreeSchedule, EarlyBirdMembershipProjection } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { listeningAccessDecision } from '../access';

const NOW = new Date('2026-08-07T15:30:00.000Z');

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
        paidThrough: null,
        graceUntil: null,
        provider: 'paypal',
        amountMinor: 200,
        currency: 'USD',
        reasonCode: 'PAYMENT_CONFIRMED',
        synthetic: false,
        createdAt: NOW,
        updatedAt: NOW,
        ...overrides,
    };
}

function schedule(): EarlyBirdFreeSchedule {
    return {
        accountId: 'listener-1',
        timeZone: 'America/Argentina/Cordoba',
        localStartMinute: 750,
        selectedAt: new Date('2026-08-01T12:00:00.000Z'),
        changeAllowedAt: new Date('2026-08-08T12:00:00.000Z'),
        selectionRequestId: '00000000-0000-4000-8000-000000000001',
        revision: 1,
        createdAt: NOW,
        updatedAt: NOW,
    };
}

describe('combined Listener access authority', () => {
    it('gives an active canonical membership unrestricted priority over Free', () => {
        expect(listeningAccessDecision(membership(), schedule(), NOW)).toMatchObject({
            allowed: true,
            kind: 'membership',
            allowedUntil: null,
        });
    });

    it('allows an active Free window without fabricating a membership', () => {
        const decision = listeningAccessDecision(null, schedule(), NOW);
        expect(decision).toMatchObject({
            allowed: true,
            kind: 'free-window',
            allowedUntil: new Date('2026-08-07T17:30:00.000Z'),
        });
        expect(decision.membership.projection).toBeNull();
    });

    it('fails closed outside Free and preserves a canonical paid-through boundary', () => {
        expect(listeningAccessDecision(null, schedule(), new Date('2026-08-07T18:00:00.000Z')).allowed)
            .toBe(false);
        const paidThrough = new Date('2026-08-07T16:00:00.000Z');
        expect(listeningAccessDecision(membership({ paidThrough }), null, NOW)).toMatchObject({
            kind: 'membership',
            allowedUntil: paidThrough,
        });
    });
});
