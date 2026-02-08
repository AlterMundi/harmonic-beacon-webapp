"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { Room, RoomEvent, Track, RemoteTrack, RemoteParticipant, RemoteTrackPublication, LocalTrackPublication } from "livekit-client";
import { useAudio } from "@/context/AudioContext";

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://live.altermundi.net";

interface SessionInfo {
    id: string;
    title: string;
    status: string;
    startedAt: string | null;
    egressId: string | null;
}

export default function SessionRoomPage() {
    const { id } = useParams<{ id: string }>();
    const searchParams = useSearchParams();
    const router = useRouter();
    const inviteCode = searchParams.get("invite");

    const { volume: beaconVolume, setVolume: setBeaconVolume } = useAudio();

    const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [canPublish, setCanPublish] = useState(false);
    const [isMicOn, setIsMicOn] = useState(false);
    const [participantCount, setParticipantCount] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [mix, setMix] = useState(0.8); // 0 = all beacon, 1 = all session
    const [duration, setDuration] = useState(0);
    const [isRecording, setIsRecording] = useState(false);
    const [recordingLoading, setRecordingLoading] = useState(false);
    const [recordingError, setRecordingError] = useState<string | null>(null);
    const [endingSession, setEndingSession] = useState(false);

    const roomRef = useRef<Room | null>(null);
    const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const volumeRef = useRef(volume);

    // Keep volumeRef in sync with state
    useEffect(() => { volumeRef.current = volume; }, [volume]);

    const leaveSession = useCallback(async () => {
        // Record leave
        try {
            await fetch(`/api/scheduled-sessions/${id}/leave`, { method: "POST" });
        } catch {
            // Best effort
        }

        // Disconnect from room
        if (roomRef.current) {
            roomRef.current.disconnect();
        }

        router.push("/sessions");
    }, [id, router]);

    // Connect to LiveKit room
    useEffect(() => {
        let cancelled = false;

        async function connect() {
            try {
                const url = `/api/scheduled-sessions/${id}/token${inviteCode ? `?invite=${inviteCode}` : ""}`;
                const res = await fetch(url);
                if (!res.ok) {
                    const data = await res.json();
                    throw new Error(data.error || "Failed to get token");
                }

                const data = await res.json();
                if (cancelled) return;

                setSessionInfo(data.session);
                setCanPublish(data.canPublish);
                if (data.session.egressId) {
                    setIsRecording(true);
                }
                // Initialize timer from session startedAt
                if (data.session.startedAt) {
                    const elapsed = Math.floor((Date.now() - new Date(data.session.startedAt).getTime()) / 1000);
                    setDuration(Math.max(0, elapsed));
                }

                const room = new Room();
                roomRef.current = room;

                room.on(RoomEvent.TrackSubscribed, async (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
                    if (track.kind === Track.Kind.Audio) {
                        const audioElement = track.attach() as HTMLAudioElement;
                        audioElement.volume = volumeRef.current;
                        audioElement.style.display = "none";
                        document.body.appendChild(audioElement);
                        audioElementsRef.current.set(participant.identity, audioElement);
                        try {
                            await audioElement.play();
                        } catch {
                            // Autoplay blocked
                        }
                    }
                });

                room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
                    if (track.kind === Track.Kind.Audio) {
                        track.detach().forEach((el) => el.remove());
                        audioElementsRef.current.delete(participant.identity);
                    }
                });

                room.on(RoomEvent.ParticipantConnected, () => {
                    setParticipantCount(room.remoteParticipants.size + 1);
                });

                room.on(RoomEvent.ParticipantDisconnected, () => {
                    setParticipantCount(room.remoteParticipants.size + 1);
                });

                room.on(RoomEvent.Disconnected, () => {
                    setIsConnected(false);
                });

                await room.connect(LIVEKIT_URL, data.token);
                if (cancelled) {
                    room.disconnect();
                    return;
                }

                setIsConnected(true);
                setIsConnecting(false);
                setParticipantCount(room.remoteParticipants.size + 1);
            } catch (e) {
                if (!cancelled) {
                    setError(e instanceof Error ? e.message : "Failed to connect");
                    setIsConnecting(false);
                }
            }
        }

        connect();

        return () => {
            cancelled = true;
            if (roomRef.current) {
                roomRef.current.disconnect();
            }
            audioElementsRef.current.forEach((el) => {
                el.pause();
                el.remove();
            });
            audioElementsRef.current.clear();
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [id, inviteCode]);

    // Timer
    useEffect(() => {
        if (isConnected) {
            timerRef.current = setInterval(() => {
                setDuration((prev) => prev + 1);
            }, 1000);
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [isConnected]);

    // Apply mix: distribute master volume between session and beacon
    useEffect(() => {
        const sessionVol = volume * mix;
        const beaconVol = volume * (1 - mix);
        audioElementsRef.current.forEach((el) => {
            el.volume = sessionVol;
        });
        setBeaconVolume(beaconVol);
    }, [volume, mix, setBeaconVolume]);

    const toggleMic = async () => {
        const room = roomRef.current;
        if (!room || !canPublish) return;

        if (isMicOn) {
            // Mute mic
            room.localParticipant.trackPublications.forEach((pub) => {
                if (pub instanceof LocalTrackPublication && pub.track?.kind === Track.Kind.Audio) {
                    pub.track.stop();
                    room.localParticipant.unpublishTrack(pub.track);
                }
            });
            setIsMicOn(false);
        } else {
            // Enable mic
            try {
                await room.localParticipant.setMicrophoneEnabled(true);
                setIsMicOn(true);
            } catch (e) {
                console.error("Failed to enable mic:", e);
            }
        }
    };

    const endSession = async () => {
        if (!sessionInfo || endingSession) return;
        setEndingSession(true);
        try {
            const res = await fetch(`/api/provider/sessions/${id}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "end" }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to end session");
            }
            if (roomRef.current) {
                roomRef.current.disconnect();
            }
            router.push("/sessions");
        } catch (e) {
            console.error("Failed to end session:", e);
            setEndingSession(false);
        }
    };

    const toggleRecording = async () => {
        if (!sessionInfo || recordingLoading) return;
        setRecordingLoading(true);
        setRecordingError(null);
        try {
            const action = isRecording ? "stop" : "start";
            const res = await fetch(`/api/provider/sessions/${id}/recording/${action}`, {
                method: "POST",
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Recording action failed");
            }
            setIsRecording(!isRecording);
        } catch (e) {
            const msg = e instanceof Error ? e.message : "Recording action failed";
            setRecordingError(msg);
            setTimeout(() => setRecordingError(null), 5000);
        } finally {
            setRecordingLoading(false);
        }
    };

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    // Loading state
    if (isConnecting) {
        return (
            <main className="min-h-screen flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin w-10 h-10 border-2 border-[var(--primary-500)] border-t-transparent rounded-full mx-auto mb-4"></div>
                    <p className="text-[var(--text-muted)]">Connecting to session...</p>
                </div>
            </main>
        );
    }

    // Error state
    if (error) {
        return (
            <main className="min-h-screen flex items-center justify-center px-4">
                <div className="glass-card p-8 text-center max-w-sm w-full">
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-500/20 flex items-center justify-center">
                        <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-semibold mb-2">Connection Error</h2>
                    <p className="text-sm text-[var(--text-muted)] mb-4">{error}</p>
                    <button onClick={() => router.push("/sessions")} className="btn-secondary">
                        Back to Sessions
                    </button>
                </div>
            </main>
        );
    }

    return (
        <main className="min-h-screen flex flex-col">
            {/* Header */}
            <header className="p-4 flex items-center justify-between border-b border-[var(--border-subtle)]">
                <div className="min-w-0 flex-1">
                    <h1 className="font-semibold truncate">{sessionInfo?.title || "Session"}</h1>
                    <p className="text-xs text-[var(--text-muted)]">
                        {participantCount} participant{participantCount !== 1 ? "s" : ""}
                        {isConnected && (
                            <span className="ml-2 inline-flex items-center gap-1">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                                Connected
                            </span>
                        )}
                    </p>
                </div>
                <span className="text-sm font-mono text-[var(--text-muted)]">{formatTime(duration)}</span>
            </header>

            {/* Main content area */}
            <div className="flex-1 flex flex-col items-center justify-center px-4">
                {/* Audio visualizer placeholder */}
                <div className="w-48 h-48 rounded-full bg-gradient-to-br from-[var(--primary-600)]/20 to-[var(--primary-800)]/20 border border-[var(--primary-500)]/30 flex items-center justify-center mb-8 animate-breathe">
                    <svg className="w-16 h-16 text-[var(--primary-400)]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 12.728M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                    </svg>
                </div>

                {/* Volume + Mix controls */}
                <div className="w-full max-w-xs mb-8 space-y-4">
                    {/* Master volume */}
                    <div className="flex items-center gap-3">
                        <svg className="w-4 h-4 text-[var(--text-muted)] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                        </svg>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.01"
                            value={volume}
                            onChange={(e) => setVolume(parseFloat(e.target.value))}
                            className="flex-1 accent-[var(--primary-500)]"
                        />
                    </div>
                    {/* Crossfader: beacon <-> session */}
                    <div>
                        <div className="flex items-center gap-3">
                            <span className="text-[10px] text-[var(--text-muted)] w-12 text-right">Beacon</span>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={mix}
                                onChange={(e) => setMix(parseFloat(e.target.value))}
                                className="flex-1 accent-[var(--primary-500)]"
                            />
                            <span className="text-[10px] text-[var(--text-muted)] w-12">Session</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Recording error toast */}
            {recordingError && (
                <div className="mx-4 mb-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-400 text-center">
                    {recordingError}
                </div>
            )}

            {/* Bottom controls */}
            <div className="p-6 border-t border-[var(--border-subtle)]">
                <div className="flex items-center justify-center gap-4">
                    {/* Mic toggle (only for publishers) */}
                    {canPublish && (
                        <button
                            onClick={toggleMic}
                            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                                isMicOn
                                    ? "bg-[var(--primary-600)] text-white"
                                    : "bg-white/10 text-[var(--text-muted)] hover:bg-white/20"
                            }`}
                            aria-label={isMicOn ? "Mute microphone" : "Unmute microphone"}
                        >
                            {isMicOn ? (
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                </svg>
                            ) : (
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                    <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                </svg>
                            )}
                        </button>
                    )}

                    {/* Recording toggle (only for publishers) */}
                    {canPublish && (
                        <button
                            onClick={toggleRecording}
                            disabled={recordingLoading}
                            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                                isRecording
                                    ? "bg-red-600 text-white"
                                    : "bg-white/10 text-[var(--text-muted)] hover:bg-white/20"
                            } ${recordingLoading ? "opacity-50" : ""}`}
                            aria-label={isRecording ? "Stop recording" : "Start recording"}
                        >
                            {isRecording ? (
                                <span className="relative flex items-center justify-center">
                                    <span className="absolute w-3 h-3 rounded-full bg-white animate-pulse"></span>
                                    <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
                                    </svg>
                                </span>
                            ) : (
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <circle cx="12" cy="12" r="6" fill="currentColor" />
                                </svg>
                            )}
                        </button>
                    )}

                    {/* Leave button */}
                    <button
                        onClick={leaveSession}
                        className="w-14 h-14 rounded-full bg-white/10 text-[var(--text-muted)] flex items-center justify-center hover:bg-white/20 transition-all"
                        aria-label="Leave session"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                        </svg>
                    </button>

                    {/* End Session button (only for publishers) */}
                    {canPublish && (
                        <button
                            onClick={endSession}
                            disabled={endingSession}
                            className={`w-14 h-14 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center hover:bg-red-500/30 transition-all ${endingSession ? "opacity-50" : ""}`}
                            aria-label="End session"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5.636 5.636a9 9 0 1012.728 0M12 3v9" />
                            </svg>
                        </button>
                    )}
                </div>
                {canPublish && (
                    <div className="flex justify-center gap-6 mt-2 text-[10px] text-[var(--text-muted)]">
                        <span className="w-14 text-center">Mic</span>
                        <span className="w-14 text-center">Rec</span>
                        <span className="w-14 text-center">Leave</span>
                        <span className="w-14 text-center">End</span>
                    </div>
                )}
            </div>
        </main>
    );
}
