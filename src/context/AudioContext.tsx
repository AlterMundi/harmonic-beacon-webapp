"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, Track, RemoteTrack } from 'livekit-client';

interface AudioContextType {
    // LiveKit / Beacon Audio
    isConnected: boolean;
    hasLiveStream: boolean;
    isPlaying: boolean;
    volume: number;
    togglePlay: () => void;
    setVolume: (v: number) => void;

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

const AudioContext = createContext<AudioContextType | null>(null);

export function useAudio() {
    const context = useContext(AudioContext);
    if (!context) {
        throw new Error('useAudio must be used within AudioProvider');
    }
    return context;
}

export function AudioProvider({ children }: { children: React.ReactNode }) {
    // LiveKit / Beacon state
    const [isConnected, setIsConnected] = useState(false);
    const [hasLiveStream, setHasLiveStream] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolumeState] = useState(0.5);

    // Meditation state
    const [meditationIsPlaying, setMeditationIsPlaying] = useState(false);
    const [meditationVolume, setMeditationVolumeState] = useState(1.0);
    const [meditationPosition, setMeditationPosition] = useState(0);
    const [meditationDuration, setMeditationDuration] = useState(0);
    const [currentMeditationFile, setCurrentMeditationFile] = useState<string | null>(null);

    const roomRef = useRef<Room | null>(null);
    const liveAudioRef = useRef<HTMLAudioElement | null>(null);
    const lofiAudioRef = useRef<HTMLAudioElement | null>(null);
    const meditationAudioRef = useRef<HTMLAudioElement | null>(null);

    const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://live.altermundi.net";
    const LIVEKIT_TOKEN = process.env.NEXT_PUBLIC_LIVEKIT_TOKEN || "";
    const LOFI_FALLBACK_URL = "https://streams.ilovemusic.de/iloveradio17.mp3";

    // Initialize LiveKit connection
    useEffect(() => {
        if (!LIVEKIT_TOKEN) {
            console.error("Missing NEXT_PUBLIC_LIVEKIT_TOKEN");
            return;
        }

        const room = new Room();
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, async (track: RemoteTrack) => {
            if (track.kind === Track.Kind.Audio) {
                console.log("✓ Subscribed to beacon audio track");
                const audioElement = track.attach() as HTMLAudioElement;
                liveAudioRef.current = audioElement;
                audioElement.volume = volume;
                audioElement.style.display = "none";
                document.body.appendChild(audioElement);
                setHasLiveStream(true);

                // Stop lofi fallback if playing
                if (lofiAudioRef.current) {
                    lofiAudioRef.current.pause();
                }

                // Auto-play if user already toggled play
                if (isPlaying) {
                    try {
                        await audioElement.play();
                    } catch (err) {
                        console.log("Autoplay blocked, waiting for user gesture");
                    }
                }
            }
        });

        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
            if (track.kind === Track.Kind.Audio) {
                console.log("✗ Beacon stopped broadcasting");
                track.detach().forEach((el) => el.remove());
                liveAudioRef.current = null;
                setHasLiveStream(false);

                // Fallback to Lofi if user wants audio
                if (isPlaying) {
                    playLofi();
                }
            }
        });

        room.on(RoomEvent.Disconnected, () => {
            console.log("Disconnected from LiveKit room");
            setIsConnected(false);
            setHasLiveStream(false);
        });

        room.connect(LIVEKIT_URL, LIVEKIT_TOKEN)
            .then(() => {
                console.log("✓ Connected to LiveKit room");
                setIsConnected(true);
            })
            .catch((err) => {
                console.error("Failed to connect to LiveKit:", err);
                // Fallback to Lofi immediately
                if (isPlaying) {
                    playLofi();
                }
            });

        return () => {
            room.disconnect();
            if (lofiAudioRef.current) {
                lofiAudioRef.current.pause();
                lofiAudioRef.current = null;
            }
        };
    }, [LIVEKIT_URL, LIVEKIT_TOKEN]);

    // Update volumes when changed
    useEffect(() => {
        if (liveAudioRef.current) {
            liveAudioRef.current.volume = volume;
        }
        if (lofiAudioRef.current) {
            lofiAudioRef.current.volume = volume;
        }
    }, [volume]);

    useEffect(() => {
        if (meditationAudioRef.current) {
            meditationAudioRef.current.volume = meditationVolume;
        }
    }, [meditationVolume]);

    const playLofi = useCallback(() => {
        if (!lofiAudioRef.current) {
            const audio = new Audio(LOFI_FALLBACK_URL);
            audio.loop = true;
            audio.volume = volume;
            lofiAudioRef.current = audio;
        }
        lofiAudioRef.current.play().catch(console.error);
    }, [volume, LOFI_FALLBACK_URL]);

    const togglePlay = useCallback(() => {
        if (isPlaying) {
            // Pause everything
            if (liveAudioRef.current) {
                liveAudioRef.current.pause();
            }
            if (lofiAudioRef.current) {
                lofiAudioRef.current.pause();
            }
            setIsPlaying(false);
        } else {
            // Play live stream or fallback to lofi
            if (liveAudioRef.current) {
                liveAudioRef.current.play().catch(console.error);
            } else {
                playLofi();
            }
            setIsPlaying(true);
        }
    }, [isPlaying, playLofi]);

    const setVolume = useCallback((v: number) => {
        setVolumeState(v);
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
            console.error("Failed to play meditation:", err);
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
                isPlaying,
                volume,
                togglePlay,
                setVolume,
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
