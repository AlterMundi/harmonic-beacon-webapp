import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { getRoomService } from '@/lib/livekit-server';
import { resolveRoomPrincipal } from '@/lib/room-entitlement';

export const dynamic = 'force-dynamic';

/**
 * Public raised-hand names for the attendee tapestry (TAP-02, issue #129).
 *
 * The collective tapestry stays a single JPEG without identity metadata;
 * this sidecar only names the people who chose to raise their hand — an
 * explicit request for the floor — and only while they remain connected.
 * It is deliberately not a directory: no tile position, no camera state,
 * no presence of anyone else, no thumbnails, and a hand that lowers or
 * disconnects disappears on the next poll.
 *
 * The gate is the same `resolveRoomPrincipal` entitlement check the room
 * token route uses, so only this event's attendees (and its operators) can
 * read the list. When LiveKit is unreachable the route names nobody rather
 * than listing people whose presence it cannot confirm.
 */

type PublicHand = { name: string };

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

    const [participants, liveIdentities] = await Promise.all([
        prisma.sessionParticipant.findMany({
            where: {
                scheduledSessionId: id,
                raisedAt: { not: null },
            },
            orderBy: { raisedAt: 'asc' },
            select: {
                participantIdentity: true,
                publishGrantedAt: true,
                publishRevokedAt: true,
                staffUser: { select: { name: true } },
            },
        }),
        getRoomService()
            .listParticipants(entitlement.principal.session.roomName)
            .then(
                (live) => new Map(live.map((p) => [p.identity, p.name.trim()] as const)),
                () => null,
            ),
    ]);

    if (!liveIdentities) {
        return NextResponse.json(
            { hands: [] as PublicHand[], liveStateAvailable: false },
            { headers: { 'cache-control': 'private, no-store' } },
        );
    }

    const hands: PublicHand[] = participants
        // Waiting hands only: no active publish grant, past or present.
        .filter((participant) =>
            participant.publishGrantedAt === null ||
            participant.publishRevokedAt !== null,
        )
        .filter((participant) => liveIdentities.has(participant.participantIdentity))
        .map((participant) => ({
            name: participant.staffUser?.name ??
                (liveIdentities.get(participant.participantIdentity) || 'Attendee'),
        }));

    return NextResponse.json(
        { hands, liveStateAvailable: true },
        { headers: { 'cache-control': 'private, no-store' } },
    );
}
