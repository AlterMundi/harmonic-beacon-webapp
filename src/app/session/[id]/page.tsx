"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import {
    DisconnectReason,
    Room,
    RoomEvent,
    Track,
    VideoPresets,
    type Participant,
    type RemoteTrack,
    type RemoteTrackPublication,
    type RoomOptions,
} from "livekit-client";
import { AudioProvider, useAudio } from "@/context/AudioContext";
import HandRaiseButton from "@/components/session/HandRaiseButton";
import StageLayout, { type StagePublisherView } from "@/components/session/StageLayout";
import ThumbnailSender from "@/components/session/ThumbnailSender";
import ThumbnailTapestry from "@/components/session/ThumbnailTapestry";
import type { StageVideoPublication } from "@/components/session/StageTile";
import type { StageConnectionQuality } from "@/lib/stage-layout";
import { redactErrorDetail } from "@/lib/redact";

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://live.altermundi.net";

const STAGE_ROOM_OPTIONS: RoomOptions = {
    adaptiveStream: true,
    dynacast: true,
    videoCaptureDefaults: {
        resolution: VideoPresets.h720.resolution,
    },
    publishDefaults: {
        simulcast: true,
        videoEncoding: VideoPresets.h720.encoding,
        videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
    },
};

const FALLBACK_LABEL = "Participant";

const STAGE_REFRESH_MS = 100;

interface SessionInfo {
    id: string;
    title: string;
    status: string;
    startedAt: string | null;
}

interface ViewerInfo {
    name: string;
    role: string;
    identity: string;
}

type DisconnectKind = "ended" | "transport" | "unknown";

function classifyDisconnectReason(reason?: DisconnectReason): DisconnectKind {
    switch (reason) {
        case DisconnectReason.ROOM_DELETED:
        case DisconnectReason.ROOM_CLOSED:
        case DisconnectReason.PARTICIPANT_REMOVED:
        case DisconnectReason.SERVER_SHUTDOWN:
            return "ended";
        case DisconnectReason.SIGNAL_CLOSE:
        case DisconnectReason.STATE_MISMATCH:
        case DisconnectReason.CONNECTION_TIMEOUT:
        case DisconnectReason.MEDIA_FAILURE:
        case DisconnectReason.JOIN_FAILURE:
        case DisconnectReason.DUPLICATE_IDENTITY:
        case DisconnectReason.MIGRATION:
            return "transport";
        default:
            return "unknown";
    }
}

const STAGE_QUALITIES: readonly string[] = ["excellent", "good", "poor", "lost", "unknown"];

function toStageQuality(quality: unknown): StageConnectionQuality {
    return typeof quality === "string" && STAGE_QUALITIES.includes(quality)
        ? (quality as StageConnectionQuality)
        : "unknown";
}

const CONNECTION_COPY: Record<string, string> = {
    connected: "Connected",
    connecting: "Connecting",
    reconnecting: "Reconnecting",
    signalReconnecting: "Reconnecting",
    disconnected: "Disconnected",
};

const CONNECTION_DOT: Record<string, string> = {
    connected: "bg-[var(--lime)] animate-breathe",
    connecting: "bg-[var(--warning)] animate-breathe",
    reconnecting: "bg-[var(--warning)] animate-breathe",
    signalReconnecting: "bg-[var(--warning)] animate-breathe",
    disconnected: "bg-[var(--danger)]",
};

function isStagePublisher(participant: Participant): boolean {
    return Boolean(participant.permissions?.canPublish) || participant.trackPublications.size > 0;
}

function cameraPublication(participant: Participant): StageVideoPublication | null {
    const [publication] = participant.videoTrackPublications.values();
    return publication ?? null;
}

function participantRole(participant: Participant): string | null {
    try {
        const metadata = JSON.parse(participant.metadata || "{}") as { role?: unknown };
        return typeof metadata.role === "string" ? metadata.role : null;
    } catch {
        return null;
    }
}

