"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Where an operator goes after signing in. */
const OPERATOR_HOME = "/ops/health";

const MESSAGES = {
    rejected: "Those credentials are not valid.",
    rateLimited: "Too many attempts. Wait a few minutes and try again.",
    unavailable: "Sign-in is unavailable right now. Try again in a moment.",
    required: "Enter your staff email and password.",
} as const;

type MessageKey = keyof typeof MESSAGES;

export default function StaffLoginClient() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<MessageKey | null>(null);

    async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting) return;

        setSubmitting(true);
        setError(null);

        try {
            const response = await fetch("/api/auth/staff", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });

            if (response.ok) {
                setPassword("");
                router.push(OPERATOR_HOME);
                router.refresh();
                return;
            }

            setError(
                response.status === 429
                    ? "rateLimited"
                    : response.status === 400
                        ? "required"
                        : response.status >= 500
                            ? "unavailable"
                            : "rejected",
            );
        } catch {
            setError("unavailable");
        } finally {
            setSubmitting(false);
        }
    }

    return (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <div className="space-y-1">
                <label htmlFor="staff-email" className="block text-sm font-medium">
                    Staff email
                </label>
                <input
                    id="staff-email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    autoComplete="username"
                    spellCheck={false}
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2"
                />
            </div>

            <div className="space-y-1">
                <label htmlFor="staff-password" className="block text-sm font-medium">
                    Password
                </label>
                <input
                    id="staff-password"
                    name="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    autoComplete="current-password"
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2"
                />
            </div>

            {error && (
                <p role="alert" className="text-sm text-[var(--danger-400,#fca5a5)]">
                    {MESSAGES[error]}
                </p>
            )}

            <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-[var(--primary-600)] px-4 py-2.5 font-medium disabled:opacity-60"
            >
                {submitting ? "Signing in…" : "Sign in"}
            </button>
        </form>
    );
}
