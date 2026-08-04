import { NextRequest, NextResponse } from 'next/server';
import { TrackSource } from 'livekit-server-sdk';

import { requireStaff } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getRoomService } from '@/lib/livekit-server';
import { eventStaffPolicy } from '@/lib/staff-capabilities';
import { tapestryInternalUrl, tapestryParticipantId } from '@/lib/tapestry';
import {
    buildTapestryManifest,
    MAX_TAPESTRY_MANIFEST_ENTRIES,
    type ManifestLiveParticipant,
    type ManifestParticipant,
} from '@/lib/tapestry-manifest';

export const dynamic = 'force-dynamic';

const DEFAULT_TAPESTRY_FRAME_TTL_MS = 10_000;
const THUMBNAIL_REFRESH_MS = 5_000;
const TAPESTRY_LOOKUP_TIMEOUT_MS = 750;

/**
 * Staff-only operational tapestry manifest (TAP-02, issue #129).
 *
 * One bounded response per poll: the tapestry tiles in display order joined
 * with the authorized name, hand queue, presence and camera state of each
 * person. Three lookups total — one database read, one LiveKit participant
 * list, one internal tapestry list — so 150 participants cost the same as
 * one. Thumbnails are referenced as epoch-versioned proxy URLs the browser
 * caches within the refresh window; the route itself never fetches frames.
 *
 * Authorization matches the sibling tapestry routes: any staff session plus
 * the event-scoped `canOperateEvent` policy. The payload is `private,
 * no-store` and carries opaque tile ids only.
 */

type TapestryListSnapshot = {
    tileIds: string[];
    frameTtlMs: number;
};

async function fetchTapestryTileList(sessionId: string): Promise<TapestryListSnapshot | null> {
    const internalUrl = tapestryInternalUrl();
    if (!internalUrl || !process.env.TAPESTRY_INTERNAL_SECRET) {
        return null;
    }
    try {
        const response = await fetch(
            `${internalUrl}/tapestry/sessions/${encodeURIComponent(sessionId)}/participants`,
            {
                headers: {
                    'x-tapestry-internal-secret': process.env.TAPESTRY_INTERNAL_SECRET,
                },
                cache: 'no-store',
                signal: AbortSignal.timeout(TAPESTRY_LOOKUP_TIMEOUT_MS),
            },
        );
        if (!response.ok) return null;
        const body = await response.json() as { participants?: unknown; frameTtlMs?: unknown };
        if (
            !Array.isArray(body.participants) ||
            body.participants.length > MAX_TAPESTRY_MANIFEST_ENTRIES
        ) {
            return null;
        }
        const tileIds = body.participants.filter(
            (value): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value),
        );
        if (tileIds.length !== body.participants.length) return null;
        const frameTtlMs = typeof body.frameTtlMs === 'number' &&
            Number.isFinite(body.frameTtlMs) &&
            body.frameTtlMs >= 1_000 &&
            body.frameTtlMs <= 60_000
            ? body.frameTtlMs
            : DEFAULT_TAPESTRY_FRAME_TTL_MS;
        return { tileIds, frameTtlMs };
    } catch {
        return null;
    }
}

function trackSourceLabel(source: TrackSource): string {
    switch (source) {
        case TrackSource.CAMERA:
            return 'CAMERA';
        case TrackSource.MICROPHONE:
            return 'MICROPHONE';
        case TrackSource.SCREEN_SHARE:
            return 'SCREEN_SHARE';
        case TrackSource.SCREEN_SHARE_AUDIO:
            return 'SCREEN_SHARE_AUDIO';
        default:
            return 'UNKNOWN';
    }
}

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
) {
    const [staff, errorResponse] = await requireStaff();
    if (!staff) {
        return errorResponse;
    }
    const { id } = await params;
    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id },
        select: {
            id: true,
            roomName: true,
            facilitatorId: true,
            participants: {
                select: {
                    participantIdentity: true,
                    leftAt: true,
                    raisedAt: true,
                    publishGrantedAt: true,
                    publishRevokedAt: true,
                    staffUser: { select: { name: true } },
                },
            },
        },
    });
    if (!scheduledSession) {
        return NextResponse.json({ error: 'session_not_found' }, { status: 404 });
    }
    if (!eventStaffPolicy(
        staff.role,
        scheduledSession.facilitatorId === staff.userId,
    ).canOperateEvent) {
        return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // The tapestry list is required: without it there is no tapestry to
    // annotate, and an empty manifest would lie about the room. Degrade to
    // the same dignified 503 as the sibling routes instead.
    const tapestrySnapshot = await fetchTapestryTileList(scheduledSession.id);
    if (!tapestrySnapshot) {
        return NextResponse.json({ error: 'Tapestry unavailable' }, { status: 503 });
    }

    // LiveKit is advisory: an outage marks presence/camera unknown without
    // hiding names, hands or tiles.
    let liveStateAvailable = true;
    let live = new Map<string, ManifestLiveParticipant>();
    try {
        live = new Map(
            (await getRoomService().listParticipants(scheduledSession.roomName))
                .map((participant) => [
                    participant.identity,
                    {
                        name: participant.name,
                        media: participant.tracks.map((track) => ({
                            source: trackSourceLabel(track.source),
                            muted: track.muted,
                        })),
                    },
                ]),
        );
    } catch {
        liveStateAvailable = false;
    }

    const participants: ManifestParticipant[] = scheduledSession.participants.map(
        (participant) => ({
            identity: participant.participantIdentity,
            leftAt: participant.leftAt,
            raisedAt: participant.raisedAt,
            publishGrantedAt: participant.publishGrantedAt,
            publishRevokedAt: participant.publishRevokedAt,
            staffName: participant.staffUser?.name ?? null,
        }),
    );

    const thumbnailEpoch = Math.floor(Date.now() / THUMBNAIL_REFRESH_MS);
    const manifest = buildTapestryManifest({
        sessionId: scheduledSession.id,
        tileIds: tapestrySnapshot.tileIds,
        frameTtlMs: tapestrySnapshot.frameTtlMs,
        liveStateAvailable,
        participants,
        live,
        tapestryIdFor: (identity) => {
            try {
                return tapestryParticipantId(identity);
            } catch {
                return null;
            }
        },
        thumbnailUrlFor: (tileId) =>
            `/api/ops/sessions/${encodeURIComponent(scheduledSession.id)}/tapestry/tiles/${encodeURIComponent(tileId)}?v=${thumbnailEpoch}`,
    });

    return NextResponse.json(manifest, {
        headers: { 'cache-control': 'private, no-store' },
    });
}
