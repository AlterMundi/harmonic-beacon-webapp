import { NextRequest, NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { getRoomService } from '@/lib/livekit-server';
import { resolveRoomViewer } from '@/lib/room-entitlement';
import { tapestryInternalUrl, tapestryParticipantId } from '@/lib/tapestry';
import { parseCompositeLayout, type CompositeLayout } from '@/lib/tapestry-layout';

export const dynamic = 'force-dynamic';

const LAYOUT_LOOKUP_TIMEOUT_MS = 750;
/** Hard bound on the historical hand query; the live filter narrows it further. */
const MAX_HAND_CANDIDATES = 150;

/**
 * Public raised-hand names for the attendee tapestry (TAP-02, issue #129).
 *
 * The collective tapestry stays a single JPEG without identity metadata;
 * this sidecar only names the people who chose to raise their hand — an
 * explicit request for the floor — and only while they remain connected.
 * It is deliberately not a directory: no camera state, no presence of
 * anyone else, no thumbnails, and a hand that lowers or disconnects
 * disappears on the next poll.
 *
 * Each hand optionally carries its cell in the composite grid so the room
 * can draw the name over the person's own tile (the Zoom/Meet reading of
 * #129). Cells come from the internal layout endpoint, which is captured
 * by the same build as the served composite; the client only draws the
 * overlay when this layout's `revision` matches the composite's
 * `x-tapestry-revision`, so a name can never land on the wrong person.
 *
 * The gate is a read-only room viewer: it validates the web session,
 * entitlement and event correspondence exactly like the token route, but
 * performs zero writes — no participant upsert, no `leftAt` clearing, no
 * presence revival. A polling GET must never mutate state. When LiveKit is
 * unreachable the route names nobody rather than listing people whose
 * presence it cannot confirm.
 */

type PublicHand = {
    name: string;
    column: number | null;
    row: number | null;
};

async function fetchCompositeLayout(sessionId: string): Promise<CompositeLayout | null> {
    const internalUrl = tapestryInternalUrl();
    if (!internalUrl || !process.env.TAPESTRY_INTERNAL_SECRET) {
        return null;
    }
    try {
        const response = await fetch(
            `${internalUrl}/tapestry/sessions/${encodeURIComponent(sessionId)}/layout`,
            {
                headers: {
                    'x-tapestry-internal-secret': process.env.TAPESTRY_INTERNAL_SECRET,
                },
                cache: 'no-store',
                signal: AbortSignal.timeout(LAYOUT_LOOKUP_TIMEOUT_MS),
            },
        );
        if (!response.ok) return null;
        // Fail safe: a malformed or duplicate-bearing layout is "no overlay",
        // never a trusted grid. Nothing internal is logged.
        return parseCompositeLayout(await response.json());
    } catch {
        return null;
    }
}

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const { id } = await params;
    const entitlement = await resolveRoomViewer(request, id);
    if (!entitlement.ok) {
        return NextResponse.json(
            { error: entitlement.error },
            { status: entitlement.status },
        );
    }

    const [participants, liveIdentities, layout] = await Promise.all([
        prisma.sessionParticipant.findMany({
            where: {
                scheduledSessionId: id,
                raisedAt: { not: null },
            },
            orderBy: { raisedAt: 'asc' },
            take: MAX_HAND_CANDIDATES,
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
        fetchCompositeLayout(id),
    ]);

    if (!liveIdentities) {
        return NextResponse.json(
            { hands: [] as PublicHand[], liveStateAvailable: false, layout: null },
            { headers: { 'cache-control': 'private, no-store' } },
        );
    }

    const cellByTileId = new Map(
        (layout?.cells ?? []).map((cell) => [cell.id, cell] as const),
    );
    const hands: PublicHand[] = participants
        // Waiting hands only: no active publish grant, past or present.
        .filter((participant) =>
            participant.publishGrantedAt === null ||
            participant.publishRevokedAt !== null,
        )
        .filter((participant) => liveIdentities.has(participant.participantIdentity))
        .map((participant) => {
            let cell: { column: number; row: number } | null = null;
            try {
                cell = cellByTileId.get(
                    tapestryParticipantId(participant.participantIdentity),
                ) ?? null;
            } catch {
                // A missing/invalid internal secret means no overlay, never
                // a configuration detail.
            }
            return {
                name: participant.staffUser?.name ??
                    (liveIdentities.get(participant.participantIdentity) || 'Attendee'),
                column: cell?.column ?? null,
                row: cell?.row ?? null,
            };
        });

    return NextResponse.json(
        {
            hands,
            liveStateAvailable: true,
            layout: layout
                ? {
                    revision: layout.revision,
                    columns: layout.columns,
                    rows: layout.rows,
                    tileSizePx: layout.tileSizePx,
                }
                : null,
        },
        { headers: { 'cache-control': 'private, no-store' } },
    );
}
