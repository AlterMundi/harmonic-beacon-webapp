"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import CutDialog from "./CutDialog";

export interface RecordingTrack {
    id: string;
    participantIdentity: string;
    category: "SESSION" | "BEACON";
}

interface CompositePlayerProps {
    sessionId: string;
    recordings: RecordingTrack[];
    enableCutControls?: boolean;
    onCutCreated?: () => void;
}

function formatTime(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    if (mins >= 60) {
        const hours = Math.floor(mins / 60);
        const remainMins = mins % 60;
        return `${hours}:${remainMins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function CompositePlayer({
    sessionId,
    recordings,
    enableCutControls,
    onCutCreated,
}: CompositePlayerProps) {
    const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [mix, setMix] = useState(0.8); // 0 = all beacon, 1 = all session
    const [seeking, setSeeking] = useState(false);

    // Cut controls state
    const [inPoint, setInPoint] = useState<number | null>(null);
    const [outPoint, setOutPoint] = useState<number | null>(null);
    const [showCutDialog, setShowCutDialog] = useState(false);

    const sessionTracks = recordings.filter((r) => r.category === "SESSION");
    const beaconTracks = recordings.filter((r) => r.category === "BEACON");
    const hasBeacon = beaconTracks.length > 0;

    // Primary track = first SESSION track (drives seek bar + time display)
    const primaryTrack = sessionTracks[0];

    // Apply volume/mix to all audio elements
    const applyVolumes = useCallback(() => {
        for (const track of recordings) {
            const el = audioRefs.current.get(track.id);
            if (!el) continue;
            if (track.category === "SESSION") {
                el.volume = volume * mix;
            } else {
                el.volume = volume * (1 - mix);
            }
        }
    }, [volume, mix, recordings]);

    useEffect(() => {
        applyVolumes();
    }, [applyVolumes]);

    // Primary track timeupdate — drives seek bar + drift correction on others
    useEffect(() => {
        if (!primaryTrack) return;
        const primary = audioRefs.current.get(primaryTrack.id);
        if (!primary) return;

        const onTimeUpdate = () => {
            if (!seeking) {
                setCurrentTime(primary.currentTime);
            }
            // Drift correction for all other tracks
            for (const track of recordings) {
                if (track.id === primaryTrack.id) continue;
                const el = audioRefs.current.get(track.id);
                if (!el || el.paused) continue;
                const drift = Math.abs(el.currentTime - primary.currentTime);
                if (drift > 0.15) {
                    el.currentTime = primary.currentTime;
                }
            }
        };

        const onDurationChange = () => {
            if (primary.duration && isFinite(primary.duration)) {
                setDuration(primary.duration);
            }
        };

        const onEnded = () => {
            setPlaying(false);
            for (const track of recordings) {
                const el = audioRefs.current.get(track.id);
                if (el) el.pause();
            }
        };

        primary.addEventListener("timeupdate", onTimeUpdate);
        primary.addEventListener("durationchange", onDurationChange);
        primary.addEventListener("loadedmetadata", onDurationChange);
        primary.addEventListener("ended", onEnded);

        return () => {
            primary.removeEventListener("timeupdate", onTimeUpdate);
            primary.removeEventListener("durationchange", onDurationChange);
            primary.removeEventListener("loadedmetadata", onDurationChange);
            primary.removeEventListener("ended", onEnded);
        };
    }, [seeking, primaryTrack, recordings]);

    const togglePlay = async () => {
        if (!primaryTrack) return;
        const primary = audioRefs.current.get(primaryTrack.id);
        if (!primary) return;

        if (playing) {
            for (const track of recordings) {
                const el = audioRefs.current.get(track.id);
                if (el) el.pause();
            }
            setPlaying(false);
        } else {
            applyVolumes();
            // Sync all to primary time, then play
            const t = primary.currentTime;
            for (const track of recordings) {
                const el = audioRefs.current.get(track.id);
                if (!el) continue;
                if (track.id !== primaryTrack.id) {
                    el.currentTime = t;
                }
                await el.play().catch(() => {});
            }
            setPlaying(true);
        }
    };

    const handleSeek = (value: number) => {
        setSeeking(true);
        setCurrentTime(value);
    };

    const handleSeekCommit = (value: number) => {
        for (const track of recordings) {
            const el = audioRefs.current.get(track.id);
            if (el) el.currentTime = value;
        }
        setSeeking(false);
    };

    if (recordings.length === 0) {
        return (
            <div className="glass-card p-4 text-center">
                <p className="text-sm text-[var(--text-muted)]">No recording available</p>
            </div>
        );
    }

    const seekPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
    const inPercent = duration > 0 && inPoint !== null ? (inPoint / duration) * 100 : null;
    const outPercent = duration > 0 && outPoint !== null ? (outPoint / duration) * 100 : null;
    const canCreateCut = enableCutControls && inPoint !== null && outPoint !== null && outPoint > inPoint;

    return (
        <div className="glass-card p-4 space-y-4">
            {/* Hidden audio elements — one per track */}
            {recordings.map((track) => (
                <audio
                    key={track.id}
                    ref={(el) => {
                        if (el) {
                            audioRefs.current.set(track.id, el);
                        } else {
                            audioRefs.current.delete(track.id);
                        }
                    }}
                    preload="metadata"
                    src={`/api/sessions/${sessionId}/recording?recordingId=${track.id}`}
                />
            ))}

            {/* Track info */}
            {recordings.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                    {recordings.map((track) => (
                        <span
                            key={track.id}
                            className={`text-xs px-2 py-0.5 rounded-full ${
                                track.category === "BEACON"
                                    ? "bg-[var(--accent-500)]/20 text-[var(--accent-400)]"
                                    : "bg-[var(--primary-500)]/20 text-[var(--primary-400)]"
                            }`}
                        >
                            {track.participantIdentity}
                        </span>
                    ))}
                </div>
            )}

            {/* Seek bar with In/Out markers */}
            <div className="space-y-1">
                <div className="relative">
                    <input
                        type="range"
                        min={0}
                        max={duration || 0}
                        step={0.1}
                        value={currentTime}
                        onChange={(e) => handleSeek(parseFloat(e.target.value))}
                        onMouseUp={(e) => handleSeekCommit(parseFloat((e.target as HTMLInputElement).value))}
                        onTouchEnd={(e) => handleSeekCommit(parseFloat((e.target as HTMLInputElement).value))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer relative z-10"
                        style={{
                            background: `linear-gradient(to right, var(--primary-500) ${seekPercent}%, var(--border-subtle) ${seekPercent}%)`,
                        }}
                    />
                    {/* In/Out markers overlay */}
                    {enableCutControls && (inPercent !== null || outPercent !== null) && (
                        <div className="absolute inset-0 pointer-events-none" style={{ top: 0, height: "6px", marginTop: "5px" }}>
                            {/* Shaded region between In and Out */}
                            {inPercent !== null && outPercent !== null && (
                                <div
                                    className="absolute h-full bg-[var(--accent-500)]/25 rounded"
                                    style={{ left: `${inPercent}%`, width: `${outPercent - inPercent}%` }}
                                />
                            )}
                            {/* In marker */}
                            {inPercent !== null && (
                                <div
                                    className="absolute w-0.5 bg-green-400"
                                    style={{ left: `${inPercent}%`, height: "14px", top: "-4px" }}
                                />
                            )}
                            {/* Out marker */}
                            {outPercent !== null && (
                                <div
                                    className="absolute w-0.5 bg-red-400"
                                    style={{ left: `${outPercent}%`, height: "14px", top: "-4px" }}
                                />
                            )}
                        </div>
                    )}
                </div>
                <div className="flex justify-between text-xs text-[var(--text-muted)]">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(duration)}</span>
                </div>
            </div>

            {/* Controls row */}
            <div className="flex items-center gap-4">
                {/* Play/Pause */}
                <button
                    onClick={togglePlay}
                    className="w-12 h-12 rounded-full bg-[var(--primary-600)] hover:bg-[var(--primary-500)] transition-colors flex items-center justify-center flex-shrink-0"
                >
                    {playing ? (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="6" y="4" width="4" height="16" rx="1" />
                            <rect x="14" y="4" width="4" height="16" rx="1" />
                        </svg>
                    ) : (
                        <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    )}
                </button>

                {/* Volume */}
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <svg className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M12 6l-4 4H4v4h4l4 4V6z" />
                    </svg>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={volume}
                        onChange={(e) => setVolume(parseFloat(e.target.value))}
                        className="w-full h-1 rounded-full appearance-none cursor-pointer"
                        style={{
                            background: `linear-gradient(to right, var(--text-muted) ${volume * 100}%, var(--border-subtle) ${volume * 100}%)`,
                        }}
                    />
                </div>
            </div>

            {/* Crossfader — only when beacon recording exists */}
            {hasBeacon && (
                <div className="space-y-1.5">
                    <div className="flex justify-between text-xs text-[var(--text-muted)]">
                        <span>Beacon</span>
                        <span>Session</span>
                    </div>
                    <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={mix}
                        onChange={(e) => setMix(parseFloat(e.target.value))}
                        className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                        style={{
                            background: `linear-gradient(to right, var(--accent-500) 0%, var(--primary-500) 100%)`,
                        }}
                    />
                </div>
            )}

            {/* Cut controls — Mark In / Mark Out */}
            {enableCutControls && (
                <div className="space-y-3 pt-1 border-t border-[var(--border-subtle)]">
                    <div className="flex gap-2">
                        <button
                            onClick={() => setInPoint(currentTime)}
                            className="flex-1 py-2 rounded-xl text-sm font-medium bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 transition-colors"
                        >
                            Mark In{inPoint !== null && ` · ${formatTime(inPoint)}`}
                        </button>
                        <button
                            onClick={() => setOutPoint(currentTime)}
                            className="flex-1 py-2 rounded-xl text-sm font-medium bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors"
                        >
                            Mark Out{outPoint !== null && ` · ${formatTime(outPoint)}`}
                        </button>
                    </div>

                    {/* Create Cut section */}
                    {canCreateCut && (
                        <div className="flex items-center justify-between gap-3">
                            <span className="text-xs text-[var(--text-muted)]">
                                Selection: {formatTime(outPoint! - inPoint!)}
                            </span>
                            <button
                                onClick={() => setShowCutDialog(true)}
                                className="btn-primary px-4 py-2 text-sm"
                            >
                                Create Cut
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* CutDialog */}
            {showCutDialog && inPoint !== null && outPoint !== null && (
                <CutDialog
                    sessionId={sessionId}
                    inSeconds={inPoint}
                    outSeconds={outPoint}
                    mix={mix}
                    onClose={() => setShowCutDialog(false)}
                    onSuccess={() => {
                        setShowCutDialog(false);
                        setInPoint(null);
                        setOutPoint(null);
                        onCutCreated?.();
                    }}
                />
            )}
        </div>
    );
}
