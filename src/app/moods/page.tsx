"use client";

import { BottomNav } from "@/components";

const moodTags = [
    { emoji: "😌", label: "Calm", color: "from-blue-500 to-cyan-500" },
    { emoji: "😴", label: "Sleepy", color: "from-indigo-500 to-purple-600" },
    { emoji: "🧘", label: "Mindful", color: "from-teal-500 to-green-500" },
    { emoji: "💆", label: "Relaxed", color: "from-purple-500 to-pink-500" },
    { emoji: "🌙", label: "Peaceful", color: "from-slate-500 to-blue-600" },
    { emoji: "🌊", label: "Flowing", color: "from-cyan-500 to-blue-500" },
    { emoji: "☀️", label: "Hopeful", color: "from-amber-400 to-orange-500" },
    { emoji: "🌸", label: "Gentle", color: "from-pink-400 to-rose-500" },
];

export default function MoodsPage() {
    return (
        <main className="min-h-screen pb-28">
            {/* Header */}
            <header className="p-6 pt-8">
                <h1 className="text-2xl font-bold">Moods</h1>
                <p className="text-[var(--text-secondary)] text-sm mt-1">
                    Connect with others feeling the same way
                </p>
            </header>

            {/* Coming Soon Banner */}
            <section className="px-4 mb-6">
                <div className="glass-card p-5 border-[var(--primary-600)]/30 bg-gradient-to-r from-[var(--primary-800)]/20 to-transparent">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-full bg-[var(--primary-600)] flex items-center justify-center animate-pulse-glow">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <div>
                            <p className="font-semibold">Coming Soon</p>
                            <p className="text-sm text-[var(--text-muted)]">
                                Match with others based on your mood
                            </p>
                        </div>
                    </div>
                </div>
            </section>

            {/* Preview: Mood Tags */}
            <section className="px-4">
                <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-4">
                    Select Your Mood (Preview)
                </h3>
                <div className="grid grid-cols-2 gap-3">
                    {moodTags.map((tag, i) => (
                        <button
                            key={tag.label}
                            className="glass-card p-4 flex items-center gap-3 opacity-60 cursor-not-allowed animate-fade-in"
                            style={{ opacity: 0, animationDelay: `${i * 0.05}s` }}
                            disabled
                        >
                            <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${tag.color} flex items-center justify-center`}>
                                <span className="text-xl">{tag.emoji}</span>
                            </div>
                            <span className="font-medium">{tag.label}</span>
                        </button>
                    ))}
                </div>
            </section>

            {/* How It Works */}
            <section className="px-4 mt-8">
                <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-4">
                    How It Will Work
                </h3>
                <div className="space-y-4">
                    {[
                        { num: 1, title: "Choose your mood", desc: "Select tags that match how you feel" },
                        { num: 2, title: "Get matched", desc: "We connect you with others in similar states" },
                        { num: 3, title: "Chat & connect", desc: "Share your experience while listening together" },
                    ].map((step, i) => (
                        <div key={step.num} className="flex items-start gap-4 animate-fade-in" style={{ opacity: 0, animationDelay: `${0.4 + i * 0.1}s` }}>
                            <div className="w-8 h-8 rounded-full bg-[var(--primary-700)] flex items-center justify-center flex-shrink-0 text-sm font-semibold">
                                {step.num}
                            </div>
                            <div>
                                <p className="font-medium">{step.title}</p>
                                <p className="text-sm text-[var(--text-muted)]">{step.desc}</p>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            <BottomNav />
        </main>
    );
}
