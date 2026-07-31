"use client";

import {
    MAX_AUXILIARY_TILES,
    selectStageArrangement,
    type StagePublisher,
} from "@/lib/stage-layout";
import { useLocale } from "@/context/LocaleContext";

import StageTile, { type StageVideoPublication } from "./StageTile";

export interface StagePublisherView extends StagePublisher {
    videoPublication?: StageVideoPublication | null;
}

export interface StageLayoutProps {
    publishers: readonly StagePublisherView[];
    activeSpeakerIdentity?: string | null;
    pinnedIdentity?: string | null;
    audioOnly?: boolean;
}

export default function StageLayout({
    publishers,
    activeSpeakerIdentity,
    pinnedIdentity,
    audioOnly = false,
}: StageLayoutProps) {
    const { copy } = useLocale();
    const { spotlight, auxiliaries, overflow } = selectStageArrangement(publishers, {
        pinnedIdentity,
        activeSpeakerIdentity,
    });

    const tiles = spotlight ? [spotlight, ...auxiliaries] : [];

    return (
        <section
            aria-label={copy.stage.label}
            data-testid="stage-layout"
            data-overflow={overflow.length || undefined}
            className="mx-auto w-full max-w-4xl"
        >
            {audioOnly && (
                <p
                    role="status"
                    className="mb-3 text-center text-xs text-[var(--text-muted)]"
                >
                    {copy.stage.audioOnly}
                </p>
            )}

            {tiles.length === 0 ? (
                <div className="terminal-state py-10">
                    <p className="terminal-state__body">
                        {copy.stage.waiting}
                    </p>
                </div>
            ) : (
                <ul className="m-0 grid list-none grid-cols-5 gap-1.5 p-0 sm:gap-3">
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
