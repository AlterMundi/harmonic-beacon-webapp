import { NextResponse } from 'next/server';

/**
 * Public EarlyBird entry is fail-closed. Internal membership projection routes
 * deliberately do not use this switch so reconciliation can continue while
 * the customer-facing experience is paused.
 */
export function earlyBirdsEnabled(): boolean {
    return process.env.EARLY_BIRDS_ENABLED === '1';
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
