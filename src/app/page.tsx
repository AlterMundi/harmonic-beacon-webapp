/**
 * Public landing page and ticket login.
 *
 * The one public surface: the two event times, where to buy, and the code + email
 * form. It never exposes a room token and it never asks the database who the
 * visitor is — the form's response does that. Purchase happens on the external
 * ticketing platform.
 *
 * Bilingual EN/ES on one page. Session 1 is Spanish and Session 2 is English,
 * both Saturday, both audiences arrive at the same URL, and a Spanish-speaking
 * attendee must be able to log in without reading English.
 *
 * VISUAL NOTE: The marketing site shows Spanish at 08:30 CR and English at 14:00 CR.
 * The app database comment says English is 12:30 CR. This discrepancy is reported
 * in the handoff for the event owner to confirm.
 */

import Link from "next/link";

import { prisma } from "@/lib/db";
import { redactError } from "@/lib/redact";

import LoginClient from "./login/LoginClient";
import BrandLockup from "@/components/brand/BrandLockup";

export const dynamic = "force-dynamic";

type WeekendEvent = {
    id: string;
    language: "ENGLISH" | "SPANISH";
    scheduledAt: Date;
};

const INTERNAL_NEXT = /^\/session(\/[A-Za-z0-9_-]+)*$/;

function safeNext(raw: string | string[] | undefined): string | undefined {
    const value = Array.isArray(raw) ? raw[0] : raw;
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

function formatTimeOnly(at: Date, locale: string, timeZone: string): string {
    return new Intl.DateTimeFormat(locale, {
        hour: "2-digit",
        minute: "2-digit",
        timeZone,
    }).format(at);
}

export default async function LandingPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const next = safeNext((await searchParams).next);
    const events = await weekendEvents();
    const purchaseUrlSession1 = process.env.TICKET_PURCHASE_URL_SESSION_1 || process.env.TICKET_PURCHASE_URL;
    const purchaseUrlSession2 = process.env.TICKET_PURCHASE_URL_SESSION_2 || process.env.TICKET_PURCHASE_URL;
    const purchaseUrlFor = (language: string) =>
        language === "SPANISH" ? purchaseUrlSession1 : purchaseUrlSession2;

    return (
        <main className="event-shell">
            <div className="relative z-10 mx-auto flex min-h-screen max-w-2xl flex-col gap-10 px-6 py-12">
                {/* Brand */}
                <header className="flex items-center justify-between">
                    <BrandLockup />
                </header>

                {/* Hero */}
                <section className="space-y-4">
                    <p className="flex items-center gap-2.5 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
                        <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--pink)] shadow-[0_0_10px_var(--pink)]" />
                        Harmonic Projection · Virtual Session
                    </p>
                    <h1 className="font-serif text-[clamp(2.8rem,8vw,5rem)] font-normal leading-[0.85] tracking-[-0.04em] text-[var(--cream)]">
                        The myth<br /><em className="text-[var(--lime)] not-italic" style={{ textShadow: "0 0 28px rgba(182,255,113,0.25)" }}>is alive.</em>
                    </h1>
                    <p className="max-w-md text-[15px] leading-[1.75] text-[var(--text-secondary)]">
                        A live online experience to enter your inner landscape through body, sound and the images already living inside you.
                        <span className="mt-1 block opacity-80">
                            Una experiencia online en vivo para entrar en tu paisaje interior a través del cuerpo, el sonido y las imágenes que ya viven dentro tuyo.
                        </span>
                    </p>
                </section>

                {/* Sessions */}
                <section className="space-y-4" aria-labelledby="events-heading">
                    <h2 id="events-heading" className="text-xs font-mono uppercase tracking-[0.14em] text-[var(--muted)]">
                        Choose your portal / Elegí tu portal
                    </h2>

                    {events === null ? (
                        <div className="event-alert event-alert--warning">
                            Session times are temporarily unavailable — your ticket code still works.
                            <span className="mt-1 block opacity-80">
                                Los horarios no están disponibles por el momento — tu código de entrada sigue funcionando.
                            </span>
                        </div>
                    ) : events.length === 0 ? (
                        <div className="event-alert event-alert--info">
                            No sessions are currently scheduled. Check back soon.
                            <span className="mt-1 block opacity-80">
                                No hay sesiones programadas por el momento. Volvé a consultar pronto.
                            </span>
                        </div>
                    ) : (
                        <ul className="space-y-4">
                            {events.map((event) => (
                                <li key={event.id} className="event-card">
                                    <div className="flex flex-wrap items-start justify-between gap-3">
                                        <div className="space-y-1">
                                            <p className="text-[11px] font-mono uppercase tracking-[0.11em] text-[var(--cream)]">
                                                {event.language === "ENGLISH" ? "English" : "Español"}
                                            </p>
                                            <p className="text-sm text-[var(--text-secondary)]">
                                                <span className="font-medium text-[var(--cream)]">Costa Rica: </span>
                                                {formatEventTime(event.scheduledAt, event.language === "ENGLISH" ? "en-US" : "es-CR", "America/Costa_Rica")}
                                            </p>
                                            <p className="text-xs text-[var(--text-muted)]">
                                                <span className="font-medium">Argentina: </span>
                                                {formatEventTime(event.scheduledAt, event.language === "ENGLISH" ? "en-GB" : "es-AR", "America/Argentina/Buenos_Aires")}
                                            </p>
                                            <p className="text-xs text-[var(--text-muted)]">
                                                <span className="font-medium">UTC: </span>
                                                {formatEventTime(event.scheduledAt, event.language === "ENGLISH" ? "en-GB" : "es-AR", "UTC")}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-mono text-lg font-normal text-[var(--gold)]">
                                                {formatTimeOnly(event.scheduledAt, event.language === "ENGLISH" ? "en-US" : "es-CR", "America/Costa_Rica")}
                                            </p>
                                            <p className="text-[10px] font-mono text-[var(--cyan)]">
                                                {event.language === "ENGLISH" ? "US $50" : "US $20"}
                                            </p>
                                        </div>
                                    </div>

                                    <p className="mt-3 text-xs text-[var(--text-secondary)]">
                                        {event.language === "ENGLISH"
                                            ? "Tickets: USD $50 Global North · USD $20 Global South"
                                            : "Entradas: USD $50 Norte Global · USD $20 Sur Global"}
                                    </p>

                                    {purchaseUrlFor(event.language) ? (
                                        <a
                                            href={purchaseUrlFor(event.language)}
                                            className="event-button event-button--primary mt-4 inline-flex w-full text-center sm:w-auto"
                                            rel="noreferrer noopener"
                                            target="_blank"
                                        >
                                            {event.language === "ENGLISH" ? "Buy a ticket" : "Comprar entrada"}
                                            <span aria-hidden="true" className="text-base">↗</span>
                                        </a>
                                    ) : (
                                        <p className="mt-3 text-xs text-[var(--text-muted)]">
                                            {event.language === "ENGLISH"
                                                ? "Ticket sales open shortly."
                                                : "Las entradas se abren en breve."}
                                        </p>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                {/* Login */}
                <section className="space-y-4" aria-labelledby="login-heading">
                    <h2 id="login-heading" className="text-xs font-mono uppercase tracking-[0.14em] text-[var(--muted)]">
                        Already have a ticket? / ¿Ya tenés tu entrada?
                    </h2>
                    <LoginClient next={next} />
                </section>

                {/* Footer */}
                <footer className="mt-auto flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-[var(--text-muted)]">
                    <a
                        href="https://harmonicbeacon.com/politica/"
                        className="underline underline-offset-2 transition-colors hover:text-[var(--cream)]"
                        rel="noreferrer noopener"
                        target="_blank"
                    >
                        Terms &amp; privacy / Términos y privacidad
                    </a>
                    <Link
                        href="/staff/login"
                        className="underline underline-offset-2 transition-colors hover:text-[var(--cream)]"
                    >
                        Staff sign-in / Ingreso del equipo
                    </Link>
                </footer>
            </div>
        </main>
    );
}
