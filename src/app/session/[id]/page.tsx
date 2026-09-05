"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import {
    AudioPresets,
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
import { useLocale } from "@/context/LocaleContext";
import HandRaiseButton from "@/components/session/HandRaiseButton";
import FacilitatorAudioQuality from "@/components/session/FacilitatorAudioQuality";
import SessionContributions from "@/components/session/SessionContributions";
import SessionGuidance from "@/components/session/SessionGuidance";
import StageLayout, { type StagePublisherView } from "@/components/session/StageLayout";
import ThumbnailSender from "@/components/session/ThumbnailSender";
import ThumbnailTapestry from "@/components/session/ThumbnailTapestry";
import type { StageVideoPublication } from "@/components/session/StageTile";
import type { StageConnectionQuality } from "@/lib/stage-layout";
import { redactErrorDetail } from "@/lib/redact";
import { isLocalizedStaffRole, localeForEventLanguage, staffRolePresentation } from "@/lib/i18n";

const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://live.altermundi.net";

function stageRoomOptions(isAssignedFacilitator: boolean): RoomOptions {
    return {
        adaptiveStream: true,
        dynacast: true,
        videoCaptureDefaults: {
            resolution: VideoPresets.h720.resolution,
        },
        ...(isAssignedFacilitator ? {
            audioCaptureDefaults: {
                sampleRate: { ideal: 48_000 },
                channelCount: { ideal: 1 },
                autoGainControl: false,
                echoCancellation: false,
                noiseSuppression: false,
                voiceIsolation: false,
            },
        } : {}),
        publishDefaults: {
            simulcast: true,
            videoEncoding: VideoPresets.h720.encoding,
            videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
            ...(isAssignedFacilitator ? {
                // Audio keeps WebRTC's high network priority. This is a ceiling,
                // not a promise that a constrained connection will deliver 96 kbps;
                // the Staff monitor reports the effective rate instead of acting on it.
                audioPreset: { ...AudioPresets.musicHighQuality, priority: 'high' as const },
                dtx: false,
                red: true,
                forceStereo: false,
            } : {}),
        },
    };
}

const STAGE_REFRESH_MS = 100;
const STAGE_HANDOFF_MAX_AGE_MS = 30_000;

type StageHandoff = {
    microphone: boolean;
    camera: boolean;
    audioOnly: boolean;
    createdAt: number;
};

function stageHandoffKey(sessionId: string): string {
    return `hb-stage-handoff:${sessionId}`;
}

function takeStageHandoff(sessionId: string): StageHandoff | null {
    try {
        const key = stageHandoffKey(sessionId);
        const serialized = window.sessionStorage.getItem(key);
        window.sessionStorage.removeItem(key);
        if (!serialized) return null;
        const value = JSON.parse(serialized) as Partial<StageHandoff>;
        if (typeof value.createdAt !== "number" || Date.now() - value.createdAt > STAGE_HANDOFF_MAX_AGE_MS) {
            return null;
        }
        return {
            microphone: value.microphone === true,
            camera: value.camera === true,
            audioOnly: value.audioOnly === true,
            createdAt: value.createdAt,
        };
    } catch {
        return null;
    }
}

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
    isAssignedFacilitator: boolean;
}

type DisconnectKind = "ended" | "transport" | "duplicate" | "unknown";
type CameraFacingMode = "user" | "environment";

const AUTO_RECONNECT_DELAYS_MS = [500, 1_500, 3_000] as const;

