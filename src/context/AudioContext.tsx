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
import { redactErrorDetail } from '@/lib/redact';

// Participant identity for the live USB audio source
const BEACON_IDENTITY = "beacon01";

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

    const roomRef = useRef<Room | null>(null);
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
    const isPlayingRef = useRef(isPlaying);
    const volumeRef = useRef(volume);
    const hasLiveStreamRef = useRef(hasLiveStream);

    // Keep refs in sync with state
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
    useEffect(() => { volumeRef.current = volume; }, [volume]);
    useEffect(() => { hasLiveStreamRef.current = hasLiveStream; }, [hasLiveStream]);

    const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://live.altermundi.net";

    // Initialize LiveKit connection - runs once on mount
    useEffect(() => {
        let cancelled = false;
        const room = new Room();
        const audioElements = audioElementsRef.current;
        roomRef.current = room;

        const removeTrackedAudio = (track: RemoteTrack) => {
            const tracked = audioElementsRef.current.get(track);
            track.detach().forEach((element) => element.remove());
            if (tracked) {
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
                const audioElement = track.attach() as HTMLAudioElement;
                audioElement.volume = volumeRef.current;
                audioElement.style.display = "none";
                document.body.appendChild(audioElement);

                audioElementsRef.current.set(track, { element: audioElement, identity, publication });
                syncSourceAvailability();

                // Tracks can arrive after the user has already unlocked audio.
                // Start them immediately without rebuilding the SDK attachment.
                if (isPlayingRef.current) {
                    try {
                        await audioElement.play();
                    } catch {
                        setAudioError("Audio was blocked. Press Start audio again.");
                    }
                }
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
            setIsConnected(false);
            setHasLiveStream(false);
            setHasPlaylistStream(false);
        });

        async function connect() {
            try {
                const res = await fetch(`/api/livekit/token?sessionId=${encodeURIComponent(sessionId)}`);
                // The endpoint requires a session. Without this check a 401 body
                // has no `token`, and the failure surfaces as an opaque connect
                // error against an undefined token rather than as "not signed in".
                if (!res.ok) {
                    throw new Error(`token request failed: ${res.status}`);
                }
                const { token } = await res.json();
                if (cancelled) return;

                await room.connect(LIVEKIT_URL, token);
                if (cancelled) {
                    room.disconnect();
                    return;
                }

                console.log("✓ Connected to LiveKit room");
                setIsConnected(true);
                setAudioError(null);
            } catch (err) {
                if (cancelled) return;
                console.error("Failed to connect to LiveKit:", redactErrorDetail(err));
                setAudioError("Beacon audio could not connect. Check your connection and try again.");
            }
        }

        void connect();

        return () => {
            cancelled = true;
            room.disconnect();
            if (roomRef.current === room) roomRef.current = null;
            audioElements.forEach(({ element }) => {
                element.pause();
                element.remove();
            });
            audioElements.clear();
        };
    }, [LIVEKIT_URL, sessionId]);

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
    const startAudio = useCallback(async (): Promise<boolean> => {
        // Set this before awaiting anything so a subscription delivered while
        // either LiveKit room is still unlocking starts in the same gesture.
        isPlayingRef.current = true;
        try {
            // Invoke native playback before LiveKit resumes its AudioContext.
            // With two rooms, a context resume can consume Safari/iOS's user
            // activation before the other room gets a chance to call play().
            const elementStarts = [...audioElementsRef.current.values()].map(
                ({ element }) => element.play(),
            );
            const roomStart = roomRef.current?.startAudio() ?? Promise.resolve();
            await Promise.all([roomStart, ...elementStarts]);

            // LiveKit's startAudio() unmutes all remote audio elements. Restore
            // the live-source priority so playlist and beacon01 never overlap.
            audioElementsRef.current.forEach(({ element, identity }) => {
                element.muted = hasLiveStreamRef.current && identity !== BEACON_IDENTITY;
            });

            // Never detach/re-attach here: that discards a working element and
            // leaks it in document.body.
            isPlayingRef.current = true;
            setIsPlaying(true);
            setAudioError(null);
            return true;
        } catch (err) {
            console.error("Failed to start Beacon audio:", redactErrorDetail(err));
            isPlayingRef.current = false;
            setIsPlaying(false);
            setAudioError("Audio could not start. Check that this tab is not muted, then try again.");
            return false;
        }
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
