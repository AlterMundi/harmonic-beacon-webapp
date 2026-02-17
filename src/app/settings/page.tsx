"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
    const router = useRouter();
    const [language, setLanguage] = useState("en");

    return (
        <main className="min-h-screen pb-28">
            {/* Header */}
            <header className="sticky top-0 z-40 backdrop-blur-lg bg-[var(--bg-dark)]/80 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-3 p-4">
                    <button
                        onClick={() => router.back()}
                        className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center hover:bg-white/20 transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                    <div>
                        <h1 className="font-semibold">App Settings</h1>
                        <p className="text-xs text-[var(--text-muted)]">Preferences & Config</p>
                    </div>
                </div>
            </header>

            <div className="p-4 space-y-6">
                {/* General Preferences */}
                <section>
                    <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-3">
                        General
                    </h3>
                    <div className="glass-card overflow-hidden">
                        <div className="p-4 flex items-center justify-between">
                            <span className="text-sm font-medium">Language</span>
                            <select
                                value={language}
                                onChange={(e) => setLanguage(e.target.value)}
                                className="bg-transparent text-sm text-[var(--text-secondary)] focus:outline-none"
                            >
                                <option value="en" className="bg-[var(--bg-dark)]">English</option>
                                <option value="es" className="bg-[var(--bg-dark)]">Español</option>
                            </select>
                        </div>
                    </div>
                </section>

                {/* About */}
                <section>
                    <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-3">
                        About
                    </h3>
                    <div className="glass-card p-4 text-center">
                        <p className="text-sm font-medium">Harmonic Beacon</p>
                        <p className="text-xs text-[var(--text-muted)] mt-1">Version 1.0.0 (Alpha)</p>
                        <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                            <a href="#" className="text-xs text-[var(--primary-400)] hover:underline">Privacy Policy</a>
                            <span className="text-[var(--text-muted)] mx-2">·</span>
                            <a href="#" className="text-xs text-[var(--primary-400)] hover:underline">Terms of Service</a>
                        </div>
                    </div>
                </section>
            </div>
        </main>
    );
}
