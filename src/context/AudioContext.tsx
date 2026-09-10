"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import {
    Room,
    RoomEvent,
    Track,
    RemoteTrack,
    RemoteParticipant,
    RemoteTrackPublication,
    type Participant,
    type TrackPublication,
} from 'livekit-client';
import { committedRoomLifecycle, disconnectRoomOnce } from '@/components/navigation/committed-room-lifecycle';
import { redactErrorDetail } from '@/lib/redact';
import { observeRoomAudioPlayback } from '@/lib/room-audio-playback';

// Participant identity for the live USB audio source
const BEACON_IDENTITY = "beacon01";
// The playlist is not interactive audio. A larger receiver buffer prevents
// Chrome from audibly stretching/compressing music to chase WebRTC's default
// low-latency target. Apply it before attach/play so the buffer fills silently.
const PLAYLIST_JITTER_BUFFER_MS = 500;

interface AudioContextType {
    // LiveKit / Beacon Audio
    isConnected: boolean;
    hasLiveStream: boolean;
    hasPlaylistStream: boolean;
    isPlaying: boolean;
    audioError: string | null;
    volume: number;
    startAudio: () => Promise<boolean>;
    togglePlay: () => void;
    setVolume: (v: number) => void;
    mixValue: number;
    setMixValue: (v: number) => void;

    // Meditation Audio
    loadMeditation: (audioFile: string) => Promise<void>;
    unloadMeditation: () => void;
    meditationIsPlaying: boolean;
    meditationVolume: number;
    setMeditationVolume: (v: number) => void;
    toggleMeditation: () => void;
    meditationPosition: number;
    meditationDuration: number;
    seekMeditation: (time: number) => void;
    currentMeditationFile: string | null;

}

const unavailableAudioContext: AudioContextType = {
    isConnected: false,
    hasLiveStream: false,
    hasPlaylistStream: false,
    isPlaying: false,
    audioError: null,
    volume: 0,
    startAudio: async () => false,
    togglePlay: () => {},
    setVolume: () => {},
    mixValue: 0.5,
    setMixValue: () => {},
    loadMeditation: async () => {},
    unloadMeditation: () => {},
    meditationIsPlaying: false,
    meditationVolume: 0,
    setMeditationVolume: () => {},
    toggleMeditation: () => {},
    meditationPosition: 0,
    meditationDuration: 0,
    seekMeditation: () => {},
    currentMeditationFile: null,
};

const AudioContext = createContext<AudioContextType>(unavailableAudioContext);

export function useAudio() {
    return useContext(AudioContext);
}