function classifyDisconnectReason(reason?: DisconnectReason): DisconnectKind {
    switch (reason) {
        case DisconnectReason.ROOM_DELETED:
        case DisconnectReason.ROOM_CLOSED:
        case DisconnectReason.SERVER_SHUTDOWN:
            return "ended";
        // Durable demotion/revocation rotates the participant identity and
        // removes the fenced connection. A still-authorized attendee must
        // fetch a fresh token and return as audience; room deletion remains
        // the authoritative terminal signal for an ended session.
        case DisconnectReason.PARTICIPANT_REMOVED:
        case DisconnectReason.SIGNAL_CLOSE:
        case DisconnectReason.STATE_MISMATCH:
        case DisconnectReason.CONNECTION_TIMEOUT:
        case DisconnectReason.MEDIA_FAILURE:
        case DisconnectReason.JOIN_FAILURE:
        case DisconnectReason.MIGRATION:
            return "transport";
        case DisconnectReason.DUPLICATE_IDENTITY:
            return "duplicate";
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

const CONNECTION_DOT: Record<string, string> = {
    connected: "bg-[var(--lime)] animate-breathe",
    connecting: "bg-[var(--warning)] animate-breathe",
    reconnecting: "bg-[var(--warning)] animate-breathe",
    signalReconnecting: "bg-[var(--warning)] animate-breathe",
    disconnected: "bg-[var(--danger)]",
};

function isStagePublisher(participant: Participant): boolean {
    return participantMetadata(participant).isAssignedFacilitator ||
        participant.trackPublications.size > 0;
}

function cameraPublication(participant: Participant): StageVideoPublication | null {
    const [publication] = participant.videoTrackPublications.values();
    return publication ?? null;
}

function participantMetadata(participant: Participant): {
    role: string | null;
    isAssignedFacilitator: boolean;
} {
    try {
        const metadata = JSON.parse(participant.metadata || "{}") as {
            role?: unknown;
            isAssignedFacilitator?: unknown;
        };
        return {
            role: typeof metadata.role === "string" ? metadata.role : null,
            isAssignedFacilitator: metadata.isAssignedFacilitator === true,
        };
    } catch {
        return { role: null, isAssignedFacilitator: false };
    }
}

function SessionRoom() {
    const { copy } = useLocale();
    const { id } = useParams<{ id: string }>();
    const searchParams = useSearchParams();
    const router = useRouter();
    const inviteCode = searchParams.get("invite");
    const embeddedInCockpit = searchParams.get("surface") === "cockpit";

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
    const [connectionError, setConnectionError] = useState(false);
    const [canPublish, setCanPublish] = useState(false);
    const [principalKind, setPrincipalKind] = useState<"ticket" | "staff">("ticket");
    const [isMicOn, setIsMicOn] = useState(false);
    const [isCameraOn, setIsCameraOn] = useState(false);
    const [cameraFacingMode, setCameraFacingMode] = useState<CameraFacingMode>("user");
    const [cameraSwitchBusy, setCameraSwitchBusy] = useState(false);
    const [cameraSwitchError, setCameraSwitchError] = useState<string | null>(null);
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
    const [activeRoom, setActiveRoom] = useState<Room | null>(null);
    const [stageInvitationAccepted, setStageInvitationAccepted] = useState(false);
    const [stageInvitationBusy, setStageInvitationBusy] = useState<'accept' | 'decline' | null>(null);
    const [stageInvitationError, setStageInvitationError] = useState<string | null>(null);

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
    const autoReconnectAttemptRef = useRef(0);
    const autoReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const desiredMicRef = useRef(false);
    const desiredCameraRef = useRef(false);
    const deviceOperationRef = useRef<Promise<void> | null>(null);
    const stageInvitationAcceptedRef = useRef(false);
    const terminalViewRef = useRef<HTMLDivElement>(null);
    const stageInvitationRef = useRef<HTMLDivElement>(null);
    const participantFallbackRef = useRef(copy.session.participantFallback);
    participantFallbackRef.current = copy.session.participantFallback;
    stageInvitationAcceptedRef.current = stageInvitationAccepted;

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
                const label = participant.name?.trim() || participantFallbackRef.current;
                return {
                    identity: participant.identity,
                    label,
                    isLocal: participant === local,
                    isFacilitator: participantMetadata(participant).isAssignedFacilitator,
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

    const openStaffConsole = useCallback(async () => {
        const pendingDeviceOperation = deviceOperationRef.current;
        if (pendingDeviceOperation) {
            try {
                await pendingDeviceOperation;
            } catch {
                // The effective device state below remains authoritative.
            }
        }
        const room = roomRef.current;
        try {
            window.sessionStorage.setItem(stageHandoffKey(id), JSON.stringify({
                microphone: room?.localParticipant.isMicrophoneEnabled ?? isMicOn,
                camera: room?.localParticipant.isCameraEnabled ?? isCameraOn,
                audioOnly: audioOnlyRef.current,
                createdAt: Date.now(),
            } satisfies StageHandoff));
        } catch {
            // Navigation still works if storage is unavailable.
        }
        if (room) {
            intentionalDisconnectRef.current = true;
            try {
                await room.disconnect();
            } catch (failure) {
                console.error("Failed to close the room before opening the console:", redactErrorDetail(failure));
            }
        }
        router.push(`/ops/events/${id}`);
    }, [id, isCameraOn, isMicOn, router]);

    const rejoin = useCallback(() => {
        if (autoReconnectTimerRef.current) {
            clearTimeout(autoReconnectTimerRef.current);
            autoReconnectTimerRef.current = null;
        }
        autoReconnectAttemptRef.current = 0;
        setDisconnectState(null);
        setIsConnected(false);
        setIsConnecting(true);
        setConnectionError(false);
        setAudioActivationError(null);
        setRetryToken((t) => t + 1);
    }, []);

    const scheduleAutoReconnect = useCallback(() => {
        if (autoReconnectTimerRef.current) return;

        const attempt = autoReconnectAttemptRef.current;
        if (attempt >= AUTO_RECONNECT_DELAYS_MS.length) {
            setConnectionState("disconnected");
            setDisconnectState("transport");
            return;
        }

        setConnectionState("reconnecting");
        autoReconnectAttemptRef.current = attempt + 1;
        autoReconnectTimerRef.current = setTimeout(() => {
            autoReconnectTimerRef.current = null;
            setRetryToken((token) => token + 1);
        }, AUTO_RECONNECT_DELAYS_MS[attempt]);
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
                    copy.session.beaconAudioError,
                );
            }
        } catch (e) {
            console.error("Failed to start session audio:", redactErrorDetail(e));
            setAudioActivationError(
                copy.session.audioError,
            );
        }
    }, [startBeaconAudio, copy.session.beaconAudioError, copy.session.audioError]);

    const acceptStageInvitation = useCallback(async () => {
        const room = roomRef.current;
        if (!room || principalKind !== 'ticket' || !canPublish || stageInvitationBusy) return;

        setStageInvitationBusy('accept');
        setStageInvitationError(null);
        try {
            // One getUserMedia acquisition is substantially more reliable on
            // mobile Safari/Chrome than racing independent camera and mic calls.
            await room.localParticipant.enableCameraAndMicrophone();
        } catch (failure) {
            console.error("Failed to enable stage devices:", redactErrorDetail(failure));
        }
        if (!room.localParticipant.permissions?.canPublish) {
            setStageInvitationBusy(null);
            return;
        }
        setStageInvitationAccepted(true);
        desiredCameraRef.current = room.localParticipant.isCameraEnabled;
        desiredMicRef.current = room.localParticipant.isMicrophoneEnabled;
        if (!room.localParticipant.isCameraEnabled || !room.localParticipant.isMicrophoneEnabled) {
            setStageInvitationError(
                room.localParticipant.isMicrophoneEnabled
                    ? copy.session.invitationCameraError
                    : room.localParticipant.isCameraEnabled
                        ? copy.session.invitationMicrophoneError
                        : copy.session.invitationDeviceError,
            );
        }
        readStage();
        setStageInvitationBusy(null);
    }, [
        canPublish,
        copy.session.invitationCameraError,
        copy.session.invitationDeviceError,
        copy.session.invitationMicrophoneError,
        principalKind,
        readStage,
        stageInvitationBusy,
    ]);

    const declineStageInvitation = useCallback(async () => {
        if (principalKind !== 'ticket' || !canPublish || stageInvitationBusy) return;

        setStageInvitationBusy('decline');
        setStageInvitationError(null);
        try {
            const response = await fetch(`/api/scheduled-sessions/${id}/hand`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'decline_invitation' }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            setStageInvitationAccepted(false);
            setCanPublish(false);
        } catch (failure) {
            console.error('Failed to decline stage invitation:', redactErrorDetail(failure));
            setStageInvitationError(copy.session.invitationDeclineError);
        } finally {
            setStageInvitationBusy(null);
        }
    }, [canPublish, copy.session.invitationDeclineError, id, principalKind, stageInvitationBusy]);

    // Connect to LiveKit room
    useEffect(() => {
        let cancelled = false;
        let ownedRoom: Room | null = null;
        let presenceTimer: ReturnType<typeof setInterval> | null = null;
        const audioElements = audioElementsRef.current;
        intentionalDisconnectRef.current = false;

        const reportPresence = (state: 'connected' | 'left', reconnect = false) => {
            const body = JSON.stringify({ state, reconnect });
            if (state === 'left' && navigator.sendBeacon?.(
                `/api/scheduled-sessions/${id}/presence`,
                new Blob([body], { type: 'application/json' }),
            )) return;
            void fetch(`/api/scheduled-sessions/${id}/presence`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true,
            }).catch(() => {});
        };

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
                    name: typeof data.displayName === "string" ? data.displayName : participantFallbackRef.current,
                    role: typeof data.role === "string" ? data.role : "PARTICIPANT",
                    identity: typeof data.identity === "string" ? data.identity : "unknown",
                    isAssignedFacilitator: data.isAssignedFacilitator === true,
                });
                const handoff = embeddedInCockpit && data.principalKind === "staff"
                    ? takeStageHandoff(id)
                    : null;
                if (handoff) {
                    desiredCameraRef.current = handoff.camera;
                    desiredMicRef.current = handoff.microphone;
                    audioOnlyRef.current = handoff.audioOnly;
                    setAudioOnly(handoff.audioOnly);
                }
                if (data.session.startedAt) {
                    const elapsed = Math.floor((Date.now() - new Date(data.session.startedAt).getTime()) / 1000);
                    setDuration(Math.max(0, elapsed));
                }

                const room = new Room(stageRoomOptions(data.isAssignedFacilitator === true));
                ownedRoom = room;
                roomRef.current = room;
                setActiveRoom(room);

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
                    const kind = classifyDisconnectReason(reason);
                    if (kind === "transport") {
                        scheduleAutoReconnect();
                        return;
                    }
                    setConnectionState("disconnected");
                    setDisconnectState(kind);
                });

                await room.connect(LIVEKIT_URL, data.token);
                if (cancelled) {
                    room.disconnect();
                    return;
                }

                const wasReconnect = autoReconnectAttemptRef.current > 0;
                setIsConnected(true);
                setIsConnecting(false);
                setDisconnectState(null);
                setConnectionError(false);
                autoReconnectAttemptRef.current = 0;
                reportPresence('connected', wasReconnect);
                presenceTimer = setInterval(() => reportPresence('connected'), 20_000);
                if (autoReconnectTimerRef.current) {
                    clearTimeout(autoReconnectTimerRef.current);
                    autoReconnectTimerRef.current = null;
                }

                const mayRestoreDevices = data.canPublish &&
                    (data.principalKind === "staff" || stageInvitationAcceptedRef.current);
                if (mayRestoreDevices && desiredCameraRef.current && desiredMicRef.current) {
                    try {
                        await room.localParticipant.enableCameraAndMicrophone();
                    } catch (failure) {
                        console.error("Failed to restore stage devices:", redactErrorDetail(failure));
                    }
                } else if (mayRestoreDevices) {
                    try {
                        if (desiredCameraRef.current) {
                            await room.localParticipant.setCameraEnabled(true);
                        }
                        if (desiredMicRef.current) {
                            await room.localParticipant.setMicrophoneEnabled(true);
                        }
                    } catch (failure) {
                        console.error("Failed to restore a stage device:", redactErrorDetail(failure));
                    }
                }
                if (audioOnlyRef.current) applyVideoSubscriptions(false);
                readStage();
            } catch (e) {
                if (!cancelled) {
                    if (autoReconnectAttemptRef.current > 0) {
                        scheduleAutoReconnect();
                    } else {
                        console.error("Failed to connect to the stage room:", redactErrorDetail(e));
                        setConnectionError(true);
                        setIsConnecting(false);
                    }
                }
            }
        }

        connect();

        return () => {
            cancelled = true;
            if (presenceTimer) clearInterval(presenceTimer);
            reportPresence('left');
            if (stageRefreshRef.current) {
                clearTimeout(stageRefreshRef.current);
                stageRefreshRef.current = null;
            }
            if (ownedRoom) {
                intentionalDisconnectRef.current = true;
                ownedRoom.disconnect();
                if (roomRef.current === ownedRoom) {
                    roomRef.current = null;
                    setActiveRoom(null);
                }
            }
            audioElements.forEach((el) => {
                el.pause();
                el.remove();
            });
            audioElements.clear();
        };
    }, [id, inviteCode, embeddedInCockpit, retryToken, readStage, scheduleStageRefresh, applyVideoSubscriptions, scheduleAutoReconnect]);

    useEffect(() => () => {
        if (autoReconnectTimerRef.current) {
            clearTimeout(autoReconnectTimerRef.current);
            autoReconnectTimerRef.current = null;
        }
    }, []);

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
        if (principalKind === 'ticket' && canPublish && !stageInvitationAccepted) {
            stageInvitationRef.current?.focus();
            return;
        }
        if (!canPublish) {
            setStageInvitationAccepted(false);
            setStageInvitationError(null);
        }
    }, [canPublish, principalKind, stageInvitationAccepted]);

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
        const previousOperation = deviceOperationRef.current;
        const operation = (async () => {
            if (previousOperation) {
                try { await previousOperation; } catch { /* Continue with the requested device. */ }
            }
            await room.localParticipant.setMicrophoneEnabled(!isMicOn);
            desiredMicRef.current = room.localParticipant.isMicrophoneEnabled;
            readStage();
        })();
        deviceOperationRef.current = operation;
        try {
            await operation;
        } catch (e) {
            console.error("Failed to toggle microphone:", redactErrorDetail(e));
        } finally {
            if (deviceOperationRef.current === operation) deviceOperationRef.current = null;
        }
    }, [canPublish, isMicOn, readStage]);

    const toggleCamera = useCallback(async () => {
        const room = roomRef.current;
        if (!room || !canPublish) return;
        const previousOperation = deviceOperationRef.current;
        const operation = (async () => {
            if (previousOperation) {
                try { await previousOperation; } catch { /* Continue with the requested device. */ }
            }
            await room.localParticipant.setCameraEnabled(!isCameraOn);
            desiredCameraRef.current = room.localParticipant.isCameraEnabled;
            readStage();
        })();
        deviceOperationRef.current = operation;
        try {
            await operation;
        } catch (e) {
            console.error("Failed to toggle camera:", redactErrorDetail(e));
        } finally {
            if (deviceOperationRef.current === operation) deviceOperationRef.current = null;
        }
    }, [canPublish, isCameraOn, readStage]);

    const switchCamera = useCallback(async () => {
        const room = roomRef.current;
        if (!room || !canPublish || !isCameraOn || cameraSwitchBusy) return;

        const nextFacingMode: CameraFacingMode = cameraFacingMode === "user"
            ? "environment"
            : "user";
        const previousOperation = deviceOperationRef.current;
        setCameraSwitchBusy(true);
        setCameraSwitchError(null);
        const operation = (async () => {
            if (previousOperation) {
                try { await previousOperation; } catch { /* Continue with the requested device. */ }
            }
            const publication = room.localParticipant.getTrackPublication(Track.Source.Camera);
            const videoTrack = publication?.videoTrack;
            if (!videoTrack) throw new Error("No active local camera track");

            // LiveKit replaces the camera sender's MediaStreamTrack in place.
            // The Room, microphone publication and both audio paths remain intact.
            await videoTrack.restartTrack({ facingMode: nextFacingMode });
            const observedFacingMode = videoTrack.mediaStreamTrack.getSettings().facingMode;
            setCameraFacingMode(
                observedFacingMode === "user" || observedFacingMode === "environment"
                    ? observedFacingMode
                    : nextFacingMode,
            );
            desiredCameraRef.current = true;
            readStage();
        })();
        deviceOperationRef.current = operation;
        try {
            await operation;
        } catch (failure) {
            console.error("Failed to switch camera:", redactErrorDetail(failure));
            setCameraSwitchError(copy.session.cameraSwitchError);
        } finally {
            if (deviceOperationRef.current === operation) deviceOperationRef.current = null;
            setCameraSwitchBusy(false);
        }
    }, [
        cameraFacingMode,
        cameraSwitchBusy,
        canPublish,
        copy.session.cameraSwitchError,
        isCameraOn,
        readStage,
    ]);

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
                            {copy.session.connectingHeading}
                        </p>
                        <p className="terminal-state__body">
                            {copy.session.connectingBody}
                        </p>
                    </div>
                </div>
            </main>
        );
    }

    // Error state
    if (connectionError) {
        return (
            <main className="event-shell">
                <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
                    <div className="event-card w-full max-w-sm text-center">
                        <div className="terminal-state__icon text-[var(--danger)]">&#9888;</div>
                        <h2 className="terminal-state__title">{copy.session.connectionErrorHeading}</h2>
                        <p className="terminal-state__body">{copy.session.connectionUnavailable}</p>
                        <div className="mt-4 flex flex-col gap-2">
                            <button onClick={rejoin} className="event-button event-button--primary w-full">
                                {copy.session.tryAgain}
                            </button>
                            <button onClick={() => router.push("/")} className="event-button event-button--secondary w-full">
                                {copy.session.backToSessions}
                            </button>
                        </div>
                    </div>
                </div>
            </main>
        );
    }

    // Terminal state
    if (disconnectState) {
        const terminalCopy = {
            ended: {
                heading: copy.session.endedHeading,
                body: copy.session.endedBody,
                showRejoin: false,
            },
            transport: {
                heading: copy.session.connectionLostHeading,
                body: copy.session.connectionLostBody,
                showRejoin: true,
            },
            duplicate: {
                heading: copy.session.duplicateIdentityHeading,
                body: copy.session.duplicateIdentityBody,
                showRejoin: true,
            },
            unknown: {
                heading: copy.session.disconnectedHeading,
                body: copy.session.disconnectedBody,
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
                        <h2 className="terminal-state__title">{terminalCopy.heading}</h2>
                        <p className="terminal-state__body">{terminalCopy.body}</p>
                        <div className="mt-4 flex flex-col gap-2">
                            {terminalCopy.showRejoin && (
                                <button onClick={rejoin} className="event-button event-button--primary w-full">
                                    {copy.session.rejoin}
                                </button>
                            )}
                            <button onClick={() => router.push("/")} className="event-button event-button--secondary w-full">
                                {copy.session.backToSessions}
                            </button>
                        </div>
                    </div>
                </div>
            </main>
        );
    }

    const connectionKey = connectionState === "signalReconnecting" ? "reconnecting" : connectionState;
    const connectionLabel = copy.session.connection[connectionKey as keyof typeof copy.session.connection]
        ?? copy.session.connection.connecting;
    const canControlStageDevices = canPublish &&
        (principalKind === 'staff' || stageInvitationAccepted);
    const hasPendingStageInvitation = principalKind === 'ticket' &&
        canPublish && !stageInvitationAccepted;
    const needsDeviceGesture = canControlStageDevices && !isMicOn && !isCameraOn;
    const viewerStaffRole = principalKind === 'staff' && isLocalizedStaffRole(viewerInfo?.role)
        ? staffRolePresentation(copy, viewerInfo.role)
        : null;

    return (
        <main className="event-shell">
            <div className="relative z-10 flex min-h-screen flex-col">
                {/* Header */}
                <header className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
                    <div className="min-w-0 flex-1">
                        <h1 className="break-words text-sm font-semibold leading-5 text-[var(--cream)]">
                            {sessionInfo?.title || copy.session.sessionFallback}
                        </h1>
                        <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]" aria-live="polite">
                            {copy.session.peopleInRoom}: <strong className="font-mono text-[var(--cream)]">{participantCount}</strong>
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
                            <p className="mt-1 break-words text-xs leading-5 text-[var(--gold)]" data-testid="viewer-identity">
                                {copy.session.signedIn}: <strong>{viewerInfo.name}</strong>
                                {viewerStaffRole ? <>{' · '}{viewerStaffRole.label}</> : null}
                            </p>
                        )}
                        {viewerInfo ? (
                            <p className="mt-0.5 max-w-2xl break-words text-xs leading-5 text-[var(--text-muted)]" data-testid="viewer-role-guidance">
                                {principalKind === 'ticket'
                                    ? copy.session.attendeeCapability
                                    : viewerInfo.isAssignedFacilitator
                                        ? copy.session.assignedFacilitatorCapability
                                        : copy.session.operationalStaffCapability}
                            </p>
                        ) : null}
                    </div>
                    <div className="ml-3 flex shrink-0 items-center gap-3">
                        {principalKind === "staff" && !embeddedInCockpit && (
                            <button
                                type="button"
                                onClick={() => void openStaffConsole()}
                                className="inline-flex min-h-11 items-center rounded border border-[var(--gold)]/40 px-3 py-2 text-xs text-[var(--gold)] hover:bg-[var(--gold)]/10"
                            >
                                {copy.session.staffConsole}
                            </button>
                        )}
                        <span className="font-mono text-xs text-[var(--gold)]">{formatTime(duration)}</span>
                    </div>
                </header>

                {principalKind === 'staff' ? (
                    <div className="flex justify-center px-3 pt-3 sm:px-4">
                        <FacilitatorAudioQuality
                            key={`${viewerInfo?.identity ?? 'staff'}:${retryToken}`}
                            room={activeRoom}
                            isStaff
                            isAssignedFacilitator={viewerInfo?.isAssignedFacilitator === true}
                        />
                    </div>
                ) : null}

                {/* Stage + contributions panel (side on desktop, below on mobile) */}
                <div className="flex flex-1 flex-col lg:flex-row">
                <div className="flex flex-1 flex-col items-center justify-center gap-5 px-3 py-4 sm:px-4">
                    <StageLayout
                        publishers={stagePublishers}
                        activeSpeakerIdentity={activeSpeakerIdentity}
                        audioOnly={audioOnly}
                    />

                    {!isBeaconPlaying && (
                        <div className="event-card w-full max-w-md text-center" role="group" aria-label={copy.session.audioActivationLabel}>
                            <p className="mb-3 text-sm text-[var(--text-secondary)]">
                                {copy.session.audioPrompt}
                            </p>
                            <button onClick={startListening} className="event-button event-button--primary w-full">
                                {copy.session.startAudio}
                            </button>
                            {(audioActivationError || beaconAudioError) && (
                                <p className="mt-3 text-sm text-[var(--danger)]" role="alert">
                                    {audioActivationError || beaconAudioError}
                                </p>
                            )}
                        </div>
                    )}

                    {hasPendingStageInvitation && (
                        <div
                            ref={stageInvitationRef}
                            tabIndex={-1}
                            role="dialog"
                            aria-labelledby="stage-invitation-title"
                            aria-describedby="stage-invitation-body"
                            className="event-card w-full max-w-md text-center outline-none focus-visible:ring-2 focus-visible:ring-[var(--cyan)]"
                        >
                            <p className="text-xs font-mono uppercase tracking-[0.12em] text-[var(--gold)]">
                                {sessionInfo?.title}
                            </p>
                            <h2 id="stage-invitation-title" className="mt-2 font-serif text-2xl text-[var(--paper)]">
                                {copy.session.invitationHeading}
                            </h2>
                            <p id="stage-invitation-body" className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                                {copy.session.invitationBody}
                            </p>
                            <div className="mt-5 grid gap-2 sm:grid-cols-2">
                                <button
                                    type="button"
                                    className="event-button event-button--primary w-full"
                                    onClick={() => void acceptStageInvitation()}
                                    disabled={stageInvitationBusy !== null}
                                >
                                    {stageInvitationBusy === 'accept'
                                        ? copy.session.acceptingInvitation
                                        : copy.session.acceptInvitation}
                                </button>
                                <button
                                    type="button"
                                    className="event-button event-button--secondary w-full"
                                    onClick={() => void declineStageInvitation()}
                                    disabled={stageInvitationBusy !== null}
                                >
                                    {stageInvitationBusy === 'decline'
                                        ? copy.session.decliningInvitation
                                        : copy.session.declineInvitation}
                                </button>
                            </div>
                            {stageInvitationError ? (
                                <p className="mt-3 text-sm text-[var(--danger)]" role="alert">
                                    {stageInvitationError}
                                </p>
                            ) : null}
                        </div>
                    )}

                    {needsDeviceGesture && (
                        <p className="text-center text-sm text-[var(--lime)]">
                            {copy.session.yourTurn}
                        </p>
                    )}
                    {stageInvitationAccepted && stageInvitationError ? (
                        <p className="max-w-md text-center text-sm text-[var(--danger)]" role="alert">
                            {stageInvitationError}
                        </p>
                    ) : null}

                    <ThumbnailSender
                        sessionId={id}
                        connected={isConnected}
                        isPublishing={canControlStageDevices}
                    />

                    <ThumbnailTapestry sessionId={id} />

                    {/* Listening guidance: a quiet disclosure above the
                        controls it explains. Presentational only — opening it
                        never remounts the Room or touches audio state. */}
                    <SessionGuidance copy={copy.session.guidance} className="w-full max-w-sm" />

                    {/* Volume + Mix controls */}
                    <div className="w-full max-w-sm space-y-5">
                        <div>
                            <label htmlFor="room-master-volume" className="mb-2 flex items-center justify-between gap-3 text-sm text-[var(--cream)]">
                                <span>{copy.session.masterVolume}</span>
                                <span className="font-mono text-xs text-[var(--gold)]">{Math.round(volume * 100)}%</span>
                            </label>
                            <div className="crossfader">
                            <svg className="h-4 w-4 shrink-0 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z" />
                            </svg>
                            <input
                                id="room-master-volume"
                                type="range"
                                min="0"
                                max="1"
                                step="0.01"
                                value={volume}
                                onChange={(e) => setVolume(parseFloat(e.target.value))}
                                className="flex-1 accent-[var(--gold)]"
                                aria-label={copy.session.masterVolume}
                            />
                            </div>
                        </div>
                        <div>
                            <label htmlFor="room-audio-balance" className="mb-2 block text-sm text-[var(--cream)]">
                                {copy.session.mix}
                            </label>
                            <div className="flex items-center gap-2">
                                <span className="w-14 text-right font-mono text-xs text-[var(--gold)]">Beacon</span>
                                <input
                                    id="room-audio-balance"
                                    type="range"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={mix}
                                    onChange={(e) => setMix(parseFloat(e.target.value))}
                                    className="flex-1 accent-[var(--cyan)]"
                                    aria-label={copy.session.mix}
                                />
                                <span className="w-14 font-mono text-xs text-[var(--cyan)]">{copy.session.sessionChannel}</span>
                            </div>
                        </div>
                    </div>
                </div>
                {principalKind === 'ticket' && (
                    <SessionContributions key={id} sessionId={id} />
                )}
                </div>

                {principalKind === 'staff' && (
                    <div className="mx-auto mb-3 max-w-md rounded border border-[var(--border-subtle)] bg-[var(--surface-alt)] px-3 py-2 text-center text-xs leading-5 text-[var(--text-muted)]">
                        {copy.session.beaconRoom}: {beaconConnected ? <span className="text-[var(--lime)]">{copy.session.connection.connected}</span> : <span className="text-[var(--danger)]">{copy.session.connection.disconnected}</span>}
                        {' · '}{copy.session.playlist}: {hasPlaylistStream ? <span className="text-[var(--lime)]">{copy.session.active}</span> : <span className="text-[var(--danger)]">{copy.session.none}</span>}
                        {' · '}{copy.session.live}: {hasLiveStream ? <span className="text-[var(--lime)]">{copy.session.active}</span> : <span className="text-[var(--danger)]">{copy.session.none}</span>}
                        {beaconAudioError ? <>{' · '}<span className="text-[var(--danger)]">{copy.session.error}: {beaconAudioError}</span></> : null}
                    </div>
                )}

                {/* Bottom controls */}
                <div className="border-t border-[var(--border-subtle)] px-4 py-4">
                    {isConnected && principalKind === "ticket" && (
                        <div className="mb-4 flex justify-center">
                            <HandRaiseButton
                                sessionId={id}
                                onPublishGrantChange={setCanPublish}
                                stageInvitationAccepted={stageInvitationAccepted}
                            />
                        </div>
                    )}
                    <div className="flex flex-wrap items-start justify-center gap-x-4 gap-y-3">
                        {canControlStageDevices && (
                            <div className="flex flex-col items-center gap-1">
                                <button
                                    onClick={toggleMic}
                                    className={`flex h-14 w-14 items-center justify-center rounded-full transition-all ${
                                        isMicOn
                                            ? "bg-[var(--cyan)] text-[var(--ink)]"
                                            : "bg-white/10 text-[var(--text-muted)] hover:bg-white/20"
                                    }`}
                                    aria-label={isMicOn ? copy.session.muteMicrophone : copy.session.unmuteMicrophone}
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
                                <span className="text-xs text-[var(--text-secondary)]">{copy.session.mic}</span>
                            </div>
                        )}

                        {canControlStageDevices && isCameraOn && (
                            <div className="flex flex-col items-center gap-1">
                                <button
                                    type="button"
                                    onClick={() => void switchCamera()}
                                    disabled={cameraSwitchBusy}
                                    className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-[var(--cream)] transition-all hover:bg-white/20 disabled:cursor-wait disabled:opacity-60"
                                    aria-label={cameraFacingMode === "user"
                                        ? copy.session.switchToRearCamera
                                        : copy.session.switchToFrontCamera}
                                >
                                    <svg className={`h-6 w-6 ${cameraSwitchBusy ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M20 7h-4V3M4 17h4v4m11.5-9a7.5 7.5 0 00-12.8-5.3L4 9m16 6-2.7 2.3A7.5 7.5 0 014.5 12" />
                                    </svg>
                                </button>
                                <span className="text-xs text-[var(--text-secondary)]">
                                    {cameraSwitchBusy
                                        ? copy.session.switchingCamera
                                        : cameraFacingMode === "user"
                                            ? copy.session.frontCamera
                                            : copy.session.rearCamera}
                                </span>
                            </div>
                        )}

                        {canControlStageDevices && (
                            <div className="flex flex-col items-center gap-1">
                                <button
                                    onClick={toggleCamera}
                                    className={`flex h-14 w-14 items-center justify-center rounded-full transition-all ${
                                        isCameraOn
                                            ? "bg-[var(--cyan)] text-[var(--ink)]"
                                            : "bg-white/10 text-[var(--text-muted)] hover:bg-white/20"
                                    }`}
                                    aria-label={isCameraOn ? copy.session.turnCameraOff : copy.session.turnCameraOn}
                                    aria-pressed={isCameraOn}
                                >
                                    <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        {!isCameraOn && <line x1="3" y1="3" x2="21" y2="21" strokeLinecap="round" />}
                                    </svg>
                                </button>
                                <span className="text-xs text-[var(--text-secondary)]">{copy.session.camera}</span>
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
                                aria-label={audioOnly ? copy.session.turnVideoOn : copy.session.switchToAudioOnly}
                                aria-pressed={audioOnly}
                            >
                                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l7-3v13M9 19a3 3 0 11-6 0 3 3 0 016 0zm7-3a3 3 0 11-6 0 3 3 0 016 0z" />
                                </svg>
                            </button>
                            <span className="text-xs text-[var(--text-secondary)]">{copy.session.audioOnly}</span>
                        </div>

                        <div className="flex flex-col items-center gap-1">
                            <button
                                onClick={leaveSession}
                                className="flex h-14 w-14 items-center justify-center rounded-full bg-white/10 text-[var(--text-muted)] transition-all hover:bg-white/20"
                                aria-label={copy.session.leaveSession}
                            >
                                <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                            </button>
                            <span className="text-xs text-[var(--text-secondary)]">{copy.session.leave}</span>
                        </div>
                    </div>
                    {cameraSwitchError && (
                        <p className="mx-auto mt-3 max-w-md text-center text-sm text-[var(--danger)]" role="alert">
                            {cameraSwitchError}
                        </p>
                    )}
                </div>
            </div>
        </main>
    );
}

export default function SessionRoomPage() {
    const { id } = useParams<{ id: string }>();

    return <SessionEntryGate sessionId={id} />;
}

type EntryState = 'WAITING' | 'READY' | 'ENDED' | 'CANCELLED';

type EntrySession = {
    id: string;
    title: string;
    language: 'ENGLISH' | 'SPANISH';
    scheduledAt: string;
    status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
};

type EntryResponse = {
    state: EntryState;
    session: EntrySession;
};

const ENTRY_POLL_MS = 3_000;

function SessionEntryGate({ sessionId }: { sessionId: string }) {
    const router = useRouter();
    const { locale, copy, seedLocale } = useLocale();
    const [entry, setEntry] = useState<EntryResponse | null>(null);
    const [entryError, setEntryError] = useState<string | null>(null);
    const [retryEntry, setRetryEntry] = useState(0);

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        let inFlight = false;

        const checkEntry = async () => {
            if (cancelled || inFlight) return;
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }
            inFlight = true;
            try {
                const response = await fetch(`/api/scheduled-sessions/${sessionId}/entry`, {
                    cache: 'no-store',
                });
                const data = await response.json().catch(() => ({})) as Partial<EntryResponse> & { error?: string };
                if (!response.ok || !data.state || !data.session) {
                    throw new Error(data.error || `Entry status unavailable (HTTP ${response.status})`);
                }
                if (!cancelled) {
                    seedLocale(localeForEventLanguage(data.session.language));
                    setEntry(data as EntryResponse);
                    setEntryError(null);
                }
            } catch (failure) {
                if (!cancelled) {
                    console.error('Failed to confirm event entry:', redactErrorDetail(failure));
                    setEntryError(copy.session.entryUnavailable);
                }
            } finally {
                inFlight = false;
                if (!cancelled) timer = setTimeout(checkEntry, ENTRY_POLL_MS);
            }
        };

        const checkWhenVisible = () => {
            if (document.visibilityState === 'visible') void checkEntry();
        };
        void checkEntry();
        window.addEventListener('focus', checkWhenVisible);
        window.addEventListener('online', checkWhenVisible);
        document.addEventListener('visibilitychange', checkWhenVisible);
        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
            window.removeEventListener('focus', checkWhenVisible);
            window.removeEventListener('online', checkWhenVisible);
            document.removeEventListener('visibilitychange', checkWhenVisible);
        };
    }, [sessionId, retryEntry, seedLocale, copy.session.entryUnavailable]);

    if (!entry) {
        return (
            <main className="event-shell">
                <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
                    <div className="terminal-state">
                        <div className="terminal-state__icon">&#10022;</div>
                        <h1 className="terminal-state__title">{copy.session.preparingRoom}</h1>
                        <p className="terminal-state__body">
                            {entryError || copy.session.confirmingEntry}
                        </p>
                        {entryError ? (
                            <button
                                type="button"
                                onClick={() => setRetryEntry((value) => value + 1)}
                                className="event-button event-button--primary mt-4"
                            >
                                {copy.session.tryAgain}
                            </button>
                        ) : null}
                    </div>
                </div>
            </main>
        );
    }

    if (entry.state === 'WAITING') {
        const startsAt = new Intl.DateTimeFormat(locale === 'es' ? 'es-AR' : 'en-US', {
            dateStyle: 'full',
            timeStyle: 'short',
        }).format(new Date(entry.session.scheduledAt));
        return (
            <main className="event-shell">
                <div className="relative z-10 flex min-h-screen flex-col items-center justify-center gap-4 px-4 py-8">
                    <section role="status" aria-live="polite" className="event-card w-full max-w-md text-center">
                        <div className="terminal-state__icon text-[var(--lime)]">&#10022;</div>
                        <p className="font-mono text-xs uppercase tracking-[0.12em] text-[var(--lime)]">
                            {copy.session.ticketConfirmed}
                        </p>
                        <h1 className="terminal-state__title mt-2">{entry.session.title}</h1>
                        <p className="terminal-state__body mt-2">
                            {copy.session.doorsClosed}
                        </p>
                        <p className="mt-4 text-sm font-medium text-[var(--gold)]">{startsAt}</p>
                        {entryError ? (
                            <p className="mt-4 text-xs text-[var(--warning)]">
                                {copy.session.doorsReconnecting}
                            </p>
                        ) : (
                            <p className="mt-4 text-xs text-[var(--text-muted)]">
                                {copy.session.doorsChecking}
                            </p>
                        )}
                    </section>
                    {/* Guidance waits outside the live region: the disclosure
                        toggling must not be announced as a door-state change. */}
                    <SessionGuidance copy={copy.session.guidance} className="w-full max-w-md" />
                </div>
            </main>
        );
    }

    if (entry.state === 'ENDED' || entry.state === 'CANCELLED') {
        const cancelled = entry.state === 'CANCELLED';
        return (
            <main className="event-shell">
                <div className="relative z-10 flex min-h-screen items-center justify-center px-4">
                    <section role="status" aria-live="polite" className="event-card w-full max-w-sm text-center">
                        <div className="terminal-state__icon">&#10022;</div>
                        <h1 className="terminal-state__title">
                            {cancelled ? copy.session.cancelledHeading : copy.session.endedHeading}
                        </h1>
                        <p className="terminal-state__body">
                            {cancelled ? copy.session.cancelledBody : copy.session.closingBody}
                        </p>
                        <button
                            type="button"
                            onClick={() => router.push('/')}
                            className="event-button event-button--secondary mt-4 w-full"
                        >
                            {copy.session.backToSessions}
                        </button>
                    </section>
                </div>
            </main>
        );
    }

    return (
        <AudioProvider sessionId={sessionId}>
            <SessionRoom />
        </AudioProvider>
    );
}
