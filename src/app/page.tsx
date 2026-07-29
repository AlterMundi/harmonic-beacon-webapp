/**
 * Public landing page and ticket login.
 *
 * The one public surface: the two event times, where to buy, and the code + email
 * form. It never exposes a room token and it never asks the database who the
 * visitor is — the form's response does that. Purchase happens on the external
 * ticketing platform.
 *
 * Bilingual EN/ES on one page. Session 1 is Spanish (8:30 AM Costa Rica) and Session 2 is English (12:30 PM Costa Rica), both Saturday, both
 * audiences arrive at the same URL, and a Spanish-speaking attendee must be able
 * to log in without reading English.
 */

import Link from "next/link";

import { prisma } from "@/lib/db";
import { redactError } from "@/lib/redact";

import LoginClient from "./login/LoginClient";

// The event list comes from the database and the page sets a session cookie, so
// there is nothing here to prerender or cache at the edge.
export const dynamic = "force-dynamic";

type WeekendEvent = {
    id: string;
    language: "ENGLISH" | "SPANISH";
    scheduledAt: Date;
};

/**
 * Where `middleware.ts` sends an attendee who reached a room without a cookie:
 * `/session` or `/session/<id>`, and nothing else. No dots, so no `..` segment
 * can walk the path back up to another surface after the check passes.
 */
const INTERNAL_NEXT = /^\/session(\/[A-Za-z0-9_-]+)*$/;

function safeNext(raw: string | string[] | undefined): string | undefined {
    const value = Array.isArray(raw) ? raw[0] : raw;
    // Anything else — a protocol-relative URL, a host, a backslash, a traversal —
    // is dropped rather than corrected, so a crafted login link cannot redirect
    // an attendee anywhere except into a room.
    return value && INTERNAL_NEXT.test(value) ? value : undefined;
}

async function weekendEvents(): Promise<WeekendEvent[] | null> {
    try {
        return await prisma.scheduledSession.findMany({
            where: { status: { in: ["SCHEDULED", "LIVE"] } },
            orderBy: { scheduledAt: "asc" },
            select: { id: true, language: true, scheduledAt: true },
        });
    } catch (error) {
        // The form still works without this list: it needs the database, but the
        // attendee holding a code does not need us to render the schedule first.
        console.error(`[landing] could not load the event schedule: ${redactError(error)}`);
        return null;
    }
}

function formatEventTime(at: Date, locale: string, timeZone: string): string {
    return new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
        timeZoneName: "short",
    }).format(at);
}

export default async function LandingPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const next = safeNext((await searchParams).next);
    const events = await weekendEvents();
    // TBD until WS6-01 proves the payout rail and WS6-02 configures the two
    // events; ticket sales stay closed until then.
    const purchaseUrl = process.env.TICKET_PURCHASE_URL;

    return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-12">
            <header className="space-y-2">
                <h1 className="text-3xl font-bold">Harmonic Beacon</h1>
                <p className="text-[var(--text-secondary)]">
                    A live psychodrama session with Julián, held twice this weekend.
                    <span className="block">
                        Una sesión de psicodrama en vivo con Julián, en dos encuentros este fin de semana.
                    </span>
                </p>
            </header>

            <section className="space-y-3" aria-labelledby="events-heading">
                <h2 id="events-heading" className="text-lg font-semibold">
                    The two sessions <span className="text-[var(--text-secondary)]">/ Los dos encuentros</span>
                </h2>

                {events === null ? (
                    <p className="text-sm text-[var(--text-secondary)]">
                        Session times are temporarily unavailable — your ticket code still works.
                        <span className="block">
                            Los horarios no están disponibles por el momento — tu código de entrada sigue funcionando.
                        </span>
                    </p>
                ) : (
                    <ul className="space-y-3">
                        {events.map((event) => (
                            <li key={event.id} className="rounded-lg border border-white/10 bg-black/20 p-4">
                                <p className="font-medium">
                                    {event.language === "ENGLISH" ? "In English" : "En español"}
                                </p>
                                <p className="text-sm">
                                    {formatEventTime(
                                        event.scheduledAt,
                                        event.language === "ENGLISH" ? "en-GB" : "es-AR",
                                        "America/Argentina/Buenos_Aires",
                                    )}
                                </p>
                                <p className="text-sm text-[var(--text-secondary)]">
                                    {formatEventTime(
                                        event.scheduledAt,
                                        event.language === "ENGLISH" ? "en-GB" : "es-AR",
                                        "UTC",
                                    )}
                                </p>
                            </li>
                        ))}
                    </ul>
                )}

                {purchaseUrl ? (
                    <a
                        href={purchaseUrl}
                        className="inline-block text-sm underline"
                        rel="noreferrer noopener"
                        target="_blank"
                    >
                        Buy a ticket <span className="text-[var(--text-secondary)]">/ Comprar una entrada</span>
                    </a>
                ) : (
                    <p className="text-sm text-[var(--text-secondary)]">
                        Ticket sales open shortly. <span>Las entradas se abren en breve.</span>
                    </p>
                )}
            </section>

            <section className="space-y-3" aria-labelledby="login-heading">
                <h2 id="login-heading" className="text-lg font-semibold">
                    Already have a ticket? <span className="text-[var(--text-secondary)]">/ ¿Ya tenés tu entrada?</span>
                </h2>
                <LoginClient next={next} />
            </section>

            <footer className="mt-auto text-xs text-[var(--text-secondary)]">
                <Link href="/staff/login" className="underline">
                    Staff sign-in <span>/ Ingreso del equipo</span>
                </Link>
            </footer>
        </main>
    );
}