export function AudioProvider({
    children,
    sessionId,
}: {
    children: React.ReactNode;
    sessionId: string;
}) {
    // LiveKit / Beacon state
    const [isConnected, setIsConnected] = useState(false);
    const [hasLiveStream, setHasLiveStream] = useState(false);
    const [hasPlaylistStream, setHasPlaylistStream] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioError, setAudioError] = useState<string | null>(null);
    const [volume, setVolumeState] = useState(0.5);
    const [mixValue, setMixValueState] = useState(0.5);

    // Meditation state
    const [meditationIsPlaying, setMeditationIsPlaying] = useState(false);
    const [meditationVolume, setMeditationVolumeState] = useState(1.0);
    const [meditationPosition, setMeditationPosition] = useState(0);
    const [meditationDuration, setMeditationDuration] = useState(0);
    const [currentMeditationFile, setCurrentMeditationFile] = useState<string | null>(null);

    const [pageGeneration, setPageGeneration] = useState(0);
    const roomRef = useRef<Room | null>(null);
    const activationRef = useRef<{ room: Room; promise: Promise<boolean> } | null>(null);
    const connectRef = useRef<(() => Promise<boolean>) | null>(null);
    const playbackRef = useRef<ReturnType<typeof observeRoomAudioPlayback> | null>(null);
    // Own exactly one DOM element per subscribed track. LiveKit may clear an
    // element's srcObject before TrackUnsubscribed and then return no elements
    // from detach(), so the application must retain and remove its own node.
    const audioElementsRef = useRef<Map<RemoteTrack, {
        element: HTMLAudioElement;
        identity: string;
        publication: RemoteTrackPublication;
    }>>(new Map());
    const meditationAudioRef = useRef<HTMLAudioElement | null>(null);

    // Refs for values accessed in callbacks (to avoid reconnection loops)
    // Playback intent survives a blocked/new track; readiness is observed separately.
    const isPlayingRef = useRef(false);
    const volumeRef = useRef(volume);
    const hasLiveStreamRef = useRef(hasLiveStream);

    // Keep refs in sync with state
    useEffect(() => { volumeRef.current = volume; }, [volume]);
    useEffect(() => { hasLiveStreamRef.current = hasLiveStream; }, [hasLiveStream]);

    const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://live.altermundi.net";

    // Initialize LiveKit connection - runs once on mount
    useEffect(() => {
        let cancelled = false;
        const room = new Room({ disconnectOnPageLeave: false });
        let connected = false;
        let connecting: Promise<boolean> | null = null;
        setIsConnected(false);
        setIsPlaying(false);
        setAudioError(null);
        const audioElements = audioElementsRef.current;
        roomRef.current = room;

        const playback = observeRoomAudioPlayback(room, (enabled) => {
            setIsPlaying(enabled);
            if (enabled) {
                isPlayingRef.current = true;
                setAudioError(null);
            }
        });
        playbackRef.current = playback;

        const removeTrackedAudio = (track: RemoteTrack) => {
            const tracked = audioElementsRef.current.get(track);
            track.detach().forEach((element) => element.remove());
            if (tracked) {
                playback.remove(tracked.element);
                tracked.element.pause();
                tracked.element.remove();
                audioElementsRef.current.delete(track);
            }
        };

        const syncSourceAvailability = () => {
            const entries = [...audioElementsRef.current.values()];
            const liveAvailable = entries.some(
                (entry) => entry.identity === BEACON_IDENTITY && entry.publication.isMuted !== true,
            );
            const playlistAvailable = entries.some(
                (entry) => entry.identity !== BEACON_IDENTITY,
            );
            hasLiveStreamRef.current = liveAvailable;
            setHasLiveStream(liveAvailable);
            setHasPlaylistStream(playlistAvailable);
            entries.forEach((entry) => {
                if (entry.identity !== BEACON_IDENTITY) {
                    entry.element.muted = liveAvailable;
                }
            });
        };

        room.on(RoomEvent.TrackSubscribed, async (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (track.kind === Track.Kind.Audio) {
                if (cancelled) {
                    track.detach().forEach((element) => element.remove());
                    return;
                }
                const identity = participant.identity;
                const isLive = identity === BEACON_IDENTITY;

                console.log(`✓ Subscribed to ${isLive ? 'LIVE' : 'playlist'} audio track (${identity})`);

                // A republished source can arrive before the old unsubscribe.
                // Retire any prior track from this identity without allowing a
                // stale unsubscribe to remove the replacement later.
                for (const [previousTrack, entry] of audioElementsRef.current) {
                    if (previousTrack === track || entry.identity === identity) {
                        removeTrackedAudio(previousTrack);
                    }
                }

                if (!isLive && track.receiver && 'jitterBufferTarget' in track.receiver) {
                    try {
                        track.receiver.jitterBufferTarget = PLAYLIST_JITTER_BUFFER_MS;
                    } catch {
                        // Experimental browser control: unsupported engines keep
                        // their native jitter-buffer policy.
                    }
                }
                const audioElement = track.attach() as HTMLAudioElement;
                audioElement.volume = volumeRef.current;
                audioElement.style.display = "none";
                document.body.appendChild(audioElement);

                audioElementsRef.current.set(track, { element: audioElement, identity, publication });
                syncSourceAvailability();
                playback.add(audioElement);
                if (process.env.NEXT_PUBLIC_E2E_CONTINUITY_OBSERVER === '1') {
                    try {
                        (window as typeof window & {
                            continuityTrackSubscribed?: (nativeTrack: MediaStreamTrack, participantSid: string, trackSid: string) => void;
                        }).continuityTrackSubscribed?.(track.mediaStreamTrack, participant.sid, publication.trackSid);
                    } catch { /* Test instrumentation must never affect playback. */ }
                }

                // Tracks can arrive after the user has already unlocked audio.
                // Start them immediately without rebuilding the SDK attachment.
                if (isPlayingRef.current) {
                    try {
                        await audioElement.play();
                    } catch {
                        if (cancelled || audioElements.get(track)?.element !== audioElement) return;
                        setAudioError("Audio was blocked. Press Start audio again.");
                    }
                }
                if (!cancelled) playback.sync();
            }
        });

        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, _publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (track.kind === Track.Kind.Audio) {
                const identity = participant.identity;
                const isLive = identity === BEACON_IDENTITY;

                console.log(`✗ ${isLive ? 'LIVE' : 'Playlist'} audio track removed (${identity})`);

                removeTrackedAudio(track);
                syncSourceAvailability();
            }
        });

        const handleTrackMuteChanged = (_publication: TrackPublication, participant: Participant) => {
            if (participant.identity === BEACON_IDENTITY) syncSourceAvailability();
        };
        room.on(RoomEvent.TrackMuted, handleTrackMuteChanged);
        room.on(RoomEvent.TrackUnmuted, handleTrackMuteChanged);

        room.on(RoomEvent.Disconnected, () => {
            if (cancelled) return;
            console.log("Disconnected from LiveKit room");
            connected = false;
            setIsConnected(false);
            setHasLiveStream(false);
            setHasPlaylistStream(false);
        });

        async function connect(): Promise<boolean> {
            try {
                const res = await fetch(`/api/livekit/token?sessionId=${encodeURIComponent(sessionId)}`);
                // The endpoint requires a session. Without this check a 401 body
                // has no `token`, and the failure surfaces as an opaque connect
                // error against an undefined token rather than as "not signed in".
                if (!res.ok) {
                    throw new Error(`token request failed: ${res.status}`);
                }
                const { token } = await res.json();
                if (cancelled) return false;

                await room.connect(LIVEKIT_URL, token);
                if (cancelled) {
                    disconnectRoomOnce(room);
                    return false;
                }

                connected = true;
                console.log("✓ Connected to LiveKit room");
                setIsConnected(true);
                setAudioError(null);
                playback.sync();
                return true;
            } catch (err) {
                if (cancelled) return false;
                console.error("Failed to connect to LiveKit:", redactErrorDetail(err));
                setAudioError("Beacon audio could not connect. Check your connection and try again.");
                return false;
            }
        }

        const ensureConnected = () => {
            // The SDK owns transport recovery after a successful connection.
            // Starting a second connect here would reset its in-flight engine.
            if (connected && room.state !== 'disconnected') {
                return Promise.resolve(room.state === 'connected');
            }
            if (!connecting) {
                connecting = connect().finally(() => { connecting = null; });
            }
            return connecting;
        };
        connectRef.current = ensureConnected;
        void ensureConnected();

        return committedRoomLifecycle(() => {
            if (cancelled) return;
            cancelled = true;
            if (connectRef.current === ensureConnected) connectRef.current = null;
            playback.dispose();
            if (playbackRef.current === playback) playbackRef.current = null;
            setIsConnected(false);
            setIsPlaying(false);
            isPlayingRef.current = false;
            setHasLiveStream(false);
            hasLiveStreamRef.current = false;
            setHasPlaylistStream(false);
            disconnectRoomOnce(room);
            if (roomRef.current === room) roomRef.current = null;
            audioElements.forEach(({ element }) => {
                element.pause();
                element.remove();
            });
            audioElements.clear();
        }, () => setPageGeneration(value => value + 1));
    }, [LIVEKIT_URL, sessionId, pageGeneration]);

    // When beacon goes live, mute playlist audio; unmute when beacon goes offline
    useEffect(() => {
        audioElementsRef.current.forEach(({ element, identity }) => {
            if (identity !== BEACON_IDENTITY) {
                element.muted = hasLiveStream;
            }
        });
    }, [hasLiveStream]);

    // Update volumes when changed
    useEffect(() => {
        audioElementsRef.current.forEach(({ element }) => {
            element.volume = volume;
        });
    }, [volume]);

    useEffect(() => {
        if (meditationAudioRef.current) {
            meditationAudioRef.current.volume = meditationVolume;
        }
    }, [meditationVolume]);

    /** Browser audio policies require this to run directly from a click. */
    const startAudio = useCallback((): Promise<boolean> => {
        const room = roomRef.current;
        const playback = playbackRef.current;
        if (!room) return Promise.resolve(false);
        if (activationRef.current?.room === room) return activationRef.current.promise;
        isPlayingRef.current = true;
        const promise = (async () => {
            const muted = new Map([...audioElementsRef.current.values()].map(
                ({ element }) => [element, element.muted],
            ));
            // Invoke native playback before either room resumes its AudioContext.
            // Async wrappers isolate synchronous throws without delaying invocation.
            const elementStarts = [...audioElementsRef.current.values()].map(
                async ({ element }) => element.play(),
            );
            const roomStart = (async () => room.startAudio())();
            // LiveKit unmutes synchronously. Restore source priority before yielding.
            audioElementsRef.current.forEach(({ element, identity }) => {
                element.muted = (muted.get(element) ?? element.muted) ||
                    (identity !== BEACON_IDENTITY && hasLiveStreamRef.current);
            });
            // Invoke SDK playback in the gesture even if token/connection recovery
            // needs network I/O; connecting first would lose browser activation.
            const connection = connectRef.current?.() ?? Promise.resolve(false);
            const results = await Promise.allSettled([roomStart, ...elementStarts, connection]);
            const connected = await connection;
            if (roomRef.current !== room) return false;
            // Effective playback wins over a stale rejection if automatic recovery
            // (or source replacement) succeeded while this attempt was pending.
            if (!connected) return false;
            if (playback?.sync()) {
                setAudioError(null);
                return true;
            }
            const failure = results.find((result) => result.status === 'rejected');
            console.error("Failed to start Beacon audio:", redactErrorDetail(
                failure?.status === 'rejected' ? failure.reason : new Error('Playback is still blocked'),
            ));
            setAudioError("Audio could not start. Check that this tab is not muted, then try again.");
            return false;
        })();
        activationRef.current = { room, promise };
        void promise.finally(() => {
            if (activationRef.current?.promise === promise) activationRef.current = null;
        });
        return promise;
    }, []);

    const togglePlay = useCallback(() => {
        if (isPlaying) {
            audioElementsRef.current.forEach(({ element }) => element.pause());
            isPlayingRef.current = false;
            setIsPlaying(false);
            return;
        }
        void startAudio();
    }, [isPlaying, startAudio]);

    const setVolume = useCallback((v: number) => {
        setVolumeState(v);
    }, []);

    const setMixValue = useCallback((v: number) => {
        setMixValueState(v);
        // Apply mix logic immediately
        if (v <= 0.5) {
            const beaconVol = 1.0 - (v * 0.3);
            const medVol = v * 2;
            setVolumeState(beaconVol);
            setMeditationVolumeState(medVol);
        } else {
            const beaconVol = (1 - v) * 1.7;
            setMeditationVolumeState(1.0);
            setVolumeState(beaconVol);
        }
    }, []);

    // Meditation controls
    const loadMeditation = useCallback(async (audioFile: string) => {
        // Unload previous meditation
        if (meditationAudioRef.current) {
            meditationAudioRef.current.pause();
            meditationAudioRef.current = null;
        }

        const audio = new Audio(audioFile);
        meditationAudioRef.current = audio;
        setCurrentMeditationFile(audioFile);

        audio.addEventListener('loadedmetadata', () => {
            setMeditationDuration(audio.duration * 1000); // Convert to ms
        });

        audio.addEventListener('timeupdate', () => {
            setMeditationPosition(audio.currentTime * 1000); // Convert to ms
        });

        audio.addEventListener('ended', () => {
            setMeditationIsPlaying(false);
            setMeditationPosition(0);
        });

        audio.volume = meditationVolume;

        try {
            await audio.play();
            setMeditationIsPlaying(true);

            // Start beacon in background if not already playing
            if (!isPlaying) {
                togglePlay();
            }
        } catch (err) {
            console.error("Failed to play meditation:", redactErrorDetail(err));
        }
    }, [meditationVolume, isPlaying, togglePlay]);

    const unloadMeditation = useCallback(() => {
        if (meditationAudioRef.current) {
            meditationAudioRef.current.pause();
            meditationAudioRef.current = null;
        }
        setMeditationIsPlaying(false);
        setMeditationPosition(0);
        setMeditationDuration(0);
        setCurrentMeditationFile(null);
    }, []);

    const toggleMeditation = useCallback(() => {
        if (!meditationAudioRef.current) return;

        if (meditationIsPlaying) {
            meditationAudioRef.current.pause();
            setMeditationIsPlaying(false);
        } else {
            meditationAudioRef.current.play().catch(console.error);
            setMeditationIsPlaying(true);
        }
    }, [meditationIsPlaying]);

    const setMeditationVolume = useCallback((v: number) => {
        setMeditationVolumeState(v);
    }, []);

    const seekMeditation = useCallback((time: number) => {
        if (meditationAudioRef.current) {
            meditationAudioRef.current.currentTime = time / 1000; // Convert from ms to seconds
        }
    }, []);


    return (
        <AudioContext.Provider
            value={{
                isConnected,
                hasLiveStream,
                hasPlaylistStream,
                isPlaying,
                audioError,
                volume,
                startAudio,
                togglePlay,
                setVolume,
                mixValue,
                setMixValue,
                loadMeditation,
                unloadMeditation,
                meditationIsPlaying,
                meditationVolume,
                setMeditationVolume,
                toggleMeditation,
                meditationPosition,
                meditationDuration,
                seekMeditation,
                currentMeditationFile,
            }}
        >
            {children}
        </AudioContext.Provider>
    );
}
