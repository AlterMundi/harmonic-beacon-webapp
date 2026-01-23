"use client";

import { BottomNav, LiveBadge, AudioVisualizer } from "@/components";

export default function LivePage() {
    // Replace with your actual YouTube video ID
    const youtubeVideoId = "jfKfPfyJRdk"; // Lo-fi beats placeholder

    return (
        <main className="min-h-screen pb-28">
            {/* Header */}
            <header className="p-6 pt-8">
                <div className="flex items-center justify-between mb-2">
                    <h1 className="text-2xl font-bold">Harmonic Beacon</h1>
                    <LiveBadge isLive={true} />
                </div>
                <p className="text-[var(--text-secondary)] text-sm">
                    Live harmonic resonance from the guitar
                </p>
            </header>

            {/* Video Player */}
            <section className="px-4 animate-fade-in">
                <div className="relative aspect-video rounded-2xl overflow-hidden glass-card border-0">
                    <iframe
                        className="absolute inset-0 w-full h-full"
                        src={`https://www.youtube.com/embed/${youtubeVideoId}?autoplay=1&mute=0&controls=1&modestbranding=1&rel=0`}
                        title="Harmonic Beacon Live Stream"
                        frameBorder="0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                    />
                </div>
            </section>

            {/* Audio Info */}
            <section className="px-4 mt-6 animate-fade-in stagger-1" style={{ opacity: 0 }}>
                <div className="glass-card p-5">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="font-semibold text-lg">Harmonic Scale Resonance</h2>
                            <p className="text-[var(--text-muted)] text-sm mt-1">
                                Continuous auto-strumming • A 432Hz
                            </p>
                        </div>
                        <AudioVisualizer isPlaying={true} />
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

            {/* Viewers Count */}
            <section className="px-4 mt-6 animate-fade-in stagger-3" style={{ opacity: 0 }}>
                <div className="glass-card p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-[var(--primary-700)] flex items-center justify-center">
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                <circle cx="9" cy="7" r="4" />
                                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                            </svg>
                        </div>
                        <div>
                            <p className="font-semibold">247 listening now</p>
                            <p className="text-xs text-[var(--text-muted)]">Join the calm community</p>
                        </div>
                    </div>
                    <button className="btn-secondary text-sm px-4 py-2">
                        Share
                    </button>
                </div>
            </section>

            <BottomNav />
        </main>
    );
}
