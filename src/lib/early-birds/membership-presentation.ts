import type { EarlyBirdMembershipProjection } from '@prisma/client';

import { EARLY_BIRDS_FOUNDERS_OFFER } from './membership';

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
        kind: 'founder';
        provider: 'paypal' | 'mercado-pago';
        state: ListenerMembershipPresentationState;
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
): ListenerMembershipPresentation {
    if (!projection) return { kind: 'none', state: 'none' };

    const state = presentationState(projection.state);
    if (projection.synthetic) return { kind: 'preview', state };
    if (projection.source === 'FREE') return { kind: 'invitation', state };
    if (
        projection.offerCode === EARLY_BIRDS_FOUNDERS_OFFER
        && projection.source === 'PAYPAL'
    ) {
        return { kind: 'founder', provider: 'paypal', state };
    }
    if (
        projection.offerCode === EARLY_BIRDS_FOUNDERS_OFFER
        && projection.source === 'MERCADO_PAGO'
    ) {
        return { kind: 'founder', provider: 'mercado-pago', state };
    }

    // Unknown and incomplete projections fail closed in presentation just as
    // they do in authorization. Never infer Founder status from an offer,
    // price, redirect or reason code.
    return { kind: 'none', state: 'none' };
}
