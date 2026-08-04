import { createHash } from 'node:crypto';

/**
 * Canonical staff-only tapestry manifest (TAP-02, issue #129).
 *
 * The manifest annotates the tapestry tiles the internal service already
 * renders: who raised their hand, their authorized name, presence, camera
 * state and thumbnail freshness. It is the single bounded response the
 * operational surface polls — one database read, one LiveKit list and one
 * tapestry list per build, never a query per tile.
 *
 * Privacy invariants:
 * - `tileId` is the opaque HMAC id from `@/lib/tapestry`; LiveKit identities,
 *   names and emails never appear in keys, URLs or logs.
 * - Names come from the already-authorized sources the participants endpoint
 *   uses (staff account name, LiveKit display name, or the 'Attendee'
 *   fallback). Nothing new is collected.
 * - A tile only exists here while the internal service holds a current
 *   consented frame; consent withdrawal or TTL expiry removes the tile and
 *   the entry with it. The UI fallback never distinguishes *why*.
 *
 * This module is pure: no database, LiveKit, fetch, clock or localization,
 * so the contract is testable without mocks.
 */

export const MAX_TAPESTRY_MANIFEST_ENTRIES = 150;

export type TapestryPresence = 'connected' | 'reconnecting' | 'left' | 'unknown';
export type TapestryCamera = 'on' | 'off' | 'unknown';

export type TapestryManifestEntry = {
    /** Opaque tapestry participant id (`tp-…`), never a LiveKit identity. */
    tileId: string;
    /** Display order index, matching the arrangement the service composes. */
    position: number;
    displayName: string;
    handRaised: boolean;
    /** 1-based position among waiting hands; null when not waiting. */
    queuePosition: number | null;
    presence: TapestryPresence;
    camera: TapestryCamera;
    /** Staff tile proxy URL, or null when no current consented frame exists. */
    thumbnailUrl: string | null;
};

export type TapestryManifestWaitingHand = {
    displayName: string;
    queuePosition: number;
    /** Null when the person has no tile in the tapestry (no consented frame). */
    tileId: string | null;
};

export type TapestryManifest = {
    sessionId: string;
    /**
     * Content hash of order + per-tile state. Clients compare revisions to
     * detect change cheaply and never render stale state as current.
     */
    revision: string;
    thumbnailFreshForSeconds: number;
    liveStateAvailable: boolean;
    entries: TapestryManifestEntry[];
    /** Every waiting hand, including those without a tile. */
    waitingHands: TapestryManifestWaitingHand[];
};

/** Database participant row projected to what the manifest needs. */
export type ManifestParticipant = {
    identity: string;
    leftAt: Date | null;
    raisedAt: Date | null;
    publishGrantedAt: Date | null;
    publishRevokedAt: Date | null;
    staffName: string | null;
};

/** LiveKit presence projected to what the manifest needs. */
export type ManifestLiveParticipant = {
    name: string;
    media: Array<{ source: string; muted: boolean }>;
};

export type BuildTapestryManifestInput = {
    sessionId: string;
    /** Tile ids in display order, as listed by the internal service. */
    tileIds: string[];
    frameTtlMs: number;
    liveStateAvailable: boolean;
    participants: ManifestParticipant[];
    live: ReadonlyMap<string, ManifestLiveParticipant>;
    /** Maps a LiveKit identity to its opaque tile id; null when unmappable. */
    tapestryIdFor: (identity: string) => string | null;
    /** Builds the staff thumbnail proxy URL for a tile. */
    thumbnailUrlFor: (tileId: string) => string;
};

function hasActiveGrant(participant: ManifestParticipant): boolean {
    return participant.publishGrantedAt !== null &&
        participant.publishRevokedAt === null;
}

function isWaiting(participant: ManifestParticipant): boolean {
    return participant.raisedAt !== null && !hasActiveGrant(participant);
}

function displayNameFor(
    participant: ManifestParticipant | null,
    live: ManifestLiveParticipant | undefined,
): string {
    return participant?.staffName ?? (live?.name.trim() || 'Attendee');
}

