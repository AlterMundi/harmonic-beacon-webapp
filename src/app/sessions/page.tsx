"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { BottomNav, AudioVisualizer } from "@/components";
import { useAudio } from "@/context/AudioContext";

interface SessionRecord {
    id: string;
    type: string;
    durationSeconds: number;
    completed: boolean;
    startedAt: string;
    endedAt: string | null;
    meditation: { title: string } | null;
}

interface ScheduledSessionItem {
    id: string;
    title: string;
    description: string | null;
    status: string;
    scheduledAt: string | null;
    startedAt: string | null;
    provider: { id: string; name: string | null };
    participantCount: number;
}

interface UserStats {
    totalSessions: number;
    totalMinutes: number;
    favoritesCount: number;
}

export default function SessionsPage() {
    const [isSessionActive, setIsSessionActive] = useState(false);
    const [duration, setDuration] = useState(0);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [sessions, setSessions] = useState<SessionRecord[]>([]);
    const [scheduledSessions, setScheduledSessions] = useState<ScheduledSessionItem[]>([]);
    const [stats, setStats] = useState<UserStats | null>(null);
    const [loadingSessions, setLoadingSessions] = useState(true);
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const { isPlaying, togglePlay, currentMeditationFile } = useAudio();

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
    };

    const formatDate = (iso: string): string => {
        const date = new Date(iso);
        const now = new Date();
        const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays === 0) return "Today";
        if (diffDays === 1) return "Yesterday";
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };

    const formatSessionDuration = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins}:${secs.toString().padStart(2, "0")}`;
    };

    const fetchSessions = useCallback(async () => {
        setLoadingSessions(true);
        try {
            const [sessRes, schedRes] = await Promise.all([
                fetch("/api/sessions?limit=10"),
                fetch("/api/scheduled-sessions?status=LIVE,SCHEDULED"),
            ]);
            if (sessRes.ok) {
                const data = await sessRes.json();
                setSessions(data.sessions || []);
            }
            if (schedRes.ok) {
                const data = await schedRes.json();
                setScheduledSessions(data.sessions || []);
            }
        } catch {
            // Silently fail
        } finally {
            setLoadingSessions(false);
        }
    }, []);

    const fetchStats = useCallback(async () => {
        try {
            const res = await fetch("/api/users/me");
            if (res.ok) {
                const data = await res.json();
                setStats(data.stats);
            }
        } catch {
            // Silently fail
        }
    }, []);

    useEffect(() => {
        fetchSessions();
        fetchStats();
    }, [fetchSessions, fetchStats]);

    // Timer for active session
    useEffect(() => {
        if (isSessionActive) {
            timerRef.current = setInterval(() => {
                setDuration((prev) => prev + 1);
            }, 1000);
        } else {
            if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
            }
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [isSessionActive]);

    const startSession = async () => {
        setDuration(0);
        setIsSessionActive(true);

        // Start beacon audio
        if (!isPlaying) {
            togglePlay();
        }

        // Create session via API
        try {
            const sessionType = currentMeditationFile ? "MEDITATION" : "LIVE";
            const body: Record<string, string> = { type: sessionType };
            if (sessionType === "MEDITATION" && currentMeditationFile) {
                body.meditationId = currentMeditationFile;
            }

            const res = await fetch("/api/sessions", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                const data = await res.json();
                setActiveSessionId(data.sessionId);
            }
        } catch {
            // Continue locally even if API fails
        }
    };

    const endSession = async () => {
        setIsSessionActive(false);

        // Stop beacon audio
        if (isPlaying) {
            togglePlay();
        }

        // End session via API
        if (activeSessionId) {
            try {
                await fetch(`/api/sessions/${activeSessionId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ completed: true }),
                });
            } catch {
                // Silently fail
            }
            setActiveSessionId(null);
        }

        // Refresh data
        fetchSessions();
        fetchStats();
    };

    return (
        <main className={`min-h-screen pb-28 ${isSessionActive ? "pt-20" : ""}`}>
            {/* Header */}
            <header className="p-6 pt-8">
                <h1 className="text-2xl font-bold">Sessions</h1>
                <p className="text-[var(--text-secondary)] text-sm mt-1">
                    Track your wellness journey with the beacon
                </p>
            </header>

            {/* Stats Summary */}
            {stats && (
                <section className="px-4 mb-6">
                    <div className="grid grid-cols-3 gap-3">
                        <div className="stat-card">
                            <span className="stat-value text-xl">{stats.totalSessions}</span>
                            <p className="stat-label text-xs">Sessions</p>
                        </div>
                        <div className="stat-card">
                            <span className="stat-value text-xl">{stats.totalMinutes}</span>
                            <p className="stat-label text-xs">Minutes</p>
                        </div>
                        <div className="stat-card">
                            <span className="stat-value text-xl">{stats.favoritesCount}</span>
                            <p className="stat-label text-xs">Favorites</p>
                        </div>
                    </div>
                </section>
            )}

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
                                        strokeDasharray={`${(duration % 60) * 4.71} 283`}
                                    />
                                </svg>
                                <div className="absolute inset-0 flex flex-col items-center justify-center">
                                    <span className="text-4xl font-bold">{formatTime(duration)}</span>
                                    <span className="text-xs text-[var(--text-muted)] mt-1">Session Time</span>
                                </div>
                            </div>
                            <AudioVisualizer isPlaying={isPlaying} bars={7} className="mt-4" />
                            <p className="text-xs text-[var(--text-muted)] mt-2">Live beacon audio playing</p>
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
                            Listen to the live beacon and track your session
                        </p>
                        <button onClick={startSession} className="btn-primary w-full py-4">
                            <span>Begin Solo Session</span>
                        </button>
                    </div>
                )}
            </section>

            {/* Recent Sessions */}
            <section className="px-4">
                <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-3">
                    Recent Sessions
                </h3>
                {loadingSessions ? (
                    <div className="flex justify-center py-6">
                        <div className="animate-spin w-6 h-6 border-2 border-[var(--primary-500)] border-t-transparent rounded-full"></div>
                    </div>
                ) : sessions.length === 0 ? (
                    <div className="glass-card p-4 text-center">
                        <p className="text-sm text-[var(--text-muted)]">No sessions yet. Start your first one!</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {sessions.map((s, i) => (
                            <div
                                key={s.id}
                                className="glass-card p-4 animate-fade-in"
                                style={{ opacity: 0, animationDelay: `${i * 0.1}s` }}
                            >
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="font-medium">{formatDate(s.startedAt)}</p>
                                        <p className="text-xs text-[var(--text-muted)]">
                                            {formatSessionDuration(s.durationSeconds)}
                                            {s.meditation ? ` \u2022 ${s.meditation.title}` : ` \u2022 ${s.type === "LIVE" ? "Live Beacon" : "Meditation"}`}
                                        </p>
                                    </div>
                                    <span className={`text-xs px-2 py-1 rounded-full ${
                                        s.completed
                                            ? "bg-green-500/20 text-green-400"
                                            : "bg-yellow-500/20 text-yellow-400"
                                    }`}>
                                        {s.completed ? "Completed" : "Partial"}
                                    </span>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>

            {/* Scheduled Sessions */}
            <section className="px-4 mt-6">
                <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-3">
                    Scheduled Sessions
                </h3>
                {scheduledSessions.length === 0 ? (
                    <div className="glass-card p-4 text-center">
                        <p className="text-sm text-[var(--text-muted)]">No upcoming sessions right now</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {scheduledSessions.map((s, i) => (
                            <Link
                                key={s.id}
                                href={`/session/${s.id}`}
                                className="glass-card p-4 block hover:bg-white/5 transition-colors animate-fade-in"
                                style={{ opacity: 0, animationDelay: `${i * 0.1}s` }}
                            >
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2 mb-1">
                                            <h4 className="font-medium truncate">{s.title}</h4>
                                            {s.status === "LIVE" && (
                                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 flex-shrink-0 flex items-center gap-1">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse"></span>
                                                    Live
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-[var(--text-muted)]">
                                            {s.provider.name || "Provider"}
                                            {" · "}
                                            {s.participantCount} listener{s.participantCount !== 1 ? "s" : ""}
                                            {s.scheduledAt && s.status === "SCHEDULED" && (
                                                <>
                                                    {" · "}
                                                    {new Date(s.scheduledAt).toLocaleString("en-US", {
                                                        month: "short",
                                                        day: "numeric",
                                                        hour: "numeric",
                                                        minute: "2-digit",
                                                    })}
                                                </>
                                            )}
                                        </p>
                                    </div>
                                    <svg className="w-5 h-5 text-[var(--text-muted)] flex-shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    </svg>
                                </div>
                            </Link>
                        ))}
                    </div>
                )}
            </section>

            <BottomNav />
        </main>
    );
}
