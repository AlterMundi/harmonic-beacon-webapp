"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "@/context/LocaleContext";

import {
    AUXILIARY_DIMENSIONS,
    SPOTLIGHT_DIMENSIONS,
    type StageConnectionQuality,
    type StagePresence,
    type StageQualityPriority,
    type StageSceneRole,
    type StageVideoDimensions,
} from "@/lib/stage-layout";

export interface StageVideoPublication {
    trackSid: string;
    videoTrack?: {
        attach(element: HTMLMediaElement): HTMLMediaElement;
        detach(element: HTMLMediaElement): HTMLMediaElement;
    } | null;
    setVideoDimensions?(dimensions: StageVideoDimensions): void;
}

export interface StageTileProps {
    label: string;
    sceneRole: StageSceneRole;
    qualityPriority: StageQualityPriority;
    presence: StagePresence;
    presenceTone: 0 | 1 | 2 | 3;
    isLocal: boolean;
    isSpeaking: boolean;
    cameraOn: boolean;
    micOn: boolean;
    connectionQuality: StageConnectionQuality;
    videoPublication?: StageVideoPublication | null;
}

const QUALITY_COLOR: Record<StageConnectionQuality, string> = {
    excellent: "bg-[var(--lime)]",
    good: "bg-[var(--lime)]/60",
    poor: "bg-[var(--warning)]",
    lost: "bg-[var(--danger)]",
    unknown: "bg-white/30",
};

function MicOffIcon() {
    return (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m-4 0h8m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
            <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" />
        </svg>
    );
}

function CameraOffIcon() {
    return (
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
            <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" />
        </svg>
    );
}

export default function StageTile({
    label,
    sceneRole,
    qualityPriority,
    presence,
    presenceTone,
    isLocal,
    isSpeaking,
    cameraOn,
    micOn,
    connectionQuality,
    videoPublication,
}: StageTileProps) {
    const { copy } = useLocale();
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const track = presence === "connected" && cameraOn
        ? videoPublication?.videoTrack ?? null
        : null;
    const roleLabel = copy.stage[sceneRole];
    const mediaState = presence === "reconnecting"
        ? copy.stage.reconnecting
        : cameraOn
            ? track
                ? null
                : copy.stage.connecting
            : copy.stage.presentWithoutCamera;
    const accessibleLabel = [
        isLocal ? `${label} (${copy.stage.you})` : label,
        roleLabel,
        mediaState,
        !micOn ? copy.stage.microphoneMuted : null,
    ].filter(Boolean).join(", ");

    useEffect(() => {
        const element = videoRef.current;
        if (!element || !track) return;
        track.attach(element);
        return () => {
            track.detach(element);
        };
    }, [track]);

    useEffect(() => {
        if (qualityPriority === "none") return;
        videoPublication?.setVideoDimensions?.(
            qualityPriority === "high" ? SPOTLIGHT_DIMENSIONS : AUXILIARY_DIMENSIONS,
        );
    }, [videoPublication, qualityPriority]);

    return (
        <li
            data-testid="stage-tile"
            data-role={sceneRole}
            data-quality-priority={qualityPriority}
            data-presence={presence}
            data-presence-tone={presenceTone}
            data-identity-label={label}
            aria-label={accessibleLabel}
            className={[
                "stage-tile",
                `stage-tile--${sceneRole}`,
                isSpeaking ? "stage-tile--speaking" : "",
            ].join(" ")}
        >
            {track ? (
                <video
                    ref={videoRef}
                    data-testid="stage-tile-video"
                    autoPlay
                    playsInline
                    muted={isLocal}
                    className={`stage-tile__video ${isLocal ? "scale-x-[-1]" : ""}`}
                />
            ) : (
                <div className="stage-tile__presence" data-testid="stage-tile-presence">
                    <span>{mediaState}</span>
                </div>
            )}

            <div className="stage-tile__identity">
                <div className="min-w-0">
                    <span className="stage-tile__name" title={label}>
                        {isLocal ? `${label} (${copy.stage.you})` : label}
                    </span>
                    <span className="stage-tile__role" aria-hidden="true">{roleLabel}</span>
                </div>
                <span className="flex-1" />
                {!micOn && (
                    <span role="img" aria-label={`${label} ${copy.stage.microphoneMuted}`} className="text-white/80">
                        <MicOffIcon />
                    </span>
                )}
                {!cameraOn && (
                    <span role="img" aria-label={`${label} ${copy.stage.cameraOff.toLocaleLowerCase()}`} className="text-white/80">
                        <CameraOffIcon />
                    </span>
                )}
                <span
                    role="img"
                    aria-label={`${label} ${copy.stage.quality[connectionQuality]}`}
                    data-quality={connectionQuality}
                    className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${QUALITY_COLOR[connectionQuality]}`}
                />
            </div>
        </li>
    );
}
