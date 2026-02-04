"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { BottomNav } from "@/components";
import { useAuth } from "@/context/AuthContext";

export default function ProfilePage() {
    const router = useRouter();
    const { user, signOut, isLoading } = useAuth();

    const handleSignOut = async () => {
        await signOut();
        router.push('/login');
    };

    if (isLoading) {
        return (
            <main className="min-h-screen pb-28 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full mx-auto mb-4"></div>
                    <p className="text-[var(--text-muted)]">Loading...</p>
                </div>
            </main>
        );
    }

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
                                {user.user_metadata?.avatar_url ? (
                                    <img
                                        src={user.user_metadata.avatar_url}
                                        alt="Profile"
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                                    </svg>
                                )}
                            </div>
                            <div>
                                <p className="text-xs text-[var(--text-secondary)]">Welcome back,</p>
                                <p className="font-semibold">
                                    {user.user_metadata?.full_name || user.user_metadata?.display_name || user.email || 'User'}
                                </p>
                                {user.email && (
                                    <p className="text-xs text-[var(--text-muted)] mt-0.5">{user.email}</p>
                                )}
                            </div>
                        </div>
                    </section>

                    {/* Menu Items */}
                    <section className="px-4 mb-6">
                        <div className="glass-card overflow-hidden">
                            <button className="w-full flex items-center gap-4 p-4 border-b border-[var(--border-subtle)] hover:bg-white/5 transition-colors">
                                <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    </svg>
                                </div>
                                <span className="flex-1 text-left">App Settings</span>
                            </button>

                            <button className="w-full flex items-center gap-4 p-4 hover:bg-white/5 transition-colors">
                                <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                                    </svg>
                                </div>
                                <span className="flex-1 text-left">Your Stats</span>
                            </button>
                        </div>
                    </section>

                    {/* Sign Out Button */}
                    <section className="px-4 mb-6">
                        <button
                            onClick={handleSignOut}
                            className="w-full glass-card p-4 flex items-center justify-center gap-3 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 transition-colors"
                        >
                            <svg className="w-5 h-5 text-red-400" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                            </svg>
                            <span className="font-semibold text-red-400">Sign Out</span>
                        </button>
                    </section>
                </>
            ) : (
                <>
                    {/* Sign In CTA */}
                    <section className="px-4 mb-6">
                        <div className="glass-card p-6 text-center">
                            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-[var(--primary-600)] to-[var(--primary-800)] flex items-center justify-center">
                                <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                                </svg>
                            </div>
                            <h2 className="text-xl font-semibold mb-2">Welcome to Harmonic Beacon</h2>
                            <p className="text-sm text-[var(--text-muted)] mb-6">
                                Sign in to track your progress and sync across devices
                            </p>
                            <div className="flex flex-col gap-3">
                                <Link href="/login" className="btn-primary w-full py-3 text-center">
                                    Sign In
                                </Link>
                                <Link href="/signup" className="btn-secondary w-full py-3 text-center">
                                    Create Account
                                </Link>
                            </div>
                        </div>
                    </section>
                </>
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
