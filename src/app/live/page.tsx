"use client";

import { BottomNav, AudioVisualizer } from "@/components";
import { useAudio } from "@/context/AudioContext";

export default function LivePage() {
    const { isConnected, hasLiveStream, isPlaying, togglePlay } = useAudio();

    return (
        <main className="min-h-screen pb-28 relative overflow-hidden">
            {/* Background video */}
            <video
                autoPlay
                loop
                muted
                playsInline
                className="fixed inset-0 w-full h-full object-cover opacity-30"
            >
                <source src="/videos/beacon_ambient.mp4" type="video/mp4" />
            </video>

            {/* Gradient overlay */}
            <div className="fixed inset-0 bg-gradient-to-b from-[rgba(10,10,26,0.3)] via-[rgba(10,10,26,0.7)] to-[rgba(10,10,26,0.95)]" />

            {/* Content */}
            <div className="relative z-10 flex flex-col h-screen pb-28 p-6">
                {/* Header - centered */}
                <header className="text-center pt-8">
                    {/* Live Badge */}
                    <div className="inline-flex items-center gap-2 bg-red-500/20 border border-red-500/40 px-3 py-1.5 rounded-full mb-4">
                        <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                        <span className="text-red-500 text-xs font-bold tracking-wider">
                            {hasLiveStream ? 'LIVE' : 'RADIO'}
                        </span>
                    </div>

                    {/* Title */}
                    <h1 className="text-4xl font-bold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.5)]">
                        Harmonic Beacon
                    </h1>
                </header>

                {/* Spacer */}
                <div className="flex-1" />

                {/* Audio Visualizer */}
                <div className="h-20 flex items-center justify-center mb-6">
                    <AudioVisualizer isPlaying={isPlaying} bars={8} />
                </div>

                {/* Play Button - Always enabled to control audio */}
                <div className="flex flex-col items-center mb-8">
                    <button
                        onClick={togglePlay}
                        className="w-20 h-20 rounded-full bg-[rgba(99,70,255,0.8)] shadow-[0_0_30px_rgba(99,70,255,0.6)] flex items-center justify-center border-2 border-white/20 hover:scale-105 transition-transform active:scale-95"
                    >
                        {isPlaying ? (
                            <svg className="w-8 h-8 text-white" fill="currentColor" viewBox="0 0 24 24">
                                <rect x="7" y="5" width="3" height="14" rx="1" />
                                <rect x="14" y="5" width="3" height="14" rx="1" />
                            </svg>
                        ) : (
                            <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24">
                                <path d="M8 5v14l11-7z" />
                            </svg>
                        )}
                    </button>

                    {/* Status text */}
                    <p className="text-[var(--text-muted)] text-sm italic text-center mt-5">
                        {!isConnected
                            ? "Connecting to Beacon..."
                            : hasLiveStream && isPlaying
                                ? "🔴 Live Resonance Active"
                                : hasLiveStream && !isPlaying
                                    ? "Live stream paused (connection maintained)"
                                    : isPlaying
                                        ? "📻 Playing Backup Radio"
                                        : "Ready to play"}
                    </p>
                </div>

                {/* Bottom spacer for status */}
                <div className="h-20" />
            </div>

            <BottomNav />
        </main>
    );
}
