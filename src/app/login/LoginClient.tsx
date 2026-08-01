"use client";

/**
 * The attendee login form: ticket code plus email.
 * Phase 5: Bilingual via LanguageControl, refined states.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/context/LocaleContext";

type MessageKey = "rejected" | "rateLimited" | "unavailable" | "required";

export default function LoginClient({ next }: { next?: string }) {
    const router = useRouter();
    const { copy } = useLocale();
    const messages = copy.ticketLogin;
    const [name, setName] = useState("");
    const [code, setCode] = useState("");
    const [email, setEmail] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<MessageKey | null>(null);

    async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (submitting) return;

        setSubmitting(true);
        setError(null);

        try {
            const response = await fetch("/api/auth/ticket", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, code, email }),
            });

            if (response.ok) {
                const { scheduledSessionId } = (await response.json()) as { scheduledSessionId: string };
                router.push(next ?? `/session/${scheduledSessionId}`);
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
                <label htmlFor="display-name" className="block text-sm font-medium text-[var(--paper)]">
                    {messages.displayName}
                </label>
                <input
                    id="display-name"
                    name="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    maxLength={60}
                    autoComplete="name"
                    className="event-field"
                />
            </div>

            <div className="space-y-1.5">
                <label htmlFor="ticket-code" className="block text-sm font-medium text-[var(--paper)]">
                    {messages.ticketCode}
                </label>
                <input
                    id="ticket-code"
                    name="code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                    autoComplete="off"
                    autoCapitalize="characters"
                    maxLength={80}
                    placeholder="HB1-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
                    spellCheck={false}
                    className="event-field font-mono tracking-wider"
                    aria-describedby="ticket-code-hint"
                />
                <p id="ticket-code-hint" className="text-xs text-[var(--text-muted)]">
                    {messages.ticketCodeHint}
                </p>
            </div>

            <div className="space-y-1.5">
                <label htmlFor="ticket-email" className="block text-sm font-medium text-[var(--paper)]">
                    {messages.email}
                </label>
                <input
                    id="ticket-email"
                    name="email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                    autoComplete="email"
                    spellCheck={false}
                    className="event-field"
                />
            </div>

            {error && (
                <div role="alert" className="event-alert event-alert--danger">
                    {messages[error]}
                </div>
            )}

            <button
                type="submit"
                disabled={submitting}
                className="event-button event-button--primary w-full"
                aria-busy={submitting}
            >
                {submitting ? messages.signingIn : messages.enter}
            </button>

            <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                {messages.reconnectHint}
            </p>
        </form>
    );
}
