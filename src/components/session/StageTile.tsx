"use client";

import { useEffect, useRef } from "react";

import {
    AUXILIARY_DIMENSIONS,
    SPOTLIGHT_DIMENSIONS,
    type StageConnectionQuality,
    type StageVideoDimensions,
} from "@/lib/stage-layout";

/**
 * The parts of a LiveKit `TrackPublication` this tile touches, as a structural
 * type. Both `RemoteTrackPublication` and `LocalTrackPublication` satisfy it —
 * only the remote one carries `setVideoDimensions`, which is why that member is
 * optional. Keeping the type structural means the tile can be tested without a
 * room, a peer connection, or an SDK mock.
 */
export interface StageVideoPublication {
    trackSid: string;
    videoTrack?: {
        attach(element: HTMLMediaElement): HTMLMediaElement;
        detach(element: HTMLMediaElement): HTMLMediaElement;
    } | null;
    /** Present on remote publications: asks the SFU for a simulcast layer. */
    setVideoDimensions?(dimensions: StageVideoDimensions): void;
}

export type StageTileVariant = "spotlight" | "auxiliary";

export interface StageTileProps {
    /** Non-PII role word, e.g. "Facilitator". Never an email or ticket code. */
    label: string;
    variant: StageTileVariant;
    isLocal: boolean;
    isSpeaking: boolean;
    cameraOn: boolean;
    micOn: boolean;
    connectionQuality: StageConnectionQuality;
    videoPublication?: StageVideoPublication | null;
}

const QUALITY_COPY: Record<StageConnectionQuality, string> = {
    excellent: "Connection excellent",
    good: "Connection good",
    poor: "Connection poor",
    lost: "Connection lost",
    unknown: "Connection unknown",
};

const QUALITY_COLOR: Record<StageConnectionQuality, string> = {
    excellent: "bg-green-400",
    good: "bg-green-400/60",
    poor: "bg-amber-400",
    lost: "bg-red-400",
    unknown: "bg-white/30",
};

function MicOffIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m-4 0h8m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" />
        </svg>
    );
}

function CameraOffIcon() {
    return (
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" />
        </svg>
    );
}

/**
 * One publisher on the stage.
 *
 * The tile owns the lifecycle of exactly one `<video>` element: it is created by
 * this render, attached in an effect, and detached by that effect's cleanup.
 * Nothing else in the app attaches video, so a publisher moving between the
 * spotlight and the auxiliary strip cannot leave an orphan element behind —
 * provided the parent keeps the tile mounted (see `StageLayout`, which renders
 * every tile inside one grid so a promotion is a CSS change, not a remount).
 */
export default function StageTile({
    label,
    variant,
    isLocal,
    isSpeaking,
    cameraOn,
    micOn,
    connectionQuality,
    videoPublication,
}: StageTileProps) {
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const isSpotlight = variant === "spotlight";

    // A muted camera keeps its publication but stops producing frames. Dropping
    // the element rather than showing its last decoded frame avoids a tile that
    // looks live while the participant has their camera off.
    const track = cameraOn ? videoPublication?.videoTrack ?? null : null;

    useEffect(() => {
        const element = videoRef.current;
        if (!element || !track) return;
        track.attach(element);
        return () => {
            track.detach(element);
        };
    }, [track]);

    // Ask the SFU for the layer that matches how large this tile is drawn. This
    // is what makes one 720p spotlight and five 360p auxiliaries true on the
    // wire rather than only in CSS. `adaptiveStream` still pauses the flow when
    // the element is off-screen; explicit dimensions win while it is visible.
    useEffect(() => {
        videoPublication?.setVideoDimensions?.(
            isSpotlight ? SPOTLIGHT_DIMENSIONS : AUXILIARY_DIMENSIONS,
        );
    }, [videoPublication, isSpotlight]);

    return (
        <li
            data-testid="stage-tile"
            data-variant={variant}
            data-identity-label={label}
            aria-label={`${label}${isLocal ? " (you)" : ""}`}
            className={[
                "relative overflow-hidden rounded-lg bg-white/5 border aspect-video",
                isSpotlight ? "col-span-5" : "col-span-1",
                isSpeaking
                    ? "border-[var(--primary-400)] ring-2 ring-[var(--primary-500)]"
                    : "border-[var(--border-subtle)]",
            ].join(" ")}
        >
            {track ? (
                <video
                    ref={videoRef}
                    data-testid="stage-tile-video"
                    autoPlay
                    playsInline
                    // The local preview is our own capture: never play its audio
                    // back, and mirror it the way every other camera UI does.
                    muted={isLocal}
                    className={`w-full h-full object-cover ${isLocal ? "scale-x-[-1]" : ""}`}
                />
            ) : (
                <div className="w-full h-full flex items-center justify-center">
                    <span
                        className={`text-[var(--text-muted)] ${isSpotlight ? "text-sm" : "text-[9px]"}`}
                    >
                        {cameraOn ? "Connecting…" : "Camera off"}
                    </span>
                </div>
            )}

            {/* Overlay: label plus the per-tile media and quality indicators. */}
            <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 px-1.5 py-1 bg-black/50">
                <span
                    className={`truncate text-white ${isSpotlight ? "text-xs" : "text-[9px]"}`}
                >
                    {isLocal ? `${label} (you)` : label}
                </span>
                <span className="flex-1" />
                {!micOn && (
                    <span role="img" aria-label={`${label} microphone muted`} className="text-red-300">
                        <MicOffIcon />
                    </span>
                )}
                {!cameraOn && (
                    <span role="img" aria-label={`${label} camera off`} className="text-red-300">
                        <CameraOffIcon />
                    </span>
                )}
                <span
                    role="img"
                    aria-label={`${label} ${QUALITY_COPY[connectionQuality].toLowerCase()}`}
                    data-quality={connectionQuality}
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${QUALITY_COLOR[connectionQuality]}`}
                />
            </div>
        </li>
    );
}
