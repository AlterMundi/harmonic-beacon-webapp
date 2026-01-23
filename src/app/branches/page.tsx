"use client";

import { BottomNav } from "@/components";

export default function BranchesPage() {
    return (
        <main className="min-h-screen pb-28">
            {/* Header */}
            <header className="p-6 pt-8">
                <h1 className="text-2xl font-bold">Branches</h1>
                <p className="text-[var(--text-secondary)] text-sm mt-1">
                    Layer your sound over the live beacon
                </p>
            </header>

            {/* Coming Soon */}
            <section className="px-4">
                <div className="glass-card p-8 text-center">
                    {/* Tree illustration */}
                    <div className="w-32 h-32 mx-auto mb-6 relative">
                        <svg viewBox="0 0 120 120" className="w-full h-full">
                            {/* Main trunk */}
                            <line x1="60" y1="100" x2="60" y2="50" stroke="var(--primary-500)" strokeWidth="4" strokeLinecap="round" />

                            {/* Branches */}
                            <line x1="60" y1="50" x2="30" y2="30" stroke="var(--primary-400)" strokeWidth="3" strokeLinecap="round" />
                            <line x1="60" y1="50" x2="90" y2="30" stroke="var(--primary-400)" strokeWidth="3" strokeLinecap="round" />
                            <line x1="60" y1="70" x2="80" y2="55" stroke="var(--primary-400)" strokeWidth="2" strokeLinecap="round" />

                            {/* Nodes */}
                            <circle cx="60" cy="100" r="8" fill="var(--primary-600)" className="animate-pulse-glow" />
                            <circle cx="30" cy="30" r="6" fill="var(--primary-400)" />
                            <circle cx="90" cy="30" r="6" fill="var(--primary-400)" />
                            <circle cx="80" cy="55" r="5" fill="var(--primary-300)" />
                            <circle cx="60" cy="50" r="5" fill="var(--primary-500)" />
                        </svg>

                        {/* Glow effect */}
                        <div className="absolute inset-0 bg-[var(--primary-500)]/20 blur-3xl rounded-full" />
                    </div>

                    <div className="space-y-2">
                        <span className="inline-flex items-center gap-2 px-4 py-1.5 bg-[var(--primary-700)]/30 rounded-full text-sm font-medium text-[var(--primary-300)]">
                            <span className="w-2 h-2 bg-[var(--primary-400)] rounded-full animate-pulse" />
                            Coming Soon
                        </span>
                        <h2 className="text-xl font-semibold">Audio Branching</h2>
                        <p className="text-sm text-[var(--text-muted)] max-w-xs mx-auto">
                            Record your own layer over the live beacon and create unique audio branches for others to explore
                        </p>
                    </div>
                </div>
            </section>

            {/* Features Preview */}
            <section className="px-4 mt-8">
                <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-4">
                    What You&apos;ll Be Able To Do
                </h3>
                <div className="space-y-3">
                    {[
                        { icon: "🎙️", title: "Record over live", desc: "Add your voice or sounds to the beacon" },
                        { icon: "🌳", title: "Create branches", desc: "Build on others' recordings in a tree structure" },
                        { icon: "🎧", title: "Explore the tree", desc: "Listen to different audio paths and variations" },
                        { icon: "📡", title: "Live broadcast", desc: "Share your branch as a live stream" },
                    ].map((feature, i) => (
                        <div
                            key={feature.title}
                            className="glass-card p-4 flex items-center gap-4 animate-fade-in"
                            style={{ opacity: 0, animationDelay: `${i * 0.1}s` }}
                        >
                            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center text-xl">
                                {feature.icon}
                            </div>
                            <div>
                                <p className="font-medium">{feature.title}</p>
                                <p className="text-xs text-[var(--text-muted)]">{feature.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Notify Me */}
            <section className="px-4 mt-8">
                <div className="glass-card p-5 border-dashed">
                    <p className="text-sm text-center text-[var(--text-secondary)] mb-4">
                        Be the first to know when branches go live
                    </p>
                    <button className="btn-primary w-full" disabled>
                        <span>Notify Me (Coming Soon)</span>
                    </button>
                </div>
            </section>

            <BottomNav />
        </main>
    );
}
