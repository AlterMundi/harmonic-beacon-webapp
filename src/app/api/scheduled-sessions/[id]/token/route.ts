import { NextRequest, NextResponse } from 'next/server';

import { createSessionToken } from '@/lib/livekit-server';
import {
    finalizeTicketTokenIssue,
    TICKET_LIVEKIT_TOKEN_TTL_SECONDS,
} from '@/lib/commerce-entitlement';
import { resolveRoomPrincipal } from '@/lib/room-entitlement';
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
        const ticketTtl = `${TICKET_LIVEKIT_TOKEN_TTL_SECONDS}s`;
        const tokenMetadata = {
            role: principal.role,
            isAssignedFacilitator: principal.isAssignedFacilitator,
        };
        const token = principal.ticketEntitlementId
            ? await createSessionToken(
                principal.session.roomName,
                principal.identity,
                principal.displayName,
                principal.canPublish,
                tokenMetadata,
                ticketTtl,
            )
            : await createSessionToken(
                principal.session.roomName,
                principal.identity,
                principal.displayName,
                principal.canPublish,
                tokenMetadata,
            );

        if (principal.ticketEntitlementId) {
            const cookieValue = request.cookies.get(SESSION_COOKIE_NAME)?.value;
            const tokenExpiresAt = new Date(Date.now() + TICKET_LIVEKIT_TOKEN_TTL_SECONDS * 1000);
            if (!cookieValue || !await finalizeTicketTokenIssue(
                cookieValue,
                principal.ticketEntitlementId,
                tokenExpiresAt,
            )) {
                return tokenResponse({ error: 'Not authorized' }, 403);
            }
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
    } catch {
        return tokenResponse({ error: 'LiveKit API credentials not configured' }, 500);
    }
}
