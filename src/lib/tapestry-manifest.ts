import { createHash } from 'node:crypto';

import type { CompositeLayout } from '@/lib/tapestry-layout';

/**
 * Canonical staff-only tapestry manifest (TAP-02, issue #129).
 *
 * The manifest annotates the composite the internal tapestry service already
 * builds: who each tile is (authorized display name only), whether their
 * hand is raised and where in the queue, their presence and camera state —
 * plus the grid cell each tile occupies so the cockpit can draw everything
 * as semantic overlays over ONE shared composite image (O(1) visual
 * transport: no per-tile thumbnail URLs).
 *
 * Privacy contract: entries are keyed by the opaque tapestry tile id (HMAC),
 * never by LiveKit identity or any internal id. Names come from the
 * confirmed event alias / staff account name stored in PostgreSQL. LiveKit's
 * audience name is intentionally neutral and is never the authority for a
 * known participant. Nothing here exposes emails, ticket ids, LiveKit
 * identities or join history.
 *
 * Truthfulness contract: the manifest never invents state. Tiles come from
 * the service's build-time layout; presence/camera fall back to 'unknown'
 * when LiveKit is unreachable; `layout` is null when the service has not
 * built a composite yet, and overlays only render when the manifest layout
 * revision matches the composite's `x-tapestry-revision`.
 */

export type TapestryPresence = 'connected' | 'reconnecting' | 'left' | 'unknown';
export type TapestryCamera = 'on' | 'off' | 'unknown';

export type TapestryManifestEntry = {
    /** Opaque tile id (HMAC of the room identity) — safe to render, never reversible. */
    tileId: string;
    /** Authorized display name (staff account name or room display name). */
    displayName: string;
    handRaised: boolean;
    /** 1-based position among waiting hands; null when no hand is raised. */
    queuePosition: number | null;
    presence: TapestryPresence;
    camera: TapestryCamera;
    /** Grid cell in the composite this manifest's `layout` describes. */
    column: number;
    row: number;
};

export type TapestryManifestWaitingHand = {
    displayName: string;
    queuePosition: number;
    /** Null when the person has no tapestry tile (e.g. snapshot not shared). */
    tileId: string | null;
};

export type TapestryManifestLayout = {
    /** Build revision of the composite this layout was captured with. */
    revision: number;
    columns: number;
    rows: number;
    tileSizePx: number;
};

export type TapestryManifest = {
    sessionId: string;
    /**
     * Cheap change detector for the semantic state (order, hands, presence,
     * camera, names). Clients re-render annotations only when it changes —
     * visual freshness is the composite image's own concern, refreshed every
     * poll regardless of this revision.
     */
    revision: string;
    /** False when LiveKit presence could not be read; presence entries are 'unknown'. */
    liveStateAvailable: boolean;
    /** Grid + build revision from the internal service; null when never built. */
    layout: TapestryManifestLayout | null;
    /** How long a participant tile stays fresh without a new frame; null if unknown. */
    tileFreshForSeconds: number | null;
    entries: TapestryManifestEntry[];
    /** Waiting hands without a tile, so staff still sees them truthfully. */
    waitingHands: TapestryManifestWaitingHand[];
};

export type ManifestParticipant = {
    identity: string;
    displayName: string | null;
    leftAt: Date | null;
    raisedAt: Date | null;
    publishGrantedAt: Date | null;
    publishRevokedAt: Date | null;
    staffName: string | null;
};

export type ManifestLiveParticipant = {
    name: string;
    /** LiveKit track list; a CAMERA source track means video published. */
    media: Array<{ source: string; muted: boolean }>;
};

export type BuildTapestryManifestInput = {
    sessionId: string;
    /** Validated internal layout (cells already bounded and deduplicated). */
    layout: CompositeLayout | null;
    liveStateAvailable: boolean;
    participants: ManifestParticipant[];
    live: ReadonlyMap<string, ManifestLiveParticipant>;
    /** Maps a room identity to its opaque tapestry tile id. */
    tapestryIdFor: (identity: string) => string;
};

function hasActiveGrant(participant: ManifestParticipant): boolean {
    return participant.publishGrantedAt !== null && participant.publishRevokedAt === null;
}

function isWaitingHand(participant: ManifestParticipant): boolean {
    return participant.raisedAt !== null && !hasActiveGrant(participant);
}

