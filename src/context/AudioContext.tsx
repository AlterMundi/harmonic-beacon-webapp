"use client";

import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { Room, RoomEvent, Track, RemoteTrack, RemoteParticipant, RemoteTrackPublication } from 'livekit-client';

// Participant identity for the live USB audio source
const WANDA_IDENTITY = "wanda02";

interface AudioContextType {
    // LiveKit / Beacon Audio
    isConnected: boolean;
    hasLiveStream: boolean;
    hasPlaylistStream: boolean;
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
    const [hasPlaylistStream, setHasPlaylistStream] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolumeState] = useState(0.5);

    // Meditation state
    const [meditationIsPlaying, setMeditationIsPlaying] = useState(false);
    const [meditationVolume, setMeditationVolumeState] = useState(1.0);
    const [meditationPosition, setMeditationPosition] = useState(0);
    const [meditationDuration, setMeditationDuration] = useState(0);
    const [currentMeditationFile, setCurrentMeditationFile] = useState<string | null>(null);

    const roomRef = useRef<Room | null>(null);
    // Track audio elements per participant identity
    const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
    const meditationAudioRef = useRef<HTMLAudioElement | null>(null);
    const meditationPeerConnectionRef = useRef<RTCPeerConnection | null>(null);

    // Refs for values accessed in callbacks (to avoid reconnection loops)
    const isPlayingRef = useRef(isPlaying);
    const volumeRef = useRef(volume);

    // Keep refs in sync with state
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
    useEffect(() => { volumeRef.current = volume; }, [volume]);

    const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://live.altermundi.net";
    const GO2RTC_URL = process.env.NEXT_PUBLIC_GO2RTC_URL || "http://localhost:1984";

    // Initialize LiveKit connection - runs once on mount
    useEffect(() => {
        const room = new Room();
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, async (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (track.kind === Track.Kind.Audio) {
                const identity = participant.identity;
                const isLive = identity === WANDA_IDENTITY;

                console.log(`✓ Subscribed to ${isLive ? 'LIVE' : 'playlist'} audio track (${identity})`);

                track.setPlayoutDelay(0.5);  // 500ms jitter buffer — absorbs USB clock drift
                const audioElement = track.attach() as HTMLAudioElement;
                audioElement.volume = volumeRef.current;
                audioElement.style.display = "none";
                document.body.appendChild(audioElement);

                // Store audio element by participant identity
                audioElementsRef.current.set(identity, audioElement);

                if (isLive) {
                    setHasLiveStream(true);
                } else {
                    setHasPlaylistStream(true);
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

        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack, publication: RemoteTrackPublication, participant: RemoteParticipant) => {
            if (track.kind === Track.Kind.Audio) {
                const identity = participant.identity;
                const isLive = identity === WANDA_IDENTITY;

                console.log(`✗ ${isLive ? 'LIVE' : 'Playlist'} audio track removed (${identity})`);

                track.detach().forEach((el) => el.remove());
                audioElementsRef.current.delete(identity);

                if (isLive) {
                    setHasLiveStream(false);
                } else {
                    setHasPlaylistStream(false);
                }
            }
        });

        room.on(RoomEvent.Disconnected, () => {
            console.log("Disconnected from LiveKit room");
            setIsConnected(false);
            setHasLiveStream(false);
            setHasPlaylistStream(false);
        });

        // Fetch token from server-side API and connect
        fetch('/api/livekit/token')
            .then((res) => res.json())
            .then(({ token }) => room.connect(LIVEKIT_URL, token))
            .then(() => {
                console.log("✓ Connected to LiveKit room");
                setIsConnected(true);
            })
            .catch((err) => {
                console.error("Failed to connect to LiveKit:", err);
            });

        return () => {
            room.disconnect();
            audioElementsRef.current.forEach((el) => {
                el.pause();
                el.remove();
            });
            audioElementsRef.current.clear();
        };
    }, [LIVEKIT_URL]);

    // Update volumes when changed
    useEffect(() => {
        audioElementsRef.current.forEach((el) => {
            el.volume = volume;
        });
    }, [volume]);

    useEffect(() => {
        if (meditationAudioRef.current) {
            meditationAudioRef.current.volume = meditationVolume;
        }
    }, [meditationVolume]);

    const togglePlay = useCallback(() => {
        if (isPlaying) {
            // Pause all beacon audio elements
            audioElementsRef.current.forEach((el) => el.pause());
            setIsPlaying(false);
        } else {
            // Play all beacon audio elements (only non-muted ones produce sound)
            audioElementsRef.current.forEach((el) => {
                el.play().catch(console.error);
            });
            setIsPlaying(true);
        }
    }, [isPlaying]);

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
            // Set currentMeditationFile to the streamName for consistent comparison
            setCurrentMeditationFile(streamName);

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
            const webrtcUrl = `${GO2RTC_URL}/webrtc?src=${streamName}`;
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
                hasPlaylistStream,
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
