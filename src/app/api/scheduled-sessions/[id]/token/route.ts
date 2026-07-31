import { NextRequest, NextResponse } from 'next/server';

import { createSessionToken } from '@/lib/livekit-server';
import { resolveRoomPrincipal } from '@/lib/room-entitlement';

export const dynamic = 'force-dynamic';

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
        return NextResponse.json(
            { error: entitlement.error },
            { status: entitlement.status },
        );
    }

    const { principal } = entitlement;
    try {
        const token = await createSessionToken(
            principal.session.roomName,
            principal.identity,
            principal.displayName,
            principal.canPublish,
        );

        return NextResponse.json({
            token,
            identity: principal.identity,
            room: principal.session.roomName,
            canPublish: principal.canPublish,
            displayName: principal.displayName,
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
        return NextResponse.json(
            { error: 'LiveKit API credentials not configured' },
            { status: 500 },
        );
    }
}