function displayNameFor(
    participant: ManifestParticipant | null,
    live: ReadonlyMap<string, ManifestLiveParticipant>,
    identity: string | null,
): string {
    return (
        participant?.staffName ??
        participant?.displayName?.trim() ??
        (identity ? live.get(identity)?.name.trim() : '') ??
        'Attendee'
    ) || 'Attendee';
}

function presenceFor(
    participant: ManifestParticipant | null,
    live: ReadonlyMap<string, ManifestLiveParticipant>,
    liveStateAvailable: boolean,
): TapestryPresence {
    if (participant?.leftAt) {
        return 'left';
    }
    if (!liveStateAvailable) {
        return 'unknown';
    }
    if (participant && live.has(participant.identity)) {
        return 'connected';
    }
    // No explicit leave and not in the room right now: they may return.
    return 'reconnecting';
}

function cameraFor(
    liveParticipant: ManifestLiveParticipant | undefined,
): TapestryCamera {
    if (!liveParticipant) {
        return 'unknown';
    }
    return liveParticipant.media.some((track) => track.source === 'CAMERA' && !track.muted)
        ? 'on'
        : 'off';
}

/**
 * Build the staff manifest from already-fetched state. Pure and total: no
 * I/O, no clocks, no secrets — every rule is testable here.
 */
export function buildTapestryManifest(input: BuildTapestryManifestInput): TapestryManifest {
    const byTileId = new Map<string, ManifestParticipant>();
    for (const participant of input.participants) {
        byTileId.set(input.tapestryIdFor(participant.identity), participant);
    }

    const liveByTileId = new Map<string, ManifestLiveParticipant>();
    for (const participant of input.participants) {
        const liveParticipant = input.live.get(participant.identity);
        if (liveParticipant) {
            liveByTileId.set(input.tapestryIdFor(participant.identity), liveParticipant);
        }
    }

    // Queue positions derive from raisedAt order across ALL waiting hands,
    // not just tiled ones — the SpotlightConsole counts the same people.
    const waiting = input.participants
        .filter(isWaitingHand)
        .sort((a, b) => (a.raisedAt?.getTime() ?? 0) - (b.raisedAt?.getTime() ?? 0));
    const queuePositionByTileId = new Map<string, number>();
    waiting.forEach((participant, index) => {
        queuePositionByTileId.set(input.tapestryIdFor(participant.identity), index + 1);
    });

    const cells = input.layout?.cells ?? [];
    const entries: TapestryManifestEntry[] = cells.map((cell) => {
        const participant = byTileId.get(cell.id) ?? null;
        return {
            tileId: cell.id,
            displayName: displayNameFor(participant, input.live, participant?.identity ?? null),
            handRaised: participant ? isWaitingHand(participant) : false,
            queuePosition: queuePositionByTileId.get(cell.id) ?? null,
            presence: presenceFor(participant, input.live, input.liveStateAvailable),
            camera: cameraFor(liveByTileId.get(cell.id)),
            column: cell.column,
            row: cell.row,
        };
    });

    const waitingHands: TapestryManifestWaitingHand[] = waiting.map((participant, index) => {
        const tileId = input.tapestryIdFor(participant.identity);
        return {
            displayName: displayNameFor(participant, input.live, participant.identity),
            queuePosition: index + 1,
            tileId: byTileId.has(tileId) && cells.some((cell) => cell.id === tileId)
                ? tileId
                : null,
        };
    });

    const revision = createHash('sha256')
        .update(JSON.stringify(entries.map((entry) => [
            entry.tileId,
            entry.displayName,
            entry.handRaised,
            entry.queuePosition,
            entry.presence,
            entry.camera,
            entry.column,
            entry.row,
        ])))
        .update(JSON.stringify(waitingHands))
        .digest('hex')
        .slice(0, 16);

    return {
        sessionId: input.sessionId,
        revision,
        liveStateAvailable: input.liveStateAvailable,
        layout: input.layout
            ? {
                revision: input.layout.revision,
                columns: input.layout.columns,
                rows: input.layout.rows,
                tileSizePx: input.layout.tileSizePx,
            }
            : null,
        tileFreshForSeconds: input.layout?.frameTtlMs
            ? Math.max(1, Math.round(input.layout.frameTtlMs / 1000))
            : null,
        entries,
        waitingHands,
    };
}
