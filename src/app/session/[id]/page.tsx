"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import {
    DisconnectReason,
    Room,
    RoomEvent,
    Track,
    VideoPresets,
    type Participant,
    type RemoteParticipant,
    type RemoteTrack,
    type RemoteTrackPublication,
    type RoomOptions,
} from "livekit-client";
import { AudioProvider, useAudio } from "@/context/AudioContext";
import StageLayout, { type StagePublisherView } from "@/components/session/StageLayout";
import type { StageVideoPublication } from "@/components/session/StageTile";
import type { StageConnectionQuality } from "@/lib/stage-layout";
import { redactErrorDetail } from '@/lib/redact';

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://live.altermundi.net";

/**
 * WEEKEND_MVP_ROADMAP.md §1: "The stage publishes simulcast. The active
 * speaker/Julián tile requests the 720p layer; at most five auxiliary tiles
 * request 360p."
 *
 * - `adaptiveStream` lets the SFU stop sending video for tiles that are
 *   scrolled out of view or in a backgrounded tab; each tile then pins the layer
 *   it wants while visible (see StageTile).
 * - `dynacast` stops publishing layers nobody subscribes to, which is the other
 *   half of the same saving: with 150 subscribers all on 360p auxiliaries, the
 *   720p layer of those five publishers is never encoded.
 * - The publisher sends 720p + 360p + 180p. 180p exists for the mobile strip and
 *   for a publisher whose uplink collapses.
 */
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

/** Role words minted by `resolveRoomPrincipal` — never an email or a code. */
const FACILITATOR_LABEL = "Facilitator";
const FALLBACK_LABEL = "Participant";

/**
 * Room events arrive per participant. At the 150-attendee cap a join burst is
 * 150 `ParticipantConnected` events in a few seconds; each one would otherwise
 * rebuild the stage snapshot and re-render. Coalescing into one read per frame
 * budget keeps the cost proportional to the six tiles that can change, not to
 * the audience size.
 */
const STAGE_REFRESH_MS = 100;

interface SessionInfo {
    id: string;
    title: string;
    status: string;
    startedAt: string | null;
}

// What RoomEvent.Disconnected tells us, collapsed to the three things a
// participant can be told without guessing:
// - "ended": someone deliberately ended the room server-side (Admin kill
//   switch or Provider ending their own session). Say the session ended;
//   don't speculate about who did it or why.
// - "transport": a network-shaped failure. Say the connection dropped and
//   offer to rejoin.
// - "unknown": the SDK gave no reason, or one we don't have a bucket for.
//   Don't guess which of the above it was — say we can't tell.
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

/**
 * `ConnectionQuality` is a string enum whose values already match the tile's
 * vocabulary. Reading it as a string keeps the SDK enum out of the components.
 */
function toStageQuality(quality: unknown): StageConnectionQuality {
    return typeof quality === "string" && STAGE_QUALITIES.includes(quality)
        ? (quality as StageConnectionQuality)
        : "unknown";
}

/** How the room-level `ConnectionState` reads in the header. */
const CONNECTION_COPY: Record<string, string> = {
    connected: "Connected",
    connecting: "Connecting",
    reconnecting: "Reconnecting",
    signalReconnecting: "Reconnecting",
    disconnected: "Disconnected",
};

const CONNECTION_DOT: Record<string, string> = {
    connected: "bg-green-400 animate-pulse",
    connecting: "bg-amber-400 animate-pulse",
    reconnecting: "bg-amber-400 animate-pulse",
    signalReconnecting: "bg-amber-400 animate-pulse",
    disconnected: "bg-red-400",
};

/**
 * A stage tile belongs to a stage grant, not to attendance. The 150 subscribe-only
 * attendees have `canPublish: false` and publish nothing, so they never produce a
 * tile. The publication fallback covers the window where a grant is live on the
 * wire before the permission update has been applied locally.
 */
function isStagePublisher(participant: Participant): boolean {
    return Boolean(participant.permissions?.canPublish) || participant.trackPublications.size > 0;
}

/**
 * The stage token grants only MICROPHONE and CAMERA (see `createSessionToken`),
 * so a participant's single video publication is their camera. No screen share
 * can appear here and be mistaken for one.
 */
function cameraPublication(participant: Participant): StageVideoPublication | null {
    const [publication] = participant.videoTrackPublications.values();
    return publication ?? null;
}

