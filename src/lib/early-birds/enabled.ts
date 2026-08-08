import { NextResponse } from 'next/server';

import { listenerRuntimeFlag } from '@/lib/listener/runtime-env';

/**
 * Public EarlyBird entry is fail-closed. Internal membership projection routes
 * deliberately do not use this switch so reconciliation can continue while
 * the customer-facing experience is paused.
 */
export function earlyBirdsEnabled(environment: NodeJS.ProcessEnv = process.env): boolean {
    try {
        return listenerRuntimeFlag('ENABLED', environment);
    } catch {
        return false;
    }
}

/**
 * Reversible operator override for short public listening moments. This does
 * not create or mutate memberships: when disabled, anonymous stream and
 * drop-in authorization stops on the next request/manifest refresh.
 */
export function earlyBirdsFreeForAll(environment: NodeJS.ProcessEnv = process.env): boolean {
    try {
        return listenerRuntimeFlag('FREE_FOR_ALL', environment);
    } catch {
        return false;
    }
}

export function earlyBirdsUnavailableResponse(): NextResponse {
    return NextResponse.json(
        { error: 'EarlyBirds is temporarily unavailable.' },
        {
            status: 503,
            headers: {
                'Cache-Control': 'private, no-store',
                'Retry-After': '300',
            },
        },
    );
}
