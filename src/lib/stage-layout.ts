/**
 * Stage layout policy for the weekend six-publisher room.
 *
 * WEEKEND_MVP_ROADMAP.md §1 "Media contract": the stage carries Julián plus up
 * to five promoted participants. "The active speaker/Julián tile requests the
 * 720p layer; at most five auxiliary tiles request 360p."
 *
 * This module is deliberately free of React and of `livekit-client`: which
 * publisher owns the spotlight is a policy decision that must be provable
 * without a browser, a room, or a mocked SDK. The components in
 * `src/components/session/` render whatever this returns.
 */

/** Pinned by the schema and the token route (WS1-01), not by the client. */
export const STAGE_MAX_PUBLISHERS = 6;

/** One of the six slots is the spotlight, so five auxiliaries remain. */
export const MAX_AUXILIARY_TILES = STAGE_MAX_PUBLISHERS - 1;

export interface StageVideoDimensions {
    width: number;
    height: number;
}

/** Layer the spotlight tile asks the SFU for. */
export const SPOTLIGHT_DIMENSIONS: StageVideoDimensions = { width: 1280, height: 720 };

/** Layer every auxiliary tile asks the SFU for. */
export const AUXILIARY_DIMENSIONS: StageVideoDimensions = { width: 640, height: 360 };

/**
 * Mirrors `ConnectionQuality` from `livekit-client`, as plain strings so the
 * tile component never imports the SDK.
 */
export type StageConnectionQuality = 'excellent' | 'good' | 'poor' | 'lost' | 'unknown';

export interface StagePublisher {
    /** Stable, event-scoped, non-PII identity minted by WS2-01. */
    identity: string;
    /** Role word from the token route ("Facilitator", "Attendee", ...). */
    label: string;
    isLocal: boolean;
    isFacilitator: boolean;
    isSpeaking: boolean;
    /** A camera track is published and unmuted. */
    cameraOn: boolean;
    /** A microphone track is published and unmuted. */
    micOn: boolean;
    connectionQuality: StageConnectionQuality;
    /**
     * Monotonic order in which this client first saw the identity hold a stage
     * grant. Ascending, gap-free per client, and never recycled — so tiles keep
     * their slot across an active-speaker change, and a rejoin puts the same
     * identities back in the same places.
     */
    grantOrder: number;
}

export interface StageArrangement<T> {
    spotlight: T | null;
    auxiliaries: T[];
    /**
     * Publishers beyond the six-slot cap. The server-side reservation (WS3-01)
     * makes this empty; the client still refuses to decode a seventh stream
     * rather than trusting that.
     */
    overflow: T[];
}

export interface StageArrangementOptions {
    /**
     * Operator-pinned spotlight. Wins over the active speaker so cut-line 3 of
     * the roadmap ("automatic active-speaker switching → operator-pinned
     * spotlight") is a prop change rather than a rewrite.
     */
    pinnedIdentity?: string | null;
    /** Loudest current speaker, from `RoomEvent.ActiveSpeakersChanged`. */
    activeSpeakerIdentity?: string | null;
}

/** Slot order: first grant observed goes first, identity breaks exact ties. */
function bySlot(a: StagePublisher, b: StagePublisher): number {
    return a.grantOrder - b.grantOrder || a.identity.localeCompare(b.identity);
}

/**
 * Fallback spotlight when nobody is pinned and nobody is speaking: the most
 * recently granted publisher, which is the participant the facilitator just
 * promoted. A facilitator wins an exact tie, so an empty stage spotlights
 * Julián rather than an arbitrary identity.
 */
function byMostRecentGrant(a: StagePublisher, b: StagePublisher): number {
    return (
        b.grantOrder - a.grantOrder ||
        Number(b.isFacilitator) - Number(a.isFacilitator) ||
        a.identity.localeCompare(b.identity)
    );
}

/**
 * Split the current stage publishers into one spotlight and up to five
 * auxiliaries.
 *
 * Callers pass only participants that hold a stage grant; this function never
 * invents a tile for a subscribe-only attendee. Duplicate identities are
 * collapsed, because rendering the same identity twice is how a video element
 * gets leaked.
 */
export function selectStageArrangement<T extends StagePublisher>(
    publishers: readonly T[],
    options: StageArrangementOptions = {},
): StageArrangement<T> {
    const unique = new Map<string, T>();
    for (const publisher of publishers) {
        if (!unique.has(publisher.identity)) {
            unique.set(publisher.identity, publisher);
        }
    }
    const candidates = [...unique.values()];
    if (candidates.length === 0) {
        return { spotlight: null, auxiliaries: [], overflow: [] };
    }

    const spotlight =
        (options.pinnedIdentity
            ? candidates.find((p) => p.identity === options.pinnedIdentity)
            : undefined) ??
        (options.activeSpeakerIdentity
            ? candidates.find((p) => p.identity === options.activeSpeakerIdentity)
            : undefined) ??
        [...candidates].sort(byMostRecentGrant)[0];

    const rest = candidates
        .filter((p) => p.identity !== spotlight.identity)
        .sort(bySlot);

    return {
        spotlight,
        auxiliaries: rest.slice(0, MAX_AUXILIARY_TILES),
        overflow: rest.slice(MAX_AUXILIARY_TILES),
    };
}
