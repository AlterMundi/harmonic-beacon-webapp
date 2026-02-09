"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { BottomNav } from "@/components";
import { useSession, signOut } from "next-auth/react";

interface UserStats {
    totalSessions: number;
    totalMinutes: number;
    favoritesCount: number;
}

interface FavoriteItem {
    meditationId: string;
    meditation: {
        id: string;
        title: string;
        streamName: string;
        durationSeconds: number;
    };
}

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export default function ProfilePage() {
    const { data: session, status } = useSession();
    const [stats, setStats] = useState<UserStats | null>(null);
    const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
    const [dbRole, setDbRole] = useState<string | null>(null);

    useEffect(() => {
        if (!session?.user) return;

        // Fetch stats and role
        fetch("/api/users/me")
            .then((r) => r.json())
            .then((data) => {
                setStats(data.stats);
                setDbRole(data.user?.role || null);
            })
            .catch(() => { });

        // Fetch favorites
        fetch("/api/favorites")
            .then((r) => r.json())
            .then((data) => {
                if (data.favorites) setFavorites(data.favorites);
            })
            .catch(() => { });
    }, [session]);

    const handleSignOut = async () => {
        await signOut({ callbackUrl: "/login" });
    };

    if (status === "loading") {
        return (
            <main className="min-h-screen pb-28 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full mx-auto mb-4"></div>
                    <p className="text-[var(--text-muted)]">Loading...</p>
                </div>
            </main>
        );
    }

    const user = session?.user;
    const role = dbRole || user?.role || "LISTENER";

    const roleBadge: Record<string, { label: string; color: string }> = {
        ADMIN: { label: "Admin", color: "bg-red-500/20 text-red-400" },
        PROVIDER: { label: "Provider", color: "bg-purple-500/20 text-purple-400" },
        LISTENER: { label: "Listener", color: "bg-blue-500/20 text-blue-400" },
        USER: { label: "Listener", color: "bg-blue-500/20 text-blue-400" },
    };

    const badge = roleBadge[role] || roleBadge.LISTENER;

    return (
        <main className="min-h-screen pb-28">
            {/* Header */}
            <header className="p-6 pt-8">
                <h1 className="text-2xl font-bold">Profile</h1>
                <p className="text-[var(--text-secondary)] text-sm mt-1">
                    My Harmonic Journey
                </p>
            </header>

            {user ? (
                <>
                    {/* Profile Card */}
                    <section className="px-4 mb-6">
                        <div className="glass-card p-4 flex items-center gap-4">
                            <div className="w-14 h-14 rounded-full bg-[var(--primary-600)] flex items-center justify-center overflow-hidden">
                                {user.image ? (
                                    <Image
                                        src={user.image}
                                        alt="Profile"
                                        width={56}
                                        height={56}
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                )}
                            </div>
                            <div className="flex-1">
                                <div className="flex items-center gap-2">
                                    <p className="font-semibold">
                                        {user.name || user.email || "User"}
                                    </p>
                                    <span className={`text-xs px-2 py-0.5 rounded-full ${badge.color}`}>
                                        {badge.label}
                                    </span>
                                </div>
                                {user.email && (
                                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{user.email}</p>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Stats */}
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

                    {/* Favorites */}
                    {favorites.length > 0 && (
                        <section className="px-4 mb-6">
                            <h3 className="text-[var(--text-muted)] text-xs uppercase tracking-wider mb-3">
                                Favorites
                            </h3>
                            <div className="space-y-2">
                                {favorites.map((fav) => (
                                    <Link
                                        key={fav.meditationId}
                                        href="/meditation"
                                        className="glass-card p-3 flex items-center gap-3"
                                    >
                                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[var(--primary-600)] to-[var(--primary-800)] flex items-center justify-center flex-shrink-0">
                                            <svg className="w-5 h-5 text-white/80" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
                                            </svg>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-sm truncate">{fav.meditation.title}</p>
                                            <p className="text-xs text-[var(--text-muted)]">
                                                {formatDuration(fav.meditation.durationSeconds)}
                                            </p>
                                        </div>
                                        <svg className="w-4 h-4 text-red-400" fill="currentColor" viewBox="0 0 24 24">
                                            <path d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                                        </svg>
                                    </Link>
                                ))}
                            </div>
                        </section>
                    )}

                    {/* Menu Items */}
                    <section className="px-4 mb-6">
                        <div className="glass-card overflow-hidden">
                            <button className="w-full flex items-center gap-4 p-4 border-b border-[var(--border-subtle)] hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-500)] focus-visible:outline-offset-[-2px]">
                                <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                </div>
                                <span className="flex-1 text-left">App Settings</span>
                            </button>

                            {/* Provider Studio — visible for PROVIDER/ADMIN */}
                            {(role === "PROVIDER" || role === "ADMIN") && (
                                <Link
                                    href="/provider/dashboard"
                                    className="w-full flex items-center gap-4 p-4 border-b border-[var(--border-subtle)] hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-500)] focus-visible:outline-offset-[-2px]"
                                >
                                    <div className="w-9 h-9 rounded-lg bg-purple-500/20 flex items-center justify-center">
                                        <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
                                        </svg>
                                    </div>
                                    <span className="flex-1 text-left">Provider Studio</span>
                                    <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    </svg>
                                </Link>
                            )}

                            {/* Admin Panel — visible for ADMIN */}
                            {role === "ADMIN" && (
                                <Link
                                    href="/admin/moderation"
                                    className="w-full flex items-center gap-4 p-4 hover:bg-white/5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-500)] focus-visible:outline-offset-[-2px]"
                                >
                                    <div className="w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center">
                                        <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
                                        </svg>
                                    </div>
                                    <span className="flex-1 text-left">Admin Panel</span>
                                    <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                                    </svg>
                                </Link>
                            )}
                        </div>
                    </section>

                    {/* Sign Out Button */}
                    <section className="px-4 mb-6">
                        <button
                            onClick={handleSignOut}
                            className="w-full glass-card p-4 flex items-center justify-center gap-3 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500 focus-visible:outline-offset-2"
                        >
                            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                            <span className="font-semibold text-red-400">Sign Out</span>
                        </button>
                    </section>
                </>
            ) : (
                <section className="px-4 mb-6">
                    <div className="glass-card p-6 text-center">
                        <p className="text-[var(--text-muted)]">Not signed in</p>
                    </div>
                </section>
            )}

            {/* Version */}
            <section className="px-4">
                <p className="text-center text-xs text-[var(--text-muted)]">
                    Harmonic Beacon v1.0.0
                </p>
            </section>

            <BottomNav />
        </main>
    );
}
