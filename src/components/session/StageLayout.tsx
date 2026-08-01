"use client";

import {
    MAX_AUXILIARY_TILES,
    composeStageScene,
    stagePresenceTone,
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
    /** Future shared state only; this component offers no browser-local pin. */
    protagonistIdentity?: string | null;
    audioOnly?: boolean;
}

export default function StageLayout({
    publishers,
    activeSpeakerIdentity,
    protagonistIdentity,
    audioOnly = false,
}: StageLayoutProps) {
    const { copy } = useLocale();
    const composition = composeStageScene(publishers, {
        protagonistIdentity,
        activeSpeakerIdentity,
    });

    return (
        <section
            aria-label={copy.stage.label}
            data-testid="stage-layout"
            data-scene={composition.kind}
            data-overflow={composition.overflow.length || undefined}
            className="stage-canvas"
        >
            {audioOnly && (
                <p role="status" className="mb-3 text-center text-xs text-[var(--text-muted)]">
                    {copy.stage.audioOnly}
                </p>
            )}

            {composition.placements.length === 0 ? (
                <div className="terminal-state py-10">
                    <p className="terminal-state__body">{copy.stage.waiting}</p>
                </div>
            ) : (
                <ul
                    aria-label={copy.stage.label}
                    className={`stage-scene stage-scene--${composition.kind}`}
                    data-member-count={composition.placements.length}
                >
                    {composition.placements.map(({ member, role, quality, presence }) => (
                        <StageTile
                            key={member.identity}
                            label={member.label}
                            sceneRole={role}
                            qualityPriority={audioOnly ? "none" : quality}
                            presence={presence}
                            presenceTone={stagePresenceTone(member.identity)}
                            isLocal={member.isLocal}
                            isSpeaking={member.isSpeaking}
                            cameraOn={member.cameraOn}
                            micOn={member.micOn}
                            connectionQuality={member.connectionQuality}
                            audioOnly={audioOnly}
                            videoPublication={audioOnly ? null : member.videoPublication ?? null}
                        />
                    ))}
                </ul>
            )}
        </section>
    );
}

export { MAX_AUXILIARY_TILES };
