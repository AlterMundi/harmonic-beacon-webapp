import { NextRequest, NextResponse } from 'next/server';

import { createSessionJoinToken } from '@/lib/livekit-server';
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

const PRIVATE_NO_STORE = { 'Cache-Control': 'private, no-store' };

function tokenResponse(body: unknown, status = 200) {
    return NextResponse.json(body, { status, headers: PRIVATE_NO_STORE });
}

/**
 * Issue the event stage token from the current weekend WebSession entitlement.
 * The stable identity deliberately makes a new connection replace an older
 * device rather than creating a second floor identity.
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const entitlement = await resolveRoomPrincipal(request, id);
    if (!entitlement.ok) {
        return tokenResponse({ error: entitlement.error }, entitlement.status);
    }

    const { principal } = entitlement;
    try {
        const ttlSeconds = principal.ticketEntitlementId
            ? TICKET_LIVEKIT_TOKEN_TTL_SECONDS
            : STAFF_LIVEKIT_TOKEN_TTL_SECONDS;
        const tokenTtl = `${ttlSeconds}s`;
        const tokenMetadata = {
            role: principal.role,
            isAssignedFacilitator: principal.isAssignedFacilitator,
        };
        // Ticket-holder aliases remain server-side until publication is
        // explicitly activated. A subscribe-only audience JWT therefore
        // carries a neutral name even if it is inspected or replayed.
        const livekitName = principal.ticketEntitlementId
            ? 'Participant'
            : principal.displayName;
        // Every credential is subscribe-only. The connected browser requests
        // publication activation separately; that server-side step rechecks
        // the current identity and grant while holding the authority locks.
        const token = await createSessionJoinToken(
            principal.session.roomName,
            principal.identity,
            livekitName,
            tokenMetadata,
            tokenTtl,
        );

        const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
        const tokenExpiresAt = new Date(Date.now() + ttlSeconds * 1000);
        if (!cookieValue || !await finalizeRoomTokenIssue({
            cookieValue,
            principal,
            expectedIdentity: principal.identity,
            expectedCanPublish: principal.canPublish,
            tokenExpiresAt,
        })) {
            return tokenResponse({ error: 'Not authorized' }, 403);
        }

        return tokenResponse({
            token,
            identity: principal.identity,
            room: principal.session.roomName,
            canPublish: principal.canPublish,
            displayName: principal.displayName,
            role: principal.role,
            isAssignedFacilitator: principal.isAssignedFacilitator,
            // Lets the room page gate attendee-only controls (hand queue)
            // without probing an endpoint that 403s for staff.
            principalKind: principal.ticketEntitlementId ? 'ticket' : 'staff',
            session: {
                id: principal.session.id,
                title: principal.session.title,
                status: principal.session.status,
                startedAt: principal.session.startedAt?.toISOString() ?? null,
            },
        });
    } catch (error) {
        console.error(`[room-token] stage token issue failed: ${redactError(error)}`);
        return tokenResponse({ error: 'Unable to issue room token' }, 500);
    }
}
