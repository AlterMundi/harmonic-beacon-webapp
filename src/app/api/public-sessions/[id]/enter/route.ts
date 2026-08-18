import { createHash, randomBytes } from 'node:crypto';

import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { isPublicCycleSession } from '@/lib/public-cycle';
import {
    newSessionToken,
    principalFromToken,
    sessionCookie,
    webSessionExpiry,
} from '@/lib/principal';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';

export const dynamic = 'force-dynamic';

const PUBLIC_APP_ORIGIN = 'https://live.harmonicbeacon.com';

/**
 * Registration-free admission for the four public cycle rooms. The visitor
 * receives an opaque COMP entitlement; no name, email or ticket is requested.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    if (!isPublicCycleSession(id)) {
        return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const currentCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const currentPrincipal = await principalFromToken(currentCookie);
    if (
        currentPrincipal?.kind === 'attendee' &&
        currentPrincipal.scheduledSessionId === id
    ) {
        return NextResponse.redirect(new URL(`/session/${id}`, PUBLIC_APP_ORIGIN), {
            status: 303,
        });
    }

    const now = new Date();
    const session = await prisma.scheduledSession.findUnique({
        where: { id },
        select: { id: true, scheduledAt: true, status: true, isTest: true },
    });
    if (
        !session ||
        session.isTest ||
        !['SCHEDULED', 'LIVE'].includes(session.status)
    ) {
        return NextResponse.json({ error: 'Session unavailable' }, { status: 404 });
    }

    const entropy = randomBytes(32).toString('base64url');
    const codeDigest = createHash('sha256')
        .update(`public-cycle\0${id}\0${entropy}`)
        .digest('hex');
    const syntheticEmail = `public-${entropy.toLowerCase()}@anonymous.harmonicbeacon.invalid`;
    const issued = newSessionToken();
    const entitlementExpiresAt = new Date(
        Math.max(
            session.scheduledAt.getTime() + 24 * 60 * 60 * 1000,
            now.getTime() + 60 * 60 * 1000,
        ),
    );

    await prisma.$transaction(async (tx) => {
        const entitlement = await tx.ticketEntitlement.create({
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
        await tx.webSession.create({
            data: {
                tokenDigest: issued.database.tokenDigest,
                displayName: 'Participante',
                ticketEntitlementId: entitlement.id,
                expiresAt: webSessionExpiry(now),
                lastSeenAt: now,
            },
        });
    });

    const response = NextResponse.redirect(
        new URL(`/session/${id}`, PUBLIC_APP_ORIGIN),
        { status: 303 },
    );
    response.cookies.set(sessionCookie(issued.cookieValue, now));
    return response;
}
