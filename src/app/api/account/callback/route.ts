import { NextRequest, NextResponse } from 'next/server';

import {
    ACCOUNT_STATE_COOKIE,
    beaconAccountEnabled,
    clearedAccountStateCookie,
    completeAccountAuthorization,
    trustedLiveRequestOrigin,
} from '@/lib/account-rp';
import { redactError } from '@/lib/redact';
import { redeemPromoInvitationByDigest } from '@/lib/promo-invitation';
import { sessionCookie } from '@/lib/principal';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest): Promise<NextResponse> {
    if (!beaconAccountEnabled()) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const code = request.nextUrl.searchParams.get('code') ?? '';
    const state = request.nextUrl.searchParams.get('state') ?? '';
    let origin: string;
    try {
        origin = trustedLiveRequestOrigin(request);
    } catch {
        return NextResponse.json({ error: 'Invalid callback origin' }, { status: 400 });
    }

    try {
        const completed = await completeAccountAuthorization({
            code,
            state,
            stateCookie: request.cookies.get(ACCOUNT_STATE_COOKIE)?.value,
            origin,
        });
        let returnTo = completed.returnTo;
        let localCookie = completed.cookie;
        if (completed.pendingInvitation) {
            const pending = completed.pendingInvitation;
            const redemption = await redeemPromoInvitationByDigest(
                pending.promoDigest,
                {
                    accountIssuer: completed.identity.issuer,
                    accountId: completed.identity.subject,
                },
                pending.displayName,
                new Date(),
                {
                    version: pending.termsVersion,
                    acceptedAt: pending.termsAcceptedAt,
                },
                completed.identity,
                completed.cookie.value,
            );
            if (redemption.ok) {
                returnTo = `/session/${redemption.scheduledSessionId}`;
                localCookie = sessionCookie(redemption.cookieValue);
            } else {
                returnTo = '/?invitation_error=1';
            }
        }
        const response = NextResponse.redirect(new URL(returnTo, origin), { status: 303 });
        response.cookies.set(localCookie);
        response.cookies.set(clearedAccountStateCookie());
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Referrer-Policy', 'no-referrer');
        return response;
    } catch (error) {
        console.warn(`[account] callback rejected: ${redactError(error)}`);
        const fallback = new URL('/?account_error=1', origin);
        const response = NextResponse.redirect(fallback, { status: 303 });
        response.cookies.set(clearedAccountStateCookie());
        response.headers.set('Cache-Control', 'private, no-store');
        response.headers.set('Referrer-Policy', 'no-referrer');
        return response;
    }
}
