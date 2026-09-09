import { NextRequest, NextResponse } from 'next/server';

import { beaconAccountEnabled, trustedLiveRequestOrigin } from '@/lib/account-rp';
import { prisma } from '@/lib/db';
import {
    accountIdentityFromToken,
} from '@/lib/principal';
import { isPublicCycleSession } from '@/lib/public-cycle';
import { attachPublicSessionAccess } from '@/lib/public-session-access';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';

export const dynamic = 'force-dynamic';

/**
 * Account-bound admission for the four reviewed public-cycle rooms. Public
 * means free and listed; it does not mean anonymous. Every attendee crosses
 * the same durable Account boundary before receiving an event entitlement,
 * confirming their room alias, materializing presence or becoming eligible
 * for the amplification-credit entry feed.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    if (!isPublicCycleSession(id)) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    if (!beaconAccountEnabled()) {
        return NextResponse.json(
            { error: 'Beacon Account is required for live events' },
            { status: 503, headers: { 'Cache-Control': 'private, no-store' } },
        );
    }

    let origin: string;
    try {
        origin = trustedLiveRequestOrigin(request);
    } catch {
        return NextResponse.json({ error: 'Invalid Live origin' }, { status: 404 });
    }

    const currentCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const currentAccount = await accountIdentityFromToken(currentCookie);
    if (!currentAccount || !currentCookie) {
        const login = new URL('/api/account/login', origin);
        login.searchParams.set('flow', 'attendee');
        login.searchParams.set('next', `/session/${id}`);
        return NextResponse.redirect(login, {
            status: 303,
            headers: { 'Cache-Control': 'private, no-store' },
        });
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

    const attached = await attachPublicSessionAccess(currentCookie, session, currentAccount, now);
    if (!attached) {
        return NextResponse.json({ error: 'Session unavailable' }, { status: 409 });
    }
    return NextResponse.redirect(new URL(`/session/${id}`, origin), {
        status: 303,
        headers: { 'Cache-Control': 'private, no-store' },
    });
}
