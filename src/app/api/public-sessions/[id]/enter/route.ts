import { NextRequest, NextResponse } from 'next/server';

import { beaconAccountEnabled, trustedLiveRequestOrigin } from '@/lib/account-rp';
import { prisma } from '@/lib/db';
import {
    accountIdentityFromToken,
    principalFromToken,
} from '@/lib/principal';
import { isPublicCycleSession } from '@/lib/public-cycle';
import { attachPublicSessionAccess } from '@/lib/public-session-access';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';

export const dynamic = 'force-dynamic';

/**
 * Payment-free admission for the four reviewed public-cycle rooms.
 *
 * A verified Google-backed Beacon Account is mandatory even though no ticket
 * purchase is required. The account subject authorizes access; its verified
 * email is retained only as the private identity/credit reconciliation key.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    if (!isPublicCycleSession(id)) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    let origin: string;
    try {
        origin = trustedLiveRequestOrigin(request);
    } catch {
        return NextResponse.json({ error: 'Invalid Live origin' }, { status: 404 });
    }

    const currentCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const currentPrincipal = await principalFromToken(currentCookie);
    if (
        currentPrincipal?.kind === 'staff' ||
        (currentPrincipal?.kind === 'attendee' && currentPrincipal.scheduledSessionId === id)
    ) {
        return NextResponse.redirect(new URL(`/session/${id}`, origin), { status: 303 });
    }

    const now = new Date();
    const session = await prisma.scheduledSession.findUnique({
        where: { id },
        select: {
            id: true,
            scheduledAt: true,
            status: true,
            isTest: true,
            publicAccess: true,
        },
    });
    if (
        !session ||
        session.isTest ||
        !session.publicAccess ||
        !['SCHEDULED', 'LIVE'].includes(session.status)
    ) {
        return NextResponse.json({ error: 'Session unavailable' }, { status: 404 });
    }

    if (!beaconAccountEnabled()) {
        return NextResponse.json(
            { error: 'Beacon Account is required for free event access' },
            { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
        );
    }
    const currentAccount = await accountIdentityFromToken(currentCookie);
    if (!currentAccount || !currentCookie) {
        const login = new URL('/api/account/login', origin);
        login.searchParams.set('flow', 'attendee');
        login.searchParams.set('next', `/api/public-sessions/${id}/enter`);
        login.searchParams.set('method', 'google');
        return NextResponse.redirect(login, { status: 303 });
    }
    if (
        currentAccount.authMethod !== 'google' ||
        currentAccount.emailVerified !== true ||
        !currentAccount.email
    ) {
        const rejected = new URL('/', origin);
        rejected.searchParams.set('account_method', 'google_required');
        return NextResponse.redirect(rejected, { status: 303 });
    }
    const attached = await attachPublicSessionAccess(currentCookie, session, currentAccount, now);
    if (!attached) {
        return NextResponse.json({ error: 'Session unavailable' }, { status: 409 });
    }
    return NextResponse.redirect(new URL(`/session/${id}`, origin), { status: 303 });
}