function presenceFor(
    participant: ManifestParticipant | null,
    live: ManifestLiveParticipant | undefined,
    liveStateAvailable: boolean,
): TapestryPresence {
    if (participant?.leftAt) return 'left';
    if (!liveStateAvailable) return 'unknown';
    if (live) return 'connected';
    return 'reconnecting';
}

function cameraFor(
    live: ManifestLiveParticipant | undefined,
): TapestryCamera {
    if (!live) return 'unknown';
    const cameraTrack = live.media.find((track) => track.source === 'CAMERA');
    return cameraTrack && !cameraTrack.muted ? 'on' : 'off';
}

function revisionFor(
    tileIds: string[],
    entries: TapestryManifestEntry[],
    waitingHands: TapestryManifestWaitingHand[],
): string {
    const state = entries.map((entry) => [
        entry.tileId,
        entry.displayName,
        entry.handRaised ? 1 : 0,
        entry.queuePosition ?? 0,
        entry.presence,
        entry.camera,
        entry.thumbnailUrl ? 1 : 0,
    ]);
    const waiting = waitingHands.map((hand) => [
        hand.displayName,
        hand.queuePosition,
        hand.tileId ?? '',
    ]);
    return createHash('sha256')
        .update(JSON.stringify([tileIds, state, waiting]))
        .digest('hex')
        .slice(0, 16);
}

export function buildTapestryManifest(
    input: BuildTapestryManifestInput,
): TapestryManifest {
    const tileIds = input.tileIds.slice(0, MAX_TAPESTRY_MANIFEST_ENTRIES);
    const tileSet = new Set(tileIds);

    // Index database participants by their opaque tile id. Participants whose
    // identity cannot be mapped (e.g. missing internal secret) are skipped
    // rather than leaking configuration detail.
    const byTileId = new Map<string, ManifestParticipant>();
    const liveByTileId = new Map<string, ManifestLiveParticipant>();
    for (const participant of input.participants) {
        const tileId = input.tapestryIdFor(participant.identity);
        if (!tileId) continue;
        byTileId.set(tileId, participant);
        const live = input.live.get(participant.identity);
        if (live) liveByTileId.set(tileId, live);
    }

    // Waiting hands in queue order, computed once so tiles and the summary
    // agree. Ties fall back to identity for a stable order, matching the
    // hand queue's tie-break rule.
    const waiting = input.participants
        .filter(isWaiting)
        .sort((a, b) => {
            const delta = a.raisedAt!.getTime() - b.raisedAt!.getTime();
            return delta !== 0 ? delta : a.identity.localeCompare(b.identity);
        });
    const queuePositionByIdentity = new Map<string, number>();
    const waitingHands: TapestryManifestWaitingHand[] = waiting.map(
        (participant, index) => {
            const tileId = input.tapestryIdFor(participant.identity);
            const queuePosition = index + 1;
            queuePositionByIdentity.set(participant.identity, queuePosition);
            return {
                displayName: displayNameFor(
                    participant,
                    input.live.get(participant.identity),
                ),
                queuePosition,
                tileId: tileId && tileSet.has(tileId) ? tileId : null,
            };
        },
    );

    const entries: TapestryManifestEntry[] = tileIds.map((tileId, position) => {
        const participant = byTileId.get(tileId) ?? null;
        const live = liveByTileId.get(tileId);
        const queuePosition = participant
            ? queuePositionByIdentity.get(participant.identity) ?? null
            : null;
        return {
            tileId,
            position,
            displayName: displayNameFor(participant, live),
            handRaised: queuePosition !== null,
            queuePosition,
            presence: presenceFor(participant, live, input.liveStateAvailable),
            camera: cameraFor(live),
            thumbnailUrl: input.thumbnailUrlFor(tileId),
        };
    });

    return {
        sessionId: input.sessionId,
        revision: revisionFor(tileIds, entries, waitingHands),
        thumbnailFreshForSeconds: Math.max(1, Math.ceil(input.frameTtlMs / 1_000)),
        liveStateAvailable: input.liveStateAvailable,
        entries,
        waitingHands,
    };
}
