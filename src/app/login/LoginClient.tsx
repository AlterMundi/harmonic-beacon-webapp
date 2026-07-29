"use client";

/**
 * The attendee login form: ticket code plus email, and nothing else.
 *
 * Rendered by the landing page at `/`, which is where the identity contract puts
 * it. It stays in this directory because `/login` is the address the old product
 * used and the file the auth strip is tracked against; `src/app/login/page.tsx`
 * now redirects there.
 *
 * Bilingual by showing both languages at once rather than by detecting one.
 * Session 1 is Spanish (morning) and Session 2 is English (afternoon), both Saturday, the two audiences
 * share this page, and an attendee who cannot read the half addressed to someone
 * else must still be able to get into the event they paid for.
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
                // `next` is already validated server-side; the ticket's own session
                // is the fallback so a first-time visitor still lands in the right
                // room without choosing one.
                router.push(next ?? `/session/${scheduledSessionId}`);
                // The cookie was set by the response, and the room page resolves it
                // server-side, so the router cache has to be dropped.
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
                <label htmlFor="ticket-code" className="block text-sm font-medium">
                    Ticket code
                    <span className="block text-xs text-[var(--text-secondary)]">Código de entrada</span>
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
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 font-mono tracking-wider"
                />
            </div>

            <div className="space-y-1">
                <label htmlFor="ticket-email" className="block text-sm font-medium">
                    Email used to buy the ticket
                    <span className="block text-xs text-[var(--text-secondary)]">
                        Correo con el que compraste la entrada
                    </span>
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
                    className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2"
                />
            </div>

            {error && (
                <p role="alert" className="text-sm text-[var(--danger-400,#fca5a5)]">
                    <span className="block">{MESSAGES[error].en}</span>
                    <span className="block opacity-80">{MESSAGES[error].es}</span>
                </p>
            )}

            <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-[var(--primary-600)] px-4 py-2.5 font-medium disabled:opacity-60"
            >
                {submitting ? "Signing in… / Ingresando…" : "Enter the event / Entrar al evento"}
            </button>

            <p className="text-xs text-[var(--text-secondary)]">
                Your ticket admits one person. The same code and email work again after a refresh or a dropped
                connection.
                <span className="block">
                    Tu entrada admite a una persona. El mismo código y correo funcionan de nuevo si recargás o se corta
                    la conexión.
                </span>
            </p>
        </form>
    );
}
