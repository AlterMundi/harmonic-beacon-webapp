import { NextRequest, NextResponse } from 'next/server';

import {
    bedRoomIdentity,
    createBedToken,
} from '@/lib/livekit-server';
import {
    TICKET_LIVEKIT_TOKEN_TTL_SECONDS,
} from '@/lib/commerce-entitlement';
import { resolveRoomPrincipal } from '@/lib/room-entitlement';
import {
    finalizeRoomTokenIssue,
    STAFF_LIVEKIT_TOKEN_TTL_SECONDS,
} from '@/lib/room-token-issue';
import { redactError } from '@/lib/redact';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';

export const dynamic = 'force-dynamic';

const BED_ROOM_NAME = process.env.LIVEKIT_ROOM_NAME || 'beacon';
const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

function tokenResponse(body: unknown, status = 200) {
    return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE });
}

/**
 * Issue an audio-only, subscribe-only connection to the configured Beacon bed.
 * sessionId is mandatory so this endpoint performs the exact same current
 * entitlement check as the stage token.
 */
export async function GET(request: NextRequest) {
    const sessionId = request.nextUrl.searchParams.get('sessionId')?.trim();
    if (!sessionId) {
        return tokenResponse({ error: 'sessionId is required' }, 400);
    }

    const entitlement = await resolveRoomPrincipal(request, sessionId);
    if (!entitlement.ok) {
        return tokenResponse({ error: entitlement.error }, entitlement.status);
    }

    try {
        const identity = bedRoomIdentity(entitlement.principal.identity);
        const ticketId = entitlement.principal.ticketEntitlementId;
        const ttlSeconds = ticketId
            ? TICKET_LIVEKIT_TOKEN_TTL_SECONDS
            : STAFF_LIVEKIT_TOKEN_TTL_SECONDS;
        const token = ticketId
            ? await createBedToken(
                BED_ROOM_NAME,
                identity,
                `${ttlSeconds}s`,
            )
            : await createBedToken(BED_ROOM_NAME, identity, `${ttlSeconds}s`);
        const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
        const tokenExpiresAt = new Date(Date.now() + ttlSeconds * 1000);
        if (!cookieValue || !await finalizeRoomTokenIssue({
            cookieValue,
            principal: entitlement.principal,
            expectedIdentity: entitlement.principal.identity,
            expectedCanPublish: entitlement.principal.canPublish,
            tokenExpiresAt,
        })) {
            return tokenResponse({ error: 'Not authorized' }, 403);
        }
        return tokenResponse({
            token,
            identity,
            room: BED_ROOM_NAME,
            canPublish: false,
        });
    } catch (error) {
        console.error(`[room-token] bed token issue failed: ${redactError(error)}`);
        return tokenResponse({ error: 'Unable to issue room token' }, 500);
    }
}
