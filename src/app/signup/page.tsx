"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function SignupPage() {
    const router = useRouter();
    const { signUp, signInWithGoogle } = useAuth();
    const [displayName, setDisplayName] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [isSocialLoading, setIsSocialLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleSignup = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!displayName.trim()) {
            setError("Please enter your name");
            return;
        }
        if (!email.trim()) {
            setError("Please enter your email");
            return;
        }
        if (!password) {
            setError("Please enter a password");
            return;
        }
        if (password.length < 6) {
            setError("Password must be at least 6 characters");
            return;
        }
        if (password !== confirmPassword) {
            setError("Passwords do not match");
            return;
        }

        setError(null);
        setIsLoading(true);

        const { error: authError } = await signUp(email.trim(), password, displayName.trim());

        setIsLoading(false);

        if (authError) {
            setError(authError);
        } else {
            router.push("/live");
        }
    };

    const handleGoogleSignIn = async () => {
        setError(null);
        setIsSocialLoading(true);

        const { error: authError } = await signInWithGoogle();

        setIsSocialLoading(false);

        if (authError) {
            setError(authError);
        }
    };

    const isDisabled = isLoading || isSocialLoading;

    return (
        <main className="min-h-screen flex items-center justify-center p-6">
            <div className="w-full max-w-md">
                {/* Header */}
                <div className="text-center mb-12">
                    <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[var(--primary-600)] shadow-[0_0_30px_rgba(var(--primary-rgb),0.5)]"></div>
                    <h1 className="text-3xl font-bold mb-2">Create Account</h1>
                    <p className="text-[var(--text-secondary)]">Join the harmonic journey</p>
                </div>

                {/* Form */}
                <form onSubmit={handleSignup} className="space-y-4">
                    {error && (
                        <div className="glass-card p-3 border border-red-500/30 bg-red-500/10">
                            <p className="text-red-400 text-sm text-center">{error}</p>
                        </div>
                    )}

                    <div className="glass-card p-4 flex items-center gap-3">
                        <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <input
                            type="text"
                            name="displayName"
                            autoComplete="name"
                            placeholder="Display Name"
                            value={displayName}
                            onChange={(e) => setDisplayName(e.target.value)}
                            disabled={isDisabled}
                            className="flex-1 bg-transparent text-white placeholder-[var(--text-muted)] focus-ring"
                        />
                    </div>

                    <div className="glass-card p-4 flex items-center gap-3">
                        <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <input
                            type="email"
                            name="email"
                            autoComplete="email"
                            placeholder="Email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            disabled={isDisabled}
                            className="flex-1 bg-transparent text-white placeholder-[var(--text-muted)] focus-ring"
                        />
                    </div>

                    <div className="glass-card p-4 flex items-center gap-3">
                        <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <input
                            type="password"
                            name="password"
                            autoComplete="new-password"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            disabled={isDisabled}
                            className="flex-1 bg-transparent text-white placeholder-[var(--text-muted)] focus-ring"
                        />
                    </div>

                    <div className="glass-card p-4 flex items-center gap-3">
                        <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <input
                            type="password"
                            name="confirmPassword"
                            autoComplete="new-password"
                            placeholder="Confirm Password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            disabled={isDisabled}
                            className="flex-1 bg-transparent text-white placeholder-[var(--text-muted)] focus-ring"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isDisabled}
                        className="btn-primary w-full py-4 flex items-center justify-center gap-2 disabled:opacity-60"
                    >
                        {isLoading ? (
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            <>
                                <span>Create Account</span>
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                                </svg>
                            </>
                        )}
                    </button>

                    {/* Divider */}
                    <div className="flex items-center gap-4 my-6">
                        <div className="flex-1 h-px bg-[var(--border-subtle)]"></div>
                        <span className="text-sm text-[var(--text-muted)]">or continue with</span>
                        <div className="flex-1 h-px bg-[var(--border-subtle)]"></div>
                    </div>

                    {/* Social Login */}
                    <button
                        type="button"
                        onClick={handleGoogleSignIn}
                        disabled={isDisabled}
                        className="w-full glass-card p-4 flex items-center justify-center gap-3 hover:bg-white/10 transition-colors disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--primary-500)] focus-visible:outline-offset-2"
                    >
                        {isSocialLoading ? (
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        ) : (
                            <>
                                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                                </svg>
                                <span>Google</span>
                            </>
                        )}
                    </button>
                </form>

                {/* Footer */}
                <div className="text-center mt-8">
                    <p className="text-sm text-[var(--text-secondary)]">
                        Already have an account?{" "}
                        <Link href="/login" className="text-[var(--primary-400)] font-semibold hover:text-[var(--primary-300)]">
                            Sign In
                        </Link>
                    </p>
                </div>
            </div>
        </main>
    );
}