function SessionRoom() {
    const { id } = useParams<{ id: string }>();
    const searchParams = useSearchParams();
    const router = useRouter();
    const inviteCode = searchParams.get("invite");

    const {
        audioError: beaconAudioError,
        isPlaying: isBeaconPlaying,
        setVolume: setBeaconVolume,
        startAudio: startBeaconAudio,
        isConnected: beaconConnected,
        hasPlaylistStream,
        hasLiveStream,
    } = useAudio();

    const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [isConnecting, setIsConnecting] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [canPublish, setCanPublish] = useState(false);
    const [principalKind, setPrincipalKind] = useState<"ticket" | "staff">("ticket");
    const [isMicOn, setIsMicOn] = useState(false);
    const [isCameraOn, setIsCameraOn] = useState(false);
    const [audioOnly, setAudioOnly] = useState(false);
    const [connectionState, setConnectionState] = useState<string>("connecting");
    const [stagePublishers, setStagePublishers] = useState<StagePublisherView[]>([]);
    const [activeSpeakerIdentity, setActiveSpeakerIdentity] = useState<string | null>(null);
    const [participantCount, setParticipantCount] = useState(0);
    const [volume, setVolume] = useState(0.8);
    // Start centered: the previous 0.8 default reduced the Beacon bed to
    // 16% gain before the listener touched the crossfader.
    const [mix, setMix] = useState(0.5);
    const [duration, setDuration] = useState(0);
    const [disconnectState, setDisconnectState] = useState<DisconnectKind | null>(null);
    const [retryToken, setRetryToken] = useState(0);
    const [audioActivationError, setAudioActivationError] = useState<string | null>(null);
    const [viewerInfo, setViewerInfo] = useState<ViewerInfo | null>(null);

    const roomRef = useRef<Room | null>(null);
    // Keep ownership by track so an unsubscribe can remove the exact DOM node
    // even after LiveKit has already cleared its srcObject.
    const audioElementsRef = useRef<Map<RemoteTrack, HTMLAudioElement>>(new Map());
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const stageVolumeRef = useRef(volume * mix);
    const audioOnlyRef = useRef(audioOnly);
    const slotOrderRef = useRef<Map<string, number>>(new Map());
    const nextSlotRef = useRef(0);
    const highestSlotRef = useRef(-1);
    const stageRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const intentionalDisconnectRef = useRef(false);
    const terminalViewRef = useRef<HTMLDivElement>(null);

    const slotFor = useCallback((identity: string): number => {
        const existing = slotOrderRef.current.get(identity);
        if (existing !== undefined) return existing;
        const slot = nextSlotRef.current++;
        slotOrderRef.current.set(identity, slot);
        return slot;
    }, []);

    const readStage = useCallback(() => {
        const room = roomRef.current;
        if (!room) return;

        const local = room.localParticipant;
        const everyone: Participant[] = [local, ...room.remoteParticipants.values()];

        const publishers: StagePublisherView[] = everyone
            .filter(isStagePublisher)
            .map((participant) => {
                const label = participant.name?.trim() || FALLBACK_LABEL;
                return {
                    identity: participant.identity,
                    label,
                    isLocal: participant === local,
                    isFacilitator: participantRole(participant) === "FACILITATOR",
                    isSpeaking: participant.isSpeaking,
                    cameraOn: participant.isCameraEnabled,
                    micOn: participant.isMicrophoneEnabled,
                    connectionQuality: toStageQuality(participant.connectionQuality),
                    grantOrder: slotFor(participant.identity),
                    videoPublication: cameraPublication(participant),
                };
            });

        setStagePublishers(publishers);
        setParticipantCount(room.remoteParticipants.size + 1);
        setConnectionState(room.state);
        setCanPublish(Boolean(local.permissions?.canPublish));
        setIsMicOn(local.isMicrophoneEnabled);
        setIsCameraOn(local.isCameraEnabled);

        const newestSlot = publishers.reduce((max, p) => Math.max(max, p.grantOrder), -1);
        if (newestSlot > highestSlotRef.current) {
            highestSlotRef.current = newestSlot;
            setActiveSpeakerIdentity(null);
            return;
        }

        const onStage = new Set(publishers.map((p) => p.identity));
        const speaker = room.activeSpeakers.find((p) => onStage.has(p.identity));
        if (speaker) setActiveSpeakerIdentity(speaker.identity);
    }, [slotFor]);

    const scheduleStageRefresh = useCallback(() => {
        if (stageRefreshRef.current) return;
        stageRefreshRef.current = setTimeout(() => {
            stageRefreshRef.current = null;
            readStage();
        }, STAGE_REFRESH_MS);
    }, [readStage]);

    const applyVideoSubscriptions = useCallback((subscribed: boolean) => {
        const room = roomRef.current;
        if (!room) return;
        room.remoteParticipants.forEach((participant) => {
            participant.videoTrackPublications.forEach((publication) => {
                publication.setSubscribed(subscribed);
            });
        });
    }, []);

    const toggleAudioOnly = useCallback(() => {
        const next = !audioOnlyRef.current;
        audioOnlyRef.current = next;
        setAudioOnly(next);
        applyVideoSubscriptions(!next);
    }, [applyVideoSubscriptions]);

    const leaveSession = useCallback(() => {
        if (roomRef.current) {
            intentionalDisconnectRef.current = true;
            roomRef.current.disconnect();
        }
        router.push("/");
    }, [router]);

    const rejoin = useCallback(() => {
        setDisconnectState(null);
        setIsConnected(false);
        setIsConnecting(true);
        setError(null);
        setAudioActivationError(null);
        setRetryToken((t) => t + 1);
    }, []);

    const startListening = useCallback(async () => {
        setAudioActivationError(null);
        try {
            // Fire every native media play while the browser gesture is still
            // active, before either LiveKit room resumes an AudioContext.
            const stageElementStarts = [...audioElementsRef.current.values()].map(
                (element) => element.play(),
            );
            const beaconStart = startBeaconAudio();
            const stageStart = roomRef.current?.startAudio() ?? Promise.resolve();
            const [, beaconStarted] = await Promise.all([
                Promise.all(stageElementStarts),
                beaconStart,
                stageStart,
            ]);
            if (!beaconStarted) {
                setAudioActivationError(
                    "Beacon audio could not start. Check that this tab is not muted, then try again.",
                );
            }
        } catch (e) {
            console.error("Failed to start session audio:", redactErrorDetail(e));
            setAudioActivationError(
                "Audio could not start. Check that this tab is not muted, then try again.",
            );
        }
    }, [startBeaconAudio]);

    // Connect to LiveKit room
    useEffect(() => {
        let cancelled = false;
        const audioElements = audioElementsRef.current;
        intentionalDisconnectRef.current = false;

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
                setPrincipalKind(data.principalKind === "staff" ? "staff" : "ticket");
                setViewerInfo({
                    name: typeof data.displayName === "string" ? data.displayName : "Participant",
                    role: typeof data.role === "string" ? data.role : "PARTICIPANT",
                    identity: typeof data.identity === "string" ? data.identity : "unknown",
                });
                if (data.session.startedAt) {
                    const elapsed = Math.floor((Date.now() - new Date(data.session.startedAt).getTime()) / 1000);
                    setDuration(Math.max(0, elapsed));
                }

                const room = new Room(STAGE_ROOM_OPTIONS);
                roomRef.current = room;

                room.on(RoomEvent.TrackSubscribed, async (track: RemoteTrack, publication: RemoteTrackPublication) => {
                    if (track.kind === Track.Kind.Audio) {
                        if (cancelled) {
                            track.detach().forEach((element) => element.remove());
                            return;
                        }
                        const previous = audioElementsRef.current.get(track);
                        if (previous) {
                            previous.pause();
                            previous.remove();
                        }
                        const audioElement = track.attach() as HTMLAudioElement;
                        audioElement.volume = stageVolumeRef.current;
                        audioElement.style.display = "none";
                        document.body.appendChild(audioElement);
                        audioElementsRef.current.set(track, audioElement);
                        try { await audioElement.play(); } catch { /* Autoplay blocked */ }
                    } else if (audioOnlyRef.current) {
                        publication.setSubscribed(false);
                    }
                    scheduleStageRefresh();
                });

                room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
                    if (track.kind === Track.Kind.Audio) {
                        const tracked = audioElementsRef.current.get(track);
                        track.detach().forEach((el) => el.remove());
                        if (tracked) {
                            tracked.pause();
                            tracked.remove();
                            audioElementsRef.current.delete(track);
                        }
                    }
                    scheduleStageRefresh();
                });

                room.on(RoomEvent.TrackPublished, (publication: RemoteTrackPublication) => {
                    if (audioOnlyRef.current && publication.kind === Track.Kind.Video) {
                        publication.setSubscribed(false);
                    }
                    scheduleStageRefresh();
                });

                room.on(RoomEvent.TrackUnpublished, scheduleStageRefresh);
                room.on(RoomEvent.TrackMuted, scheduleStageRefresh);
                room.on(RoomEvent.TrackUnmuted, scheduleStageRefresh);
                room.on(RoomEvent.LocalTrackPublished, scheduleStageRefresh);
                room.on(RoomEvent.LocalTrackUnpublished, scheduleStageRefresh);
                room.on(RoomEvent.ActiveSpeakersChanged, scheduleStageRefresh);
                room.on(RoomEvent.TrackSubscriptionStatusChanged, scheduleStageRefresh);
                room.on(RoomEvent.ParticipantConnected, scheduleStageRefresh);
                room.on(RoomEvent.ParticipantDisconnected, scheduleStageRefresh);
                room.on(RoomEvent.ConnectionStateChanged, scheduleStageRefresh);
                room.on(RoomEvent.Reconnecting, scheduleStageRefresh);
                room.on(RoomEvent.Reconnected, scheduleStageRefresh);

                room.on(RoomEvent.ConnectionQualityChanged, (_quality: unknown, participant: Participant) => {
                    if (isStagePublisher(participant)) scheduleStageRefresh();
                });

                room.on(RoomEvent.ParticipantPermissionsChanged, (_prev: unknown, participant: Participant) => {
                    if (participant === room.localParticipant && !participant.permissions?.canPublish) {
                        Promise.all([
                            room.localParticipant.setCameraEnabled(false),
                            room.localParticipant.setMicrophoneEnabled(false),
                        ])
                            .catch((e) => {
                                console.error("Failed to release stage devices:", redactErrorDetail(e));
                            })
                            .finally(scheduleStageRefresh);
                    }
                    scheduleStageRefresh();
                });

                room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
                    setIsConnected(false);
                    if (cancelled || intentionalDisconnectRef.current) return;
                    setDisconnectState(classifyDisconnectReason(reason));
                });

                await room.connect(LIVEKIT_URL, data.token);
                if (cancelled) {
                    room.disconnect();
                    return;
                }

                setIsConnected(true);
                setIsConnecting(false);
                if (audioOnlyRef.current) applyVideoSubscriptions(false);
                readStage();
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
            if (stageRefreshRef.current) {
                clearTimeout(stageRefreshRef.current);
                stageRefreshRef.current = null;
            }
            if (roomRef.current) {
                roomRef.current.disconnect();
            }
            audioElements.forEach((el) => {
                el.pause();
                el.remove();
            });
            audioElements.clear();
        };
    }, [id, inviteCode, retryToken, readStage, scheduleStageRefresh, applyVideoSubscriptions]);

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

    useEffect(() => {
        if (disconnectState) {
            terminalViewRef.current?.focus();
        }
    }, [disconnectState]);

    useEffect(() => {
        const sessionVol = volume * mix;
        const beaconVol = volume * (1 - mix);
        stageVolumeRef.current = sessionVol;
        audioElementsRef.current.forEach((el) => {
            el.volume = sessionVol;
        });
        setBeaconVolume(beaconVol);
    }, [volume, mix, setBeaconVolume]);

    const toggleMic = useCallback(async () => {
        const room = roomRef.current;
        if (!room || !canPublish) return;
        try {
            await room.localParticipant.setMicrophoneEnabled(!isMicOn);
        } catch (e) {
            console.error("Failed to toggle microphone:", redactErrorDetail(e));
        }
        readStage();
    }, [canPublish, isMicOn, readStage]);

    const toggleCamera = useCallback(async () => {
        const room = roomRef.current;
        if (!room || !canPublish) return;
        try {
            await room.localParticipant.setCameraEnabled(!isCameraOn);
        } catch (e) {
            console.error("Failed to toggle camera:", redactErrorDetail(e));
        }
        readStage();
    }, [canPublish, isCameraOn, readStage]);

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    // Loading state
    if (isConnecting) {
        return (
            <main className="event-shell">
                <div className="relative z-10 flex min-h-screen items-center justify-center">
                    <div className="terminal-state">
                        <div className="terminal-state__icon">&#10022;</div>
                        <p className="terminal-state__title" style={{ fontFamily: "var(--font-cormorant), Georgia, serif" }}>
                            Connecting
                        </p>
                        <p className="terminal-state__body">
                            Entering the Harmonic field…
                        </p>
                    </div>
                </div>
            </main>
        );
    }

    // Error state
    if (error) {
        return (
            <main className="event-shell">
                <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
                    <div className="event-card w-full max-w-sm text-center">
                        <div className="terminal-state__icon text-[var(--danger)]">&#9888;</div>
                        <h2 className="terminal-state__title">Connection Error</h2>
                        <p className="terminal-state__body">{error}</p>
                        <div className="mt-4 flex flex-col gap-2">
                            <button onClick={rejoin} className="event-button event-button--primary w-full">
                                Try again
                            </button>
                            <button onClick={() => router.push("/")} className="event-button event-button--secondary w-full">
                                Back to Sessions
                            </button>
                        </div>
                    </div>
                </div>
            </main>
        );
    }

    // Terminal state
    if (disconnectState) {
        const copy = {
            ended: {
                heading: "Session ended",
                body: "This session has ended. You're no longer connected.",
                esBody: "Esta sesión ha terminado. Ya no estás conectado.",
                showRejoin: false,
            },
            transport: {
                heading: "Connection lost",
                body: "Your connection to this session was lost.",
                esBody: "Se perdió la conexión con esta sesión.",
                showRejoin: true,
            },
            unknown: {
                heading: "Disconnected",
                body: "You're no longer connected to this session. We can't tell whether it ended or your connection dropped.",
                esBody: "Ya no estás conectado a esta sesión. No podemos saber si terminó o se cortó la conexión.",
                showRejoin: true,
            },
        }[disconnectState];

        return (
            <main className="event-shell">
                <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
                    <div
                        ref={terminalViewRef}
                        role="status"
                        aria-live="polite"
                        tabIndex={-1}
                        className="event-card w-full max-w-sm text-center outline-none"
                    >
                        <div className="terminal-state__icon">&#10022;</div>
                        <h2 className="terminal-state__title">{copy.heading}</h2>
                        <p className="terminal-state__body">{copy.body}</p>
                        <p className="mt-1 text-xs text-[var(--text-muted)] opacity-70">{copy.esBody}</p>
                        <div className="mt-4 flex flex-col gap-2">
                            {copy.showRejoin && (
                                <button onClick={rejoin} className="event-button event-button--primary w-full">
                                    Rejoin / Volver a entrar
                                </button>
                            )}
                            <button onClick={() => router.push("/")} className="event-button event-button--secondary w-full">
                                Back to Sessions / Volver
                            </button>
                        </div>
                    </div>
                </div>
            </main>
        );
    }

    const connectionLabel = CONNECTION_COPY[connectionState] ?? "Connecting";
    const needsDeviceGesture = canPublish && !isMicOn && !isCameraOn;

    return (
        <main className="event-shell">
            <div className="relative z-10 flex min-h-screen flex-col">
                {/* Header */}
                <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
                    <div className="min-w-0 flex-1">
                        <h1 className="truncate text-sm font-semibold text-[var(--cream)]">
                            {sessionInfo?.title || "Session"}
                        </h1>
                        <p className="text-[10px] text-[var(--text-muted)]" aria-live="polite">
                            <span className="font-mono">{participantCount}</span> participant{participantCount !== 1 ? "s" : ""}
                            <span
                                className="ml-2 inline-flex items-center gap-1"
                                data-testid="connection-state"
                                data-state={connectionState}
                            >
                                <span className={`inline-block h-1.5 w-1.5 rounded-full ${CONNECTION_DOT[connectionState] ?? "bg-white/30"}`} />
                                {connectionLabel}
                            </span>
                        </p>
                        {viewerInfo && (
                            <p className="mt-1 truncate text-[10px] text-[var(--gold)]" data-testid="viewer-identity">
                                Signed in: <strong>{viewerInfo.name}</strong>
                                {' · '}{viewerInfo.role}
                                {' · '}ID <span className="font-mono">{viewerInfo.identity.slice(-8)}</span>
                            </p>
                        )}
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-3">
                        {principalKind === "staff" && (
                            <Link
                                href={`/ops/session/${id}`}
                                className="rounded border border-[var(--gold)]/40 px-2 py-1 text-xs text-[var(--gold)] hover:bg-[var(--gold)]/10"
                            >
                                Spotlight · hands
                            </Link>
                        )}
                        <span className="font-mono text-xs text-[var(--gold)]">{formatTime(duration)}</span>
                    </div>
                </header>

                {/* Stage */}
                <div className="flex flex-1 flex-col items-center justify-center gap-5 px-3 py-4 sm:px-4">
                    <StageLayout
                        publishers={stagePublishers}
                        activeSpeakerIdentity={activeSpeakerIdentity}
                        audioOnly={audioOnly}
                    />

                    {!isBeaconPlaying && (
                        <div className="event-card w-full max-w-md text-center" role="group" aria-label="Audio activation">
                            <p className="mb-3 text-sm text-[var(--text-secondary)]">
                                Press once to hear the session and Beacon.
                                <span className="mt-1 block opacity-80">Presiona una vez para escuchar la sesión y el Beacon.</span>
                            </p>
                            <button onClick={startListening} className="event-button event-button--primary w-full">
                                Start audio · Iniciar audio
                            </button>
                            {(audioActivationError || beaconAudioError) && (
                                <p className="mt-3 text-sm text-[var(--danger)]" role="alert">
                                    {audioActivationError || beaconAudioError}
                                </p>
                            )}
                        </div>
                    )}

                    {needsDeviceGesture && (
                        <p className="text-center text-sm text-[var(--lime)]">
                            Your turn — enable camera and mic
                            <span className="mt-0.5 block text-xs opacity-80">Tu turno — activá cámara y micrófono</span>
                        </p>
                    )}

                    <ThumbnailSender
                        sessionId={id}
                        connected={isConnected}
                        isPublishing={canPublish}
                    />

                    <ThumbnailTapestry sessionId={id} />

                    {/* Volume + Mix controls */}
                    <div className="w-full max-w-xs space-y-4">
                        <div className="crossfader">
                            <svg className="h-4 w-4 shrink-0 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            </svg>
                            <input
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={volume}
                                onChange={(e) => setVolume(parseFloat(e.target.value))}
                                className="flex-1 accent-[var(--gold)]"
                                aria-label="Master volume"
                            />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <span className="w-10 text-right font-mono text-[9px] uppercase tracking-wider text-[var(--gold)]">Beacon</span>
                                <input
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={mix}
                                    onChange={(e) => setMix(parseFloat(e.target.value))}
                                    className="flex-1 accent-[var(--cyan)]"
                                    aria-label="Beacon and session mix"
                                />
                                <span className="w-10 font-mono text-[9px] uppercase tracking-wider text-[var(--cyan)]">Session</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Beacon audio debug — see AudioContext connection/stream state at a glance */}
                <div className="mx-auto mb-3 max-w-md rounded border border-[var(--border-subtle)] bg-[var(--surface-alt)] px-3 py-2 text-center text-[10px] text-[var(--text-muted)]">
                    Beacon room: {beaconConnected ? <span className="text-[var(--lime)]">connected</span> : <span className="text-[var(--danger)]">disconnected</span>}
                    {' · '}Playlist: {hasPlaylistStream ? <span className="text-[var(--lime)]">active</span> : <span className="text-[var(--danger)]">none</span>}
                    {' · '}Live: {hasLiveStream ? <span className="text-[var(--lime)]">active</span> : <span className="text-[var(--danger)]">none</span>}
                    {beaconAudioError ? <>{' · '}<span className="text-[var(--danger)]">error: {beaconAudioError}</span></> : null}
                </div>

                {/* Bottom controls */}
                <div className="border-t border-[var(--border-subtle)] px-4 py-4">
                    {isConnected && principalKind === "ticket" && (
                        <div className="mb-4 flex justify-center">
                            <HandRaiseButton
                                sessionId={id}
                                onPublishGrantChange={setCanPublish}
                            />
                        </div>
                    )}
                    <div className="flex items-start justify-center gap-4">
                        {canPublish && (
                            <div className="flex flex-col items-center gap-1">
                                <button
                                    onClick={toggleMic}
                                    className={`flex h-14 w-14 items-center justify-center rounded-full transition-all ${
                                        isMicOn
                                            ? "bg-[var(--cyan)] text-[var(--ink)]"
                                            : "bg-white/10 text-[var(--text-muted)] hover:bg-white/20"
                                    }`}
                                    aria-label={isMicOn ? "Mute microphone" : "Unmute microphone"}
                                    aria-pressed={isMicOn}
                                >
                                    {isMicOn ? (
                                        <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                        </svg>
                                    ) : (
                                        <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                                            <line x1="2" y1="2" x2="22" y2="22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                                        </svg>
                                    )}
                                </button>
                                <span className="text-[9px] text-[var(--text-muted)]">Mic</span>
                            </div>
                        )}

                        {canPublish && (
                            <div className="flex flex-col items-center gap-1">
                                <button
                                    onClick={toggleCamera}
                                    className={`flex h-14 w-14 items-center justify-center rounded-full transition-all ${
                                        isCameraOn
                                            ? "bg-[var(--cyan)] text-[var(--ink)]"
                                            : "bg-white/10 text-[var(--text-muted)] hover:bg-white/20"
                                    }`}
                                    aria-label={isCameraOn ? "Turn camera off" : "Turn camera on"}
                                    aria-pressed={isCameraOn}
                                >
                                    <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        {!isCameraOn && <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" />}
                                    </svg>
                                </button>
                                <span className="text-[9px] text-[var(--text-muted)]">Camera</span>
                            </div>
                        )}

                        <div className="flex flex-col items-center gap-1">
                            <button
                                onClick={toggleAudioOnly}
                                className={`flex h-14 w-14 items-center justify-center rounded-full transition-all ${
                                    audioOnly
                                        ? "bg-[var(--gold)] text-[var(--ink)]"
                                        : "bg-white/10 text-[var(--text-muted)] hover:bg-white/20"
                                }`}
                                aria-label={audioOnly ? "Turn video back on" : "Switch to audio only"}
                                aria-pressed={audioOnly}
                            >
                                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l7-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm7-3a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </button>
                            <span className="text-[9px] text-[var(--text-muted)]">Audio only</span>
                        </div>

                        <div className="flex flex-col items-center gap-1">
                            <button
                                onClick={leaveSession}
                                className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-[var(--text-muted)] transition-all hover:bg-white/20"
                                aria-label="Leave session"
                            >
                                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                            </button>
                            <span className="text-[9px] text-[var(--text-muted)]">Leave</span>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    );
}

export default function SessionRoomPage() {
    const { id } = useParams<{ id: string }>();

    return (
        <AudioProvider sessionId={id}>
            <SessionRoom />
        </AudioProvider>
    );
}
