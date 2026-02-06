"use client";

import { useEffect } from "react";
import { signIn } from "next-auth/react";

export default function LoginClient() {
    useEffect(() => {
        signIn('zitadel', { callbackUrl: '/live' });
    }, []);

    return (
        <main className="min-h-screen flex items-center justify-center p-6">
            <div className="w-full max-w-md text-center">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-[var(--primary-600)] shadow-[0_0_30px_rgba(var(--primary-rgb),0.5)] animate-pulse" />
                <h1 className="text-2xl font-bold mb-2">Harmonic Beacon</h1>
                <p className="text-[var(--text-secondary)] mb-8">Redirecting to sign in...</p>
                <div className="w-8 h-8 border-2 border-[var(--primary-500)] border-t-transparent rounded-full animate-spin mx-auto" />
            </div>
        </main>
    );
}
