"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { Room, RoomEvent, Track, RemoteTrack } from "livekit-client";
import { BottomNav, LiveBadge, AudioVisualizer } from "@/components";

export default function LivePage() {
    const [isConnected, setIsConnected] = useState(false);
    const [hasLiveStream, setHasLiveStream] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [needsUserGesture, setNeedsUserGesture] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const roomRef = useRef<Room | null>(null);
    const audioElementRef = useRef<HTMLAudioElement | null>(null);

    const LIVEKIT_URL = process.env.NEXT_PUBLIC_LIVEKIT_URL || "wss://live.altermundi.net";
    const LIVEKIT_TOKEN = process.env.NEXT_PUBLIC_LIVEKIT_TOKEN || "";

    const playAudio = useCallback(async () => {
        if (audioElementRef.current) {
            try {
                await audioElementRef.current.play();
                setIsPlaying(true);
                setNeedsUserGesture(false);
                console.log("✓ Audio playing");
            } catch (err) {
                console.error("Failed to play audio:", err);
            }
        }
    }, []);

    useEffect(() => {
        if (!LIVEKIT_TOKEN) {
            setError("Missing NEXT_PUBLIC_LIVEKIT_TOKEN in .env.local");
            return;
        }

        const room = new Room();
        roomRef.current = room;

        room.on(RoomEvent.TrackSubscribed, async (track: RemoteTrack) => {
            if (track.kind === Track.Kind.Audio) {
                console.log("✓ Subscribed to beacon audio track");
                const audioElement = track.attach() as HTMLAudioElement;
                audioElementRef.current = audioElement;
                audioElement.style.display = "none";
                document.body.appendChild(audioElement);
                setHasLiveStream(true);

                // Try to autoplay
                try {
                    await audioElement.play();
                    setIsPlaying(true);
                    console.log("✓ Audio autoplaying");
                } catch {
                    // Browser blocked autoplay - need user gesture
                    console.log("⚠️ Autoplay blocked, waiting for user click");
                    setNeedsUserGesture(true);
                }
            }
        });

        room.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
            if (track.kind === Track.Kind.Audio) {
                console.log("✗ Beacon stopped broadcasting");
                track.detach().forEach((el) => el.remove());
                audioElementRef.current = null;
                setHasLiveStream(false);
                setIsPlaying(false);
            }
        });

        room.on(RoomEvent.Disconnected, () => {
            console.log("Disconnected from room");
            setIsConnected(false);
            setHasLiveStream(false);
            setIsPlaying(false);
        });

        room.connect(LIVEKIT_URL, LIVEKIT_TOKEN)
            .then(() => {
                console.log("✓ Connected to LiveKit room");
                setIsConnected(true);
            })
            .catch((err) => {
                console.error("Failed to connect:", err);
                setError(`Failed to connect: ${err.message}`);
            });

        return () => {
            room.disconnect();
        };
    }, [LIVEKIT_URL, LIVEKIT_TOKEN]);

    return (
        <main className="min-h-screen pb-28">
            {/* Header */}
            <header className="p-6 pt-8">
                <div className="flex items-center justify-between mb-2">
                    <h1 className="text-2xl font-bold">Harmonic Beacon</h1>
                    <LiveBadge isLive={hasLiveStream && isPlaying} />
                </div>
                <p className="text-[var(--text-secondary)] text-sm">
                    {!isConnected
                        ? "Connecting to LiveKit..."
                        : hasLiveStream && isPlaying
                            ? "🔴 Live harmonic resonance from the guitar"
                            : hasLiveStream
                                ? "Click to start listening"
                                : "📻 Waiting for beacon to start broadcasting..."}
                </p>
            </header>

            {/* Status Card */}
            <section className="px-4 animate-fade-in">
                <div className="glass-card p-6 text-center">
                    {error ? (
                        <div className="text-red-400">
                            <p className="text-lg">❌ Error</p>
                            <p className="text-sm mt-2">{error}</p>
                        </div>
                    ) : !isConnected ? (
                        <div>
                            <p className="text-4xl animate-pulse">📡</p>
                            <p className="mt-4">Connecting to LiveKit...</p>
                        </div>
                    ) : hasLiveStream && isPlaying ? (
                        <div>
                            <p className="text-6xl animate-pulse">🎸</p>
                            <p className="text-xl mt-4 font-semibold text-green-400">Live Audio Playing!</p>
                            <p className="text-sm text-[var(--text-muted)] mt-2">Listening to Harmonic Beacon</p>
                        </div>
                    ) : hasLiveStream && needsUserGesture ? (
                        <div>
                            <p className="text-6xl">🔊</p>
                            <p className="text-xl mt-4">Beacon is broadcasting!</p>
                            <button
                                onClick={playAudio}
                                className="btn-primary mt-6 px-8 py-4 text-lg"
                            >
                                ▶️ Click to Listen
                            </button>
                        </div>
                    ) : (
                        <div>
                            <p className="text-4xl">⏳</p>
                            <p className="mt-4">Connected - waiting for beacon to broadcast</p>
                            <p className="text-sm text-[var(--text-muted)] mt-2">Make sure the Pi broadcaster is running</p>
                        </div>
                    )}
                </div>
            </section>

            {/* Audio Info */}
            <section className="px-4 mt-6 animate-fade-in stagger-1" style={{ opacity: 0 }}>
                <div className="glass-card p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="font-semibold text-lg">Harmonic Scale Resonance</h2>
                            <p className="text-[var(--text-muted)] text-sm mt-1">
                                {isPlaying ? "Live from Raspberry Pi • A 432Hz" : "Continuous auto-strumming • A 432Hz"}
                            </p>
                        </div>
                        <AudioVisualizer isPlaying={isPlaying} />
                    </div>
                </div>
            </section>

            {/* Benefits Section */}
            <section className="px-4 mt-6 animate-fade-in stagger-2" style={{ opacity: 0 }}>
                <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-3">
                    Benefits
                </h3>
                <div className="grid grid-cols-3 gap-3">
                    {[
                        { icon: "🧘", label: "Stress Relief" },
                        { icon: "😴", label: "Better Sleep" },
                        { icon: "🎯", label: "Focus" },
                    ].map((benefit) => (
                        <div key={benefit.label} className="glass-card p-4 text-center">
                            <span className="text-2xl">{benefit.icon}</span>
                            <p className="text-xs text-[var(--text-secondary)] mt-2">{benefit.label}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* Connection Status */}
            <section className="px-4 mt-6 animate-fade-in stagger-3" style={{ opacity: 0 }}>
                <div className="glass-card p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center ${isConnected ? 'bg-green-700' : 'bg-gray-700'}`}>
                            <span className="text-xl">{isConnected ? '✓' : '○'}</span>
                        </div>
                        <div>
                            <p className="font-semibold">{isConnected ? 'Connected to LiveKit' : 'Connecting...'}</p>
                            <p className="text-xs text-[var(--text-muted)]">{LIVEKIT_URL}</p>
                        </div>
                    </div>
                </div>
            </section>

            <BottomNav />
        </main>
    );
}
