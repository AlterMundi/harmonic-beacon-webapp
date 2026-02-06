"use client";

import { useState, useEffect } from "react";
import { BottomNav, AudioVisualizer } from "@/components";
import { useAudio } from "@/context/AudioContext";

interface SessionData {
    heartRate: number;
    hrv: number;
    duration: number;
}

export default function SessionsPage() {
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [healthConnected, setHealthConnected] = useState(false);
    const [sessionData, setSessionData] = useState<SessionData>({
        heartRate: 72,
        hrv: 45,
        duration: 0,
    });
    const { isPlaying, togglePlay } = useAudio();

    // Simulate heart rate fluctuations during session
    useEffect(() => {
        if (!isSessionActive) return;

        const interval = setInterval(() => {
            setSessionData((prev) => ({
                ...prev,
                heartRate: Math.max(55, Math.min(80, prev.heartRate + (Math.random() - 0.5) * 4)),
                hrv: Math.max(30, Math.min(70, prev.hrv + (Math.random() - 0.5) * 5)),
                duration: prev.duration + 1,
            }));
        }, 1000);

        return () => clearInterval(interval);
    }, [isSessionActive]);

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    const startSession = () => {
        setIsSessionActive(true);
        setSessionData({ heartRate: 72, hrv: 45, duration: 0 });

        // Start beacon audio
        if (!isPlaying) {
            togglePlay();
        }
    };

    const endSession = () => {
        setIsSessionActive(false);

        // Stop beacon audio
        if (isPlaying) {
            togglePlay();
        }
    };

    return (
        <main className={`min-h-screen pb-28 ${isSessionActive ? 'pt-20' : ''}`}>
            {/* Header */}
            <header className="p-6 pt-8">
                <h1 className="text-2xl font-bold">Sessions</h1>
                <p className="text-[var(--text-secondary)] text-sm mt-1">
                    Track your wellness journey with the beacon
                </p>
            </header>

            {/* Health Connection */}
            <section className="px-4 mb-6">
                <div className="glass-card p-4">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center ${healthConnected ? "bg-green-500/20" : "bg-white/5"}`}>
                                <svg className={`w-5 h-5 ${healthConnected ? "text-green-500" : "text-[var(--text-muted)]"}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                </svg>
                            </div>
                            <div>
                                <p className="font-medium">{healthConnected ? "Health Connected" : "Connect Health"}</p>
                                <p className="text-xs text-[var(--text-muted)]">
                                    {healthConnected ? "Google Fit • Synced" : "Link your fitness tracker"}
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={() => setHealthConnected(!healthConnected)}
                            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${healthConnected
                                    ? "bg-green-500/20 text-green-400 border border-green-500/30"
                                    : "btn-primary"
                                }`}
                        >
                            <span>{healthConnected ? "Connected" : "Connect"}</span>
                        </button>
                    </div>
                </div>
            </section>

            {/* Active Session or Start Button */}
            <section className="px-4 mb-6">
                {isSessionActive ? (
                    <div className="glass-card p-6 border-[var(--primary-600)] animate-fade-in">
                        {/* Timer Ring */}
                        <div className="flex flex-col items-center mb-6">
                            <div className="relative w-48 h-48">
                                <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
                                    <defs>
                                        <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="0%">
                                            <stop offset="0%" stopColor="var(--primary-500)" />
                                            <stop offset="100%" stopColor="var(--accent-500)" />
                                        </linearGradient>
                                    </defs>
                                    <circle
                                        cx="50"
                                        cy="50"
                                        r="45"
                                        fill="none"
                                        stroke="var(--border-subtle)"
                                        strokeWidth="4"
                                    />
                                    <circle
                                        cx="50"
                                        cy="50"
                                        r="45"
                                        fill="none"
                                        stroke="url(#gradient)"
                                        strokeWidth="4"
                                        strokeLinecap="round"
                                        strokeDasharray={`${(sessionData.duration % 60) * 4.71} 283`}
                                    />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-4xl font-bold">{formatTime(sessionData.duration)}</span>
                                    <span className="text-xs text-[var(--text-muted)] mt-1">Session Time</span>
                                </div>
                            </div>
                            <AudioVisualizer isPlaying={isPlaying} bars={7} className="mt-4" />
                            <p className="text-xs text-[var(--text-muted)] mt-2">🔊 Live beacon audio playing</p>
                        </div>

                        {/* Live Stats */}
                        <div className="grid grid-cols-2 gap-4 mb-6">
                            <div className="stat-card">
                                <div className="flex items-center justify-center gap-2">
                                    <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                                    </svg>
                                    <span className="stat-value">{Math.round(sessionData.heartRate)}</span>
                                </div>
                                <p className="stat-label">BPM</p>
                            </div>
                            <div className="stat-card">
                                <div className="flex items-center justify-center gap-2">
                                    <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    <span className="stat-value">{Math.round(sessionData.hrv)}</span>
                                </div>
                                <p className="stat-label">HRV (ms)</p>
                            </div>
                        </div>

                        {/* End Session Button */}
                        <button
                            onClick={endSession}
                            className="w-full py-4 rounded-xl bg-red-500/20 border border-red-500/30 text-red-400 font-medium hover:bg-red-500/30 transition-all"
                        >
                            End Session
                        </button>
                    </div>
                ) : (
                    <div className="glass-card p-6 text-center">
                        <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-[var(--primary-600)] to-[var(--primary-800)] flex items-center justify-center animate-breathe">
                            <svg className="w-10 h-10" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                        </div>
                        <h2 className="text-xl font-semibold mb-2">Start a Session</h2>
                        <p className="text-sm text-[var(--text-muted)] mb-6">
                            Listen to the live beacon while tracking your biometrics
                        </p>
                        <button onClick={startSession} className="btn-primary w-full py-4">
                            <span>Begin Solo Session</span>
                        </button>
                    </div>
                )}
            </section>

            {/* Past Sessions */}
            <section className="px-4">
                <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-3">
                    Recent Sessions
                </h3>
                <div className="space-y-3">
                    {[
                        { date: "Today", duration: "15:42", avgHr: 68, hrvChange: "+12%" },
                        { date: "Yesterday", duration: "22:18", avgHr: 71, hrvChange: "+8%" },
                        { date: "Jan 13", duration: "10:05", avgHr: 74, hrvChange: "+5%" },
                    ].map((session, i) => (
                        <div key={i} className="glass-card p-4 animate-fade-in" style={{ opacity: 0, animationDelay: `${i * 0.1}s` }}>
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="font-medium">{session.date}</p>
                                    <p className="text-xs text-[var(--text-muted)]">{session.duration} • Avg {session.avgHr} BPM</p>
                                </div>
                                <span className="text-sm text-green-400 font-medium">{session.hrvChange} HRV</span>
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* Scheduled Sessions CTA */}
            <section className="px-4 mt-6">
                <div className="glass-card p-5 border-dashed">
                    <div className="flex items-center gap-4">
                        <div className="w-12 h-12 rounded-xl bg-[var(--primary-700)]/30 flex items-center justify-center">
                            <svg className="w-6 h-6 text-[var(--primary-400)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                        </div>
                        <div className="flex-1">
                            <p className="font-medium">Scheduled Sessions</p>
                            <p className="text-xs text-[var(--text-muted)]">Join group sessions with others</p>
                        </div>
                        <span className="text-xs text-[var(--text-muted)] px-2 py-1 rounded bg-white/5">Coming Soon</span>
                    </div>
                </div>
            </section>

            <BottomNav />
        </main>
    );
}
