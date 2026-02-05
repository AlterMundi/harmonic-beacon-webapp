"use client";

import { useState, useRef, useEffect, createContext, useContext } from "react";

interface AudioPlayerContextType {
    isPlaying: boolean;
    volume: number;
    togglePlay: () => void;
    setVolume: (v: number) => void;
    showMiniPlayer: boolean;
    setShowMiniPlayer: (show: boolean) => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextType | null>(null);

export function useAudioPlayer() {
    const context = useContext(AudioPlayerContext);
    if (!context) {
        throw new Error("useAudioPlayer must be used within AudioPlayerProvider");
    }
    return context;
}

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
    const [isPlaying, setIsPlaying] = useState(false);
    const [volume, setVolume] = useState(0.5);
    const [showMiniPlayer, setShowMiniPlayer] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Use a lofi/ambient audio stream as placeholder
    // Replace this with your actual livestream audio URL
    const audioSrc = "https://streams.ilovemusic.de/iloveradio17.mp3"; // Chill/ambient placeholder

    useEffect(() => {
        if (!audioRef.current) {
            audioRef.current = new Audio(audioSrc);
            audioRef.current.loop = true;
            audioRef.current.volume = volume;
        }

        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.volume = volume;
        }
    }, [volume]);

    const togglePlay = () => {
        if (!audioRef.current) return;

        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play().catch(console.error);
        }
        setIsPlaying(!isPlaying);
    };

    return (
        <AudioPlayerContext.Provider
            value={{
                isPlaying,
                volume,
                togglePlay,
                setVolume,
                showMiniPlayer,
                setShowMiniPlayer,
            }}
        >
            {children}
        </AudioPlayerContext.Provider>
    );
}

export function MiniPlayer() {
    const { isPlaying, togglePlay, volume, setVolume, showMiniPlayer } = useAudioPlayer();

    if (!showMiniPlayer) return null;

    return (
        <div className="fixed top-0 left-0 right-0 z-50 p-3 bg-gradient-to-b from-[var(--bg-dark)] to-transparent">
            <div className="max-w-lg mx-auto glass-card p-3 flex items-center gap-3">
                {/* Play/Pause Button */}
                <button
                    onClick={togglePlay}
                    aria-label={isPlaying ? "Pause audio" : "Play audio"}
                    className="w-10 h-10 rounded-full bg-[var(--primary-600)] flex items-center justify-center flex-shrink-0 hover:bg-[var(--primary-500)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-400)] focus-visible:outline-offset-2"
                >
                    {isPlaying ? (
                        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                            <rect x="6" y="4" width="4" height="16" rx="1" />
                            <rect x="14" y="4" width="4" height="16" rx="1" />
                        </svg>
                    ) : (
                        <svg className="w-5 h-5 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    )}
                </button>

                {/* Info */}
                <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">Harmonic Beacon Live</p>
                    <p className="text-xs text-[var(--text-muted)]">
                        {isPlaying ? "Playing in background" : "Paused"}
                    </p>
                </div>

                {/* Audio Visualizer when playing */}
                {isPlaying && (
                    <div className="flex items-end gap-0.5 h-6">
                        {[...Array(4)].map((_, i) => (
                            <div
                                key={i}
                                className="w-1 bg-[var(--primary-400)] rounded-full"
                                style={{
                                    height: `${[70, 85, 55, 95][i]}%`,
                                    animation: `wave 1s ease-in-out infinite`,
                                    animationDelay: `${i * 0.1}s`,
                                }}
                            />
                        ))}
                    </div>
                )}

                {/* Volume Slider */}
                <div className="flex items-center gap-2">
                    <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.536 8.464a5 5 0 010 7.072M17.95 6.05a8 8 0 010 11.9M6.4 8H4a1 1 0 00-1 1v6a1 1 0 001 1h2.4l4.6 4V4l-4.6 4z" />
                    </svg>
                    <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={volume}
                        onChange={(e) => setVolume(parseFloat(e.target.value))}
                        aria-label="Volume control"
                        className="w-16 h-1 bg-[var(--border-subtle)] rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--primary-500)]"
                    />
                </div>
            </div>
        </div>
    );
}