function SessionRoom() {
    const { id } = useParams<{ id: string }>();
    const searchParams = useSearchParams();
    const router = useRouter();
    const inviteCode = searchParams.get("invite");

    const { setVolume: setBeaconVolume } = useAudio();

    const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [endingSession, setEndingSession] = useState(false);
    const [isConnecting, setIsConnecting] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [canPublish, setCanPublish] = useState(false);
    const [isMicOn, setIsMicOn] = useState(false);
    const [isCameraOn, setIsCameraOn] = useState(false);
    const [audioOnly, setAudioOnly] = useState(false);
    const [connectionState, setConnectionState] = useState<string>("connecting");
    const [stagePublishers, setStagePublishers] = useState<StagePublisherView[]>([]);
    const [activeSpeakerIdentity, setActiveSpeakerIdentity] = useState<string | null>(null);
    const [participantCount, setParticipantCount] = useState(0);
    const [volume, setVolume] = useState(0.8);
    const [mix, setMix] = useState(0.8); // 0 = all beacon, 1 = all session
    const [duration, setDuration] = useState(0);
    const [disconnectState, setDisconnectState] = useState<DisconnectKind | null>(null);
    const [retryToken, setRetryToken] = useState(0);

    const roomRef = useRef<Room | null>(null);
    const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const volumeRef = useRef(volume);
    // Read inside room event handlers, which are registered once per connection
    // and would otherwise close over a stale `audioOnly`.
    const audioOnlyRef = useRef(audioOnly);
    // Slot number per identity, assigned on first sighting of a stage grant and
    // never recycled. Deliberately outside the connect effect: a rejoin reuses
    // the numbers, so the same identities come back to the same tiles.
    const slotOrderRef = useRef<Map<string, number>>(new Map());
    const nextSlotRef = useRef(0);
    // Highest slot number ever on stage. A newly granted publisher exceeds it,
    // which is how "the spotlight follows the facilitator-promoted publisher".
    const highestSlotRef = useRef(-1);
    const stageRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // Set right before we call room.disconnect() ourselves (leave, end session)
    // so the room-level Disconnected handler below can tell "we did this on
    // purpose" apart from the server or the network doing it to us.
    const intentionalDisconnectRef = useRef(false);
    const terminalViewRef = useRef<HTMLDivElement>(null);

    // Keep volumeRef in sync with state
    useEffect(() => { volumeRef.current = volume; }, [volume]);

    const slotFor = useCallback((identity: string): number => {
        const existing = slotOrderRef.current.get(identity);
        if (existing !== undefined) return existing;
        const slot = nextSlotRef.current++;
        slotOrderRef.current.set(identity, slot);
        return slot;
    }, []);

    /**
     * Rebuild the whole stage snapshot from the room. One reader for every event
     * rather than a partial update per event: with permissions, mute state,
     * speaking state, subscriptions and quality all changing independently, the
     * only cheap way to stay consistent is to re-derive.
     */
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
                    isFacilitator: label === FACILITATOR_LABEL,
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
            // Someone was just given the floor. Hand them the spotlight rather
            // than leaving it on whoever spoke last.
            highestSlotRef.current = newestSlot;
            setActiveSpeakerIdentity(null);
            return;
        }

        const onStage = new Set(publishers.map((p) => p.identity));
        const speaker = room.activeSpeakers.find((p) => onStage.has(p.identity));
        // Sticky: `activeSpeakers` empties the moment audio level drops, and a
        // spotlight that snapped back between sentences would be unwatchable.
        if (speaker) setActiveSpeakerIdentity(speaker.identity);
    }, [slotFor]);

    const scheduleStageRefresh = useCallback(() => {
        if (stageRefreshRef.current) return;
        stageRefreshRef.current = setTimeout(() => {
            stageRefreshRef.current = null;
            readStage();
        }, STAGE_REFRESH_MS);
    }, [readStage]);

    /**
     * Audio-only degradation. This drops the video *subscriptions* — nothing is
     * sent to this client and nothing decodes — while the stage audio elements
     * and the separate Beacon bed connection are left completely alone. It is
     * not a scope cut (roadmap §5): a publisher's own camera is governed by the
     * camera button, not by this.
     */
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

    const endSession = useCallback(async () => {
        if (!sessionInfo || endingSession) return;
        setEndingSession(true);
        try {
            const res = await fetch(`/api/ops/sessions/${id}/stage`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "end" }),
            });
            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || "Failed to end session");
            }
            if (roomRef.current) {
                intentionalDisconnectRef.current = true;
                roomRef.current.disconnect();
            }
            router.push("/");
        } catch (e) {
            console.error("Failed to end session:", redactErrorDetail(e));
            setEndingSession(false);
        }
    }, [sessionInfo, endingSession, id, router]);

    const leaveSession = useCallback(async () => {
        // Record leave
        try {
            await fetch(`/api/scheduled-sessions/${id}/leave`, { method: "POST" });
        } catch {
            // Best effort
        }

        // Disconnect from room
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
        setRetryToken((t) => t + 1);
    }, []);

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
                // Initialize timer from session startedAt
                if (data.session.startedAt) {
                    const elapsed = Math.floor((Date.now() - new Date(data.session.startedAt).getTime()) / 1000);
                    setDuration(Math.max(0, elapsed));
                }

                const room = new Room(STAGE_ROOM_OPTIONS);
                roomRef.current = room;

                room.on(RoomEvent.TrackSubscribed, async (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
                    if (track.kind === Track.Kind.Audio) {
                        // Stage voice lives in hidden elements owned by the page,
                        // not by a tile: it has to survive audio-only mode and
                        // any tile unmounting, and it is what the crossfader
                        // attenuates against the Beacon bed.
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
                    } else if (audioOnlyRef.current) {
                        // Auto-subscribe raced our preference; undo it.
                        publication.setSubscribed(false);
                    }
                    scheduleStageRefresh();
                });

                room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _pub: RemoteTrackPublication, participant: RemoteParticipant) => {
                    if (track.kind === Track.Kind.Audio) {
                        track.detach().forEach((el) => el.remove());
                        audioElementsRef.current.delete(participant.identity);
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
                    // The audience reports quality too. Only the six tiles show it.
                    if (isStagePublisher(participant)) scheduleStageRefresh();
                });

                room.on(RoomEvent.ParticipantPermissionsChanged, (_prev: unknown, participant: Participant) => {
                    if (participant === room.localParticipant && !participant.permissions?.canPublish) {
                        // Demoted. Unpublish and stop both devices now rather
                        // than waiting for the operator's force-mute to land:
                        // WS2-02 requires this inside two seconds.
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
                    // We already know why: either this effect is tearing down
                    // (cancelled) or we called disconnect() ourselves (leave/end).
                    // Neither needs the terminal view — the caller is already
                    // navigating away.
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
                // A rejoin while audio-only must not quietly start pulling video.
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

    // Move focus into the terminal view when it replaces the live session UI,
    // so a screen reader user lands on the announcement rather than on
    // whatever the focused control used to be.
    useEffect(() => {
        if (disconnectState) {
            terminalViewRef.current?.focus();
        }
    }, [disconnectState]);

    // Apply mix: distribute master volume between session and beacon
    useEffect(() => {
        const sessionVol = volume * mix;
        const beaconVol = volume * (1 - mix);
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
                    <button onClick={() => router.push("/")} className="btn-secondary">
                        Back to Sessions
                    </button>
                </div>
            </main>
        );
    }

    // Terminal state: the room-level Disconnected event fired for a reason
    // that wasn't us leaving on purpose. What we say depends on what LiveKit
    // told us — see classifyDisconnectReason above.
    if (disconnectState) {
        const copy = {
            ended: {
                heading: "Session ended",
                body: "This session has ended. You're no longer connected.",
                showRejoin: false,
            },
            transport: {
                heading: "Connection lost",
                body: "Your connection to this session was lost.",
                showRejoin: true,
            },
            unknown: {
                heading: "Disconnected",
                body: "You're no longer connected to this session. We can't tell whether it ended or your connection dropped.",
                showRejoin: true,
            },
        }[disconnectState];

        return (
            <main className="min-h-screen flex items-center justify-center px-4">
                <div
                    ref={terminalViewRef}
                    role="status"
                    aria-live="polite"
                    tabIndex={-1}
                    className="glass-card p-8 text-center max-w-sm w-full outline-none"
                >
                    <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-white/10 flex items-center justify-center">
                        <svg className="w-8 h-8 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636a9 9 0 010 12.728m-3.536-3.536a4 4 0 010-5.656M5.636 5.636a9 9 0 000 12.728" />
                        </svg>
                    </div>
                    <h2 className="text-xl font-semibold mb-2">{copy.heading}</h2>
                    <p className="text-sm text-[var(--text-muted)] mb-4">{copy.body}</p>
                    <div className="flex flex-col gap-2">
                        {copy.showRejoin && (
                            <button onClick={rejoin} className="btn-primary">
                                Rejoin
                            </button>
                        )}
                        <button onClick={() => router.push("/")} className="btn-secondary">
                            Back to Sessions
                        </button>
                    </div>
                </div>
            </main>
        );
    }

    const connectionLabel = CONNECTION_COPY[connectionState] ?? "Connecting";
    const needsDeviceGesture = canPublish && !isMicOn && !isCameraOn;

    return (
        <main className="min-h-screen flex flex-col">
            {/* Header */}
            <header className="p-4 flex items-center justify-between border-b border-[var(--border-subtle)]">
                <div className="min-w-0 flex-1">
                    <h1 className="font-semibold truncate">{sessionInfo?.title || "Session"}</h1>
                    {/* aria-live without role="status": the terminal view owns the
                        page's only status role, and a second one would compete
                        with it for assistive-technology attention. */}
                    <p className="text-xs text-[var(--text-muted)]" aria-live="polite">
                        {participantCount} participant{participantCount !== 1 ? "s" : ""}
                        <span
                            className="ml-2 inline-flex items-center gap-1"
                            data-testid="connection-state"
                            data-state={connectionState}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full ${CONNECTION_DOT[connectionState] ?? "bg-white/30"}`}></span>
                            {connectionLabel}
                        </span>
                    </p>
                </div>
                <span className="text-sm font-mono text-[var(--text-muted)]">{formatTime(duration)}</span>
            </header>

            {/* Stage */}
            <div className="flex-1 flex flex-col items-center justify-center gap-6 px-3 py-4 sm:px-4">
                <StageLayout
                    publishers={stagePublishers}
                    activeSpeakerIdentity={activeSpeakerIdentity}
                    audioOnly={audioOnly}
                />

                {/* A grant is not consent to open a device. Nothing is enabled
                    until the promoted participant presses a button. */}
                {needsDeviceGesture && (
                    <p className="text-sm text-[var(--accent-400)] text-center">
                        Your turn—enable camera and mic
                    </p>
                )}

                {/* Volume + Mix controls */}
                <div className="w-full max-w-xs space-y-4">
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
                            aria-label="Master volume"
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
                                aria-label="Beacon and session mix"
                            />
                            <span className="text-[10px] text-[var(--text-muted)] w-12">Session</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Bottom controls */}
            <div className="p-6 border-t border-[var(--border-subtle)]">
                <div className="flex items-start justify-center gap-4">
                    {/* Mic toggle (only for publishers) */}
                    {canPublish && (
                        <div className="flex flex-col items-center gap-1">
                            <button
                                onClick={toggleMic}
                                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                                    isMicOn
                                        ? "bg-[var(--primary-600)] text-white"
                                        : "bg-white/10 text-[var(--text-muted)] hover:bg-white/20"
                                }`}
                                aria-label={isMicOn ? "Mute microphone" : "Unmute microphone"}
                                aria-pressed={isMicOn}
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
                            <span className="text-[10px] text-[var(--text-muted)]">Mic</span>
                        </div>
                    )}

                    {/* Camera toggle (only for publishers) */}
                    {canPublish && (
                        <div className="flex flex-col items-center gap-1">
                            <button
                                onClick={toggleCamera}
                                className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                                    isCameraOn
                                        ? "bg-[var(--primary-600)] text-white"
                                        : "bg-white/10 text-[var(--text-muted)] hover:bg-white/20"
                                }`}
                                aria-label={isCameraOn ? "Turn camera off" : "Turn camera on"}
                                aria-pressed={isCameraOn}
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                    {!isCameraOn && <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" />}
                                </svg>
                            </button>
                            <span className="text-[10px] text-[var(--text-muted)]">Camera</span>
                        </div>
                    )}

                    {/* Audio-only fallback — available to everyone, publisher or not */}
                    <div className="flex flex-col items-center gap-1">
                        <button
                            onClick={toggleAudioOnly}
                            className={`w-14 h-14 rounded-full flex items-center justify-center transition-all ${
                                audioOnly
                                    ? "bg-[var(--accent-500)] text-black"
                                    : "bg-white/10 text-[var(--text-muted)] hover:bg-white/20"
                            }`}
                            aria-label={audioOnly ? "Turn video back on" : "Switch to audio only"}
                            aria-pressed={audioOnly}
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l7-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm7-3a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                        </button>
                        <span className="text-[10px] text-[var(--text-muted)]">Audio only</span>
                    </div>

                    {/* Leave button */}
                    <div className="flex flex-col items-center gap-1">
                        <button
                            onClick={leaveSession}
                            className="w-14 h-14 rounded-full bg-white/10 text-[var(--text-muted)] flex items-center justify-center hover:bg-white/20 transition-all"
                            aria-label="Leave session"
                        >
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                        </button>
                        <span className="text-[10px] text-[var(--text-muted)]">Leave</span>
                    </div>

                    {/* End Session button (only for publishers) */}
                    {canPublish && (
                        <div className="flex flex-col items-center gap-1">
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
                            <span className="text-[10px] text-[var(--text-muted)]">End</span>
                        </div>
                    )}
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
