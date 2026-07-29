"use client";

import {
    MAX_AUXILIARY_TILES,
    selectStageArrangement,
    type StagePublisher,
} from "@/lib/stage-layout";

import StageTile, { type StageVideoPublication } from "./StageTile";

export interface StagePublisherView extends StagePublisher {
    /** Camera publication for this identity, if there is one. */
    videoPublication?: StageVideoPublication | null;
}

export interface StageLayoutProps {
    /** Only participants holding a stage grant. Never the audience. */
    publishers: readonly StagePublisherView[];
    activeSpeakerIdentity?: string | null;
    /** Operator pin; wins over the active speaker when set. */
    pinnedIdentity?: string | null;
    /**
     * Attendee chose audio-only. Video subscriptions are dropped by the room
     * owner; this component additionally renders no `<video>` element at all,
     * so nothing decodes even if a subscription lingers.
     */
    audioOnly?: boolean;
}

/**
 * The six-person stage: one spotlight at the 720p layout plus up to five
 * auxiliaries at 360p.
 *
 * Every tile is a direct child of a single CSS grid, keyed by participant
 * identity. That is deliberate: when the active speaker changes, the promoted
 * tile keeps its React position and only its grid span and requested layer
 * change, so its `<video>` element is reused rather than torn down and rebuilt.
 * Splitting the spotlight and the strip into two parent elements would remount
 * the tile on every speaker change — one detach/attach cycle, one black frame,
 * and one more chance to leak an element per switch.
 *
 * Mobile gets the same grid, which lands as a full-width spotlight above a strip
 * of five fifth-width auxiliaries rather than six equal decoders
 * (WEEKEND_MVP_ROADMAP.md WS2-02 risk note).
 */
export default function StageLayout({
    publishers,
    activeSpeakerIdentity,
    pinnedIdentity,
    audioOnly = false,
}: StageLayoutProps) {
    const { spotlight, auxiliaries, overflow } = selectStageArrangement(publishers, {
        pinnedIdentity,
        activeSpeakerIdentity,
    });

    const tiles = spotlight ? [spotlight, ...auxiliaries] : [];

    return (
        <section
            aria-label="Stage"
            data-testid="stage-layout"
            data-overflow={overflow.length || undefined}
            className="w-full max-w-4xl mx-auto"
        >
            {audioOnly && (
                <p
                    role="status"
                    className="mb-3 text-center text-xs text-[var(--text-muted)]"
                >
                    Audio-only mode. Video is off; you are still hearing the stage and
                    the Beacon bed.
                </p>
            )}

            {tiles.length === 0 ? (
                <p className="py-10 text-center text-sm text-[var(--text-muted)]">
                    Waiting for the facilitator to open the stage.
                </p>
            ) : (
                <ul className="grid grid-cols-5 gap-1.5 sm:gap-3 list-none p-0 m-0">
                    {tiles.map((publisher) => (
                        <StageTile
                            key={publisher.identity}
                            label={publisher.label}
                            variant={
                                publisher.identity === spotlight?.identity
                                    ? "spotlight"
                                    : "auxiliary"
                            }
                            isLocal={publisher.isLocal}
                            isSpeaking={publisher.isSpeaking}
                            cameraOn={publisher.cameraOn}
                            micOn={publisher.micOn}
                            connectionQuality={publisher.connectionQuality}
                            videoPublication={
                                audioOnly ? null : publisher.videoPublication ?? null
                            }
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}

export { MAX_AUXILIARY_TILES };
