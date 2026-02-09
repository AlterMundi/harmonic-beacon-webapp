"use client";

import { useState, useRef, useEffect, useCallback } from "react";

export interface RecordingTrack {
    id: string;
    participantIdentity: string;
    category: "SESSION" | "BEACON";
}

interface CompositePlayerProps {
    sessionId: string;
    recordings: RecordingTrack[];
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
}: CompositePlayerProps) {
    const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [mix, setMix] = useState(0.8); // 0 = all beacon, 1 = all session
    const [seeking, setSeeking] = useState(false);

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

            {/* Seek bar */}
            <div className="space-y-1">
                <input
                    type="range"
                    min={0}
                    max={duration || 0}
                    step={0.1}
                    value={currentTime}
                    onChange={(e) => handleSeek(parseFloat(e.target.value))}
                    onMouseUp={(e) => handleSeekCommit(parseFloat((e.target as HTMLInputElement).value))}
                    onTouchEnd={(e) => handleSeekCommit(parseFloat((e.target as HTMLInputElement).value))}
                    className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
                    style={{
                        background: `linear-gradient(to right, var(--primary-500) ${seekPercent}%, var(--border-subtle) ${seekPercent}%)`,
                    }}
                />
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
        </div>
    );
}
