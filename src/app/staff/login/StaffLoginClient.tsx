"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/context/LocaleContext";

type MessageKey = "rejected" | "rateLimited" | "unavailable" | "required";

export default function StaffLoginClient() {
    const router = useRouter();
    const { copy } = useLocale();
    const messages = copy.staffLogin;
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
                const result = (await response.json()) as { landing?: unknown };
                const landing = typeof result.landing === "string" &&
                    result.landing.startsWith("/ops/")
                    ? result.landing
                    : "/ops/events";
                setPassword("");
                router.push(landing);
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
        <form onSubmit={onSubmit} className="space-y-5" noValidate>
            <div className="space-y-1.5">
                <label htmlFor="staff-email" className="block text-sm font-medium text-[var(--paper)]">
                    {messages.email}
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
                    className="event-field"
                    aria-describedby="staff-email-hint"
                />
                <p id="staff-email-hint" className="text-xs text-[var(--text-muted)]">
                    {messages.emailHint}
                </p>
            </div>

            <div className="space-y-1.5">
                <label htmlFor="staff-password" className="block text-sm font-medium text-[var(--paper)]">
                    {messages.password}
                </label>
                <input
                    id="staff-password"
                    name="password"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    autoComplete="current-password"
                    className="event-field"
                    aria-describedby="staff-password-hint"
                />
                <p id="staff-password-hint" className="text-xs text-[var(--text-muted)]">
                    {messages.passwordHint}
                </p>
            </div>

            {error && (
                <div role="alert" className="event-alert event-alert--danger" aria-live="polite">
                    {messages[error]}
                </div>
            )}

            <button
                type="submit"
                disabled={submitting}
                className="event-button event-button--primary w-full"
                aria-busy={submitting}
            >
                {submitting ? messages.signingIn : messages.signIn}
            </button>
        </form>
    );
}
