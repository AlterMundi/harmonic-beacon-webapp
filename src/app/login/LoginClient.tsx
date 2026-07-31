"use client";

/**
 * The attendee login form: ticket code plus email.
 * Phase 5: Bilingual via LanguageControl, refined states.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

const MESSAGES = {
    rejected: {
        en: "That code and email do not match an active ticket. Check both, exactly as they appear in your ticket email.",
        es: "Ese código y ese correo no coinciden con una entrada activa. Revisá ambos, tal como aparecen en el correo de tu entrada.",
    },
    rateLimited: {
        en: "Too many attempts. Please wait a few minutes and try again.",
        es: "Demasiados intentos. Esperá unos minutos y volvé a intentar.",
    },
    unavailable: {
        en: "Sign-in is unavailable right now. Please try again in a moment.",
        es: "El ingreso no está disponible en este momento. Probá de nuevo en un momento.",
    },
    required: {
        en: "Enter your ticket code and the email you used to buy it.",
        es: "Ingresá tu código de entrada y el correo con el que la compraste.",
    },
} as const;

type MessageKey = keyof typeof MESSAGES;

export default function LoginClient({ next }: { next?: string }) {
    const router = useRouter();
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
                body: JSON.stringify({ code, email }),
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
                <label htmlFor="ticket-code" className="block text-sm font-medium text-[var(--paper)]">
                    <span data-copy="en">Ticket code</span>
                    <span data-copy="es">Código de entrada</span>
                </label>
                <input
                    id="ticket-code"
                    name="code"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    className="event-field font-mono tracking-wider"
                    aria-describedby="ticket-code-hint"
                />
                <p id="ticket-code-hint" className="text-xs text-[var(--text-muted)]">
                    <span data-copy="en">Exactly as it appears in your ticket email</span>
                    <span data-copy="es">Exactamente como aparece en el correo de tu entrada</span>
                </p>
            </div>

            <div className="space-y-1.5">
                <label htmlFor="ticket-email" className="block text-sm font-medium text-[var(--paper)]">
                    <span data-copy="en">Email used to buy the ticket</span>
                    <span data-copy="es">Correo con el que compraste la entrada</span>
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
                    <span data-copy="en" className="block">{MESSAGES[error].en}</span>
                    <span data-copy="es" className="block">{MESSAGES[error].es}</span>
                </div>
            )}

            <button
                type="submit"
                disabled={submitting}
                className="event-button event-button--primary w-full"
                aria-busy={submitting}
            >
                <span data-copy="en">{submitting ? "Signing in…" : "Enter the event"}</span>
                <span data-copy="es">{submitting ? "Ingresando…" : "Entrar al evento"}</span>
            </button>

            <p className="text-[11px] leading-relaxed text-[var(--text-muted)]">
                <span data-copy="en">
                    Your ticket admits one person. The same code and email work again after a refresh or a dropped connection.
                </span>
                <span data-copy="es">
                    Tu entrada admite a una persona. El mismo código y correo funcionan de nuevo si recargás o se corta la conexión.
                </span>
            </p>
        </form>
    );
}
