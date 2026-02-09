"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function SettingsPage() {
    const router = useRouter();
    const [notifications, setNotifications] = useState(true);
    const [theme, setTheme] = useState("dark");
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
                        <div className="p-4 flex items-center justify-between border-b border-[var(--border-subtle)]">
                            <span className="text-sm font-medium">Theme</span>
                            <div className="flex items-center gap-2 bg-white/5 p-1 rounded-lg">
                                <button
                                    onClick={() => setTheme("dark")}
                                    className={`p-1.5 rounded-md transition-colors ${theme === "dark" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"}`}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                                    </svg>
                                </button>
                                <button
                                    onClick={() => setTheme("light")}
                                    className={`p-1.5 rounded-md transition-colors ${theme === "light" ? "bg-white/10 text-white" : "text-white/40 hover:text-white/60"}`}
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                                    </svg>
                                </button>
                            </div>
                        </div>
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

                {/* Notifications */}
                <section>
                    <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-3">
                        Notifications
                    </h3>
                    <div className="glass-card p-4 flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium">Push Notifications</p>
                            <p className="text-xs text-[var(--text-muted)] mt-0.5">Alerts for new sessions</p>
                        </div>
                        <button
                            onClick={() => setNotifications(!notifications)}
                            className={`w-11 h-6 rounded-full transition-colors relative ${notifications ? "bg-[var(--primary-600)]" : "bg-white/10"}`}
                        >
                            <span
                                className={`absolute top-1 left-1 w-4 h-4 rounded-full bg-white transition-transform ${notifications ? "translate-x-5" : "translate-x-0"}`}
                            />
                        </button>
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
