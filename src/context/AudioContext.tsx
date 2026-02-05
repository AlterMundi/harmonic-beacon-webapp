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
    loadMeditationFromGo2rtc: (meditationId: string) => Promise<void>;
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
    const meditationPeerConnectionRef = useRef<RTCPeerConnection | null>(null);

    // Refs for values accessed in callbacks (to avoid reconnection loops)
    const isPlayingRef = useRef(isPlaying);
    const volumeRef = useRef(volume);

    // Keep refs in sync with state
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
    useEffect(() => { volumeRef.current = volume; }, [volume]);

    const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://live.altermundi.net";
    const LIVEKIT_TOKEN = process.env.NEXT_PUBLIC_LIVEKIT_TOKEN || "";
    const LOFI_FALLBACK_URL = "https://streams.ilovemusic.de/iloveradio17.mp3";
    const GO2RTC_URL = process.env.NEXT_PUBLIC_GO2RTC_URL || "http://localhost:1984";

    const playLofi = useCallback(() => {
        if (!lofiAudioRef.current) {
            const audio = new Audio(LOFI_FALLBACK_URL);
            audio.loop = true;
            audio.volume = volumeRef.current;
            lofiAudioRef.current = audio;
        }
        lofiAudioRef.current.play().catch(console.error);
    }, [LOFI_FALLBACK_URL]);

    // Initialize LiveKit connection - runs once on mount
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
                audioElement.volume = volumeRef.current;
                audioElement.style.display = "none";
                document.body.appendChild(audioElement);
                setHasLiveStream(true);

                // Stop lofi fallback if playing
                if (lofiAudioRef.current) {
                    lofiAudioRef.current.pause();
                }

                // Auto-play if user already toggled play
                if (isPlayingRef.current) {
                    try {
                        await audioElement.play();
                    } catch {
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
                if (isPlayingRef.current) {
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
                // Fallback to Lofi immediately if user wants audio
                if (isPlayingRef.current) {
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
    }, [LIVEKIT_URL, LIVEKIT_TOKEN, playLofi]);

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

    // Load meditation from go2rtc WebRTC stream
    const loadMeditationFromGo2rtc = useCallback(async (meditationId: string) => {
        try {
            // Unload previous meditation
            if (meditationAudioRef.current) {
                meditationAudioRef.current.pause();
                meditationAudioRef.current = null;
            }
            if (meditationPeerConnectionRef.current) {
                meditationPeerConnectionRef.current.close();
                meditationPeerConnectionRef.current = null;
            }

            // Step 1: Create stream in go2rtc via API
            const createResponse = await fetch('/api/meditations', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ meditationId }),
            });

            if (!createResponse.ok) {
                throw new Error('Failed to create meditation stream');
            }

            const { streamName } = await createResponse.json();
            // Set currentMeditationFile to match the audioFile format in meditation page
            setCurrentMeditationFile(`/audio/meditations/${meditationId}.m4a`);

            // Step 2: Create RTCPeerConnection
            const pc = new RTCPeerConnection({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
            });

            meditationPeerConnectionRef.current = pc;

            // Add transceiver to receive audio
            pc.addTransceiver('audio', { direction: 'recvonly' });

            // Handle incoming audio track
            pc.ontrack = (event) => {
                console.log('✓ Received meditation audio track from go2rtc');
                const audio = new Audio();
                audio.srcObject = event.streams[0];
                audio.volume = meditationVolume;
                meditationAudioRef.current = audio;

                audio.play().then(() => {
                    setMeditationIsPlaying(true);
                    console.log('✓ Meditation playing via go2rtc');

                    // Start beacon in background if not already playing
                    if (!isPlaying) {
                        togglePlay();
                    }
                }).catch(err => {
                    console.error('Failed to play meditation audio:', err);
                });
            };

            // Step 3: Create offer and set local description
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            // Wait for ICE gathering to complete
            await new Promise<void>((resolve) => {
                if (pc.iceGatheringState === 'complete') {
                    resolve();
                } else {
                    pc.onicegatheringstatechange = () => {
                        if (pc.iceGatheringState === 'complete') {
                            resolve();
                        }
                    };
                }
            });

            // Step 4: Send offer to go2rtc and get answer (JSON format)
            const webrtcUrl = `${GO2RTC_URL}/api/webrtc?src=${streamName}`;
            const response = await fetch(webrtcUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'offer',
                    sdp: pc.localDescription?.sdp,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`go2rtc WebRTC error: ${response.status} - ${errorText}`);
            }

            // Step 5: Set remote description (answer from go2rtc)
            const answer = await response.json();
            await pc.setRemoteDescription({
                type: 'answer',
                sdp: answer.sdp,
            });

            console.log('✓ WebRTC connection established with go2rtc');
        } catch (error) {
            console.error('Failed to load meditation from go2rtc:', error);
        }
    }, [meditationVolume, isPlaying, togglePlay, GO2RTC_URL]);

    const unloadMeditation = useCallback(() => {
        if (meditationAudioRef.current) {
            meditationAudioRef.current.pause();
            meditationAudioRef.current = null;
        }
        if (meditationPeerConnectionRef.current) {
            meditationPeerConnectionRef.current.close();
            meditationPeerConnectionRef.current = null;
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
                loadMeditationFromGo2rtc,
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
