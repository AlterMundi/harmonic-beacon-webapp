import type { EarlyBirdMembershipProjection } from '@prisma/client';

import { EARLY_BIRDS_FOUNDERS_OFFER, membershipAccessDecision } from './membership';

export type ListenerMembershipPresentationState =
    | 'pending'
    | 'active'
    | 'grace'
    | 'ending'
    | 'expired'
    | 'refunded'
    | 'revoked';

export type ListenerMembershipPresentation =
    | { kind: 'none'; state: 'none' }
    | { kind: 'invitation'; state: ListenerMembershipPresentationState }
    | { kind: 'preview'; state: ListenerMembershipPresentationState }
    | {
        kind: 'paid-status';
        provider: 'paypal' | 'mercado-pago';
        state: 'pending' | 'expired' | 'refunded' | 'revoked';
    }
    | {
        kind: 'founder';
        provider: 'paypal' | 'mercado-pago';
        state: ListenerMembershipPresentationState;
        serviceThrough?: string | null;
    };

function presentationState(
    state: EarlyBirdMembershipProjection['state'],
): ListenerMembershipPresentationState {
    switch (state) {
        case 'PENDING': return 'pending';
        case 'ACTIVE': return 'active';
        case 'GRACE': return 'grace';
        case 'CANCELLED_PENDING_END': return 'ending';
        case 'EXPIRED': return 'expired';
        case 'REFUNDED': return 'refunded';
        case 'REVOKED': return 'revoked';
    }
}

/**
 * Reduce the canonical read model to the only membership facts the public UI
 * may present. Internal source names, revisions, reason codes and payment
 * identifiers never cross the Server Component boundary.
 */
export function listenerMembershipPresentation(
    projection: EarlyBirdMembershipProjection | null,
    now = new Date(),
): ListenerMembershipPresentation {
    if (!projection) return { kind: 'none', state: 'none' };

    const state = presentationState(projection.state);
    const accessAllowed = membershipAccessDecision(projection, now).allowed;
    if (projection.synthetic) return accessAllowed ? { kind: 'preview', state } : { kind: 'none', state: 'none' };
    if (projection.source === 'FREE') {
        return accessAllowed ? { kind: 'invitation', state } : { kind: 'none', state: 'none' };
    }
    const continuityCurrent = projection.founderContinuityState === 'ACTIVE'
        || projection.founderContinuityState === 'CANCELLED_PENDING_END'
        || projection.founderContinuityState === 'GRACE';
    const provider = projection.source === 'PAYPAL'
        ? 'paypal'
        : projection.source === 'MERCADO_PAGO'
            ? 'mercado-pago'
            : null;
    if (
        accessAllowed
        && continuityCurrent
        && projection.founderContinuityOfferCode === EARLY_BIRDS_FOUNDERS_OFFER
        && projection.offerCode === EARLY_BIRDS_FOUNDERS_OFFER
        && projection.source === 'PAYPAL'
    ) {
        return {
            kind: 'founder',
            provider: 'paypal',
            state,
            serviceThrough: projection.founderContinuityServiceThrough?.toISOString() ?? null,
        };
    }
    if (
        accessAllowed
        && continuityCurrent
        && projection.founderContinuityOfferCode === EARLY_BIRDS_FOUNDERS_OFFER
        && projection.offerCode === EARLY_BIRDS_FOUNDERS_OFFER
        && projection.source === 'MERCADO_PAGO'
    ) {
        return {
            kind: 'founder',
            provider: 'mercado-pago',
            state,
            serviceThrough: projection.founderContinuityServiceThrough?.toISOString() ?? null,
        };
    }

    if (
        provider
        && projection.offerCode === EARLY_BIRDS_FOUNDERS_OFFER
        && (state === 'pending' || state === 'expired' || state === 'refunded' || state === 'revoked')
    ) {
        return { kind: 'paid-status', provider, state };
    }

    // Unknown and incomplete projections fail closed in presentation just as
    // they do in authorization. A terminal paid status is informational only;
    // it never restores the Founder badge or listening authority.
    return { kind: 'none', state: 'none' };
}
