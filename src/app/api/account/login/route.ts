import { NextRequest, NextResponse } from 'next/server';

import {
    beaconAccountEnabled,
    startAccountAuthorization,
    trustedLiveRequestOrigin,
} from '@/lib/account-rp';
import { redactError } from '@/lib/redact';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
    if (!beaconAccountEnabled()) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const flow = request.nextUrl.searchParams.get('flow') === 'staff' ? 'staff' : 'attendee';
    try {
        const origin = trustedLiveRequestOrigin(request);
        const started = await startAccountAuthorization({
            flow,
            returnTo: request.nextUrl.searchParams.get('next'),
            origin,
        });
        const response = NextResponse.redirect(started.authorizationUrl, { status: 303 });
        response.cookies.set(started.stateCookie);
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Referrer-Policy', 'no-referrer');
        return response;
    } catch (error) {
        console.error(`[account] authorization start failed: ${redactError(error)}`);
        return NextResponse.json(
            { error: 'Beacon Account is temporarily unavailable.' },
            { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
        );
    }
}
