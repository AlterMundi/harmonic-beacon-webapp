import { createHash, randomBytes } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { trustedLiveRequestOrigin } from '@/lib/account-rp';
import { prisma } from '@/lib/db';
import {
    accountIdentityFromToken,
    newSessionToken,
    principalFromToken,
    sessionCookie,
    webSessionExpiry,
} from '@/lib/principal';
import { isPublicCycleSession } from '@/lib/public-cycle';
import { attachPublicSessionAccess } from '@/lib/public-session-access';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';

export const dynamic = 'force-dynamic';

/**
 * Registration-free admission for the four reviewed public-cycle rooms.
 *
 * Account remains authoritative for named identities, staff and paid access,
 * but enabling the Account RP must not turn an already-public gathering into
 * a credential gate. This issues the same opaque, room-bound COMP session as
 * production and derives its redirect only from the trusted Live edge.
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

    const shouldPreserveAccountIdentity =
        !currentPrincipal ||
        (currentPrincipal.kind === 'attendee' && Boolean(currentPrincipal.accountId));
    const currentAccount = shouldPreserveAccountIdentity
        ? await accountIdentityFromToken(currentCookie)
        : null;
    if (currentAccount && currentCookie) {
        const attached = await attachPublicSessionAccess(currentCookie, session, currentAccount, now);
        if (!attached) {
            return NextResponse.json({ error: 'Session unavailable' }, { status: 409 });
        }
        return NextResponse.redirect(new URL(`/session/${id}`, origin), { status: 303 });
    }

    const entropy = randomBytes(32).toString('base64url');
    const codeDigest = createHash('sha256')
        .update(`public-cycle\0${id}\0${entropy}`)
        .digest('hex');
    const syntheticEmail = `public-${entropy.toLowerCase()}@anonymous.harmonicbeacon.invalid`;
    const issued = newSessionToken();
    const entitlementExpiresAt = new Date(Math.max(
        session.scheduledAt.getTime() + 24 * 60 * 60 * 1000,
        now.getTime() + 60 * 60 * 1000,
    ));

    await prisma.$transaction(async (transaction) => {
        const entitlement = await transaction.ticketEntitlement.create({
            data: {
                scheduledSessionId: id,
                codeDigest,
                codeLastFour: 'FREE',
                tier: 'COMP',
                state: 'BOUND',
                boundEmail: syntheticEmail,
                boundAt: now,
                expiresAt: entitlementExpiresAt,
            },
            select: { id: true },
        });
        await transaction.webSession.create({
            data: {
                tokenDigest: issued.database.tokenDigest,
                displayName: 'Participante',
                ticketEntitlementId: entitlement.id,
                expiresAt: webSessionExpiry(now),
                lastSeenAt: now,
            },
        });
    });

    const response = NextResponse.redirect(new URL(`/session/${id}`, origin), { status: 303 });
    response.cookies.set(sessionCookie(issued.cookieValue, now));
    return response;
}
