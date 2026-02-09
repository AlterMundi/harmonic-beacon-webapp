"use client";

import { useState, useRef, useEffect, useCallback } from "react";

interface CompositePlayerProps {
    sessionId: string;
    hasSessionRecording: boolean;
    hasBeaconRecording: boolean;
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
    hasSessionRecording,
    hasBeaconRecording,
}: CompositePlayerProps) {
    const sessionRef = useRef<HTMLAudioElement>(null);
    const beaconRef = useRef<HTMLAudioElement>(null);

    const [playing, setPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [mix, setMix] = useState(0.8); // 0 = all beacon, 1 = all session
    const [seeking, setSeeking] = useState(false);

    const sessionUrl = `/api/sessions/${sessionId}/recording?track=session`;
    const beaconUrl = `/api/sessions/${sessionId}/recording?track=beacon`;

    // Apply volume/mix to audio elements
    const applyVolumes = useCallback(() => {
        if (sessionRef.current) {
            sessionRef.current.volume = volume * mix;
        }
        if (beaconRef.current && hasBeaconRecording) {
            beaconRef.current.volume = volume * (1 - mix);
        }
    }, [volume, mix, hasBeaconRecording]);

    useEffect(() => {
        applyVolumes();
    }, [applyVolumes]);

    // Session audio timeupdate — drives seek bar + drift correction
    useEffect(() => {
        const session = sessionRef.current;
        const beacon = beaconRef.current;
        if (!session) return;

        const onTimeUpdate = () => {
            if (!seeking) {
                setCurrentTime(session.currentTime);
            }
            // Drift correction for beacon
            if (beacon && hasBeaconRecording && !beacon.paused) {
                const drift = Math.abs(beacon.currentTime - session.currentTime);
                if (drift > 0.15) {
                    beacon.currentTime = session.currentTime;
                }
            }
        };

        const onDurationChange = () => {
            if (session.duration && isFinite(session.duration)) {
                setDuration(session.duration);
            }
        };

        const onEnded = () => {
            setPlaying(false);
            if (beacon) beacon.pause();
        };

        session.addEventListener("timeupdate", onTimeUpdate);
        session.addEventListener("durationchange", onDurationChange);
        session.addEventListener("loadedmetadata", onDurationChange);
        session.addEventListener("ended", onEnded);

        return () => {
            session.removeEventListener("timeupdate", onTimeUpdate);
            session.removeEventListener("durationchange", onDurationChange);
            session.removeEventListener("loadedmetadata", onDurationChange);
            session.removeEventListener("ended", onEnded);
        };
    }, [seeking, hasBeaconRecording]);

    const togglePlay = async () => {
        const session = sessionRef.current;
        const beacon = beaconRef.current;
        if (!session) return;

        if (playing) {
            session.pause();
            if (beacon && hasBeaconRecording) beacon.pause();
            setPlaying(false);
        } else {
            applyVolumes();
            await session.play();
            if (beacon && hasBeaconRecording) {
                beacon.currentTime = session.currentTime;
                await beacon.play().catch(() => {});
            }
            setPlaying(true);
        }
    };

    const handleSeek = (value: number) => {
        setSeeking(true);
        setCurrentTime(value);
    };

    const handleSeekCommit = (value: number) => {
        const session = sessionRef.current;
        const beacon = beaconRef.current;
        if (session) {
            session.currentTime = value;
        }
        if (beacon && hasBeaconRecording) {
            beacon.currentTime = value;
        }
        setSeeking(false);
    };

    if (!hasSessionRecording) {
        return (
            <div className="glass-card p-4 text-center">
                <p className="text-sm text-[var(--text-muted)]">No recording available</p>
            </div>
        );
    }

    const seekPercent = duration > 0 ? (currentTime / duration) * 100 : 0;

    return (
        <div className="glass-card p-4 space-y-4">
            {/* Hidden audio elements */}
            <audio ref={sessionRef} preload="metadata" src={sessionUrl} />
            {hasBeaconRecording && (
                <audio ref={beaconRef} preload="metadata" src={beaconUrl} />
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
            {hasBeaconRecording && (
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
