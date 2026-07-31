/**
 * Public landing page and ticket login.
 * Phase 5: Wider layout, portal motif, bilingual control.
 *
 * Server component: fetches events from database.
 * Client components: LanguageControl, LoginClient.
 */

import Link from "next/link";

import { prisma } from "@/lib/db";
import { redactError } from "@/lib/redact";

import LoginClient from "./login/LoginClient";
import BrandLockup from "@/components/brand/BrandLockup";
import PortalOrbit from "@/components/brand/PortalOrbit";
import LanguageControl from "@/components/brand/LanguageControl";

export const dynamic = "force-dynamic";

type Lang = "es" | "en";

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

function formatDateOnly(at: Date, locale: string, timeZone: string): string {
    return new Intl.DateTimeFormat(locale, {
        weekday: "short",
        day: "numeric",
        month: "short",
        timeZone,
    }).format(at);
}

const COPY = {
    es: {
        eyebrow: "PROYECCIÓN ARMÓNICA · SESIÓN VIRTUAL",
        hero: ["El mito", "está vivo."],
        lead: "Una experiencia online en vivo para entrar en tu paisaje interior a través del cuerpo, el sonido y las imágenes que ya viven dentro tuyo.",
        portalLabel: "el regreso",
        portalSub: "PAGO → PRESENCIA",
        sessionsHeading: "ELEGÍ TU PORTAL",
        loginHeading: "¿YA TENÉS TU ENTRADA?",
        terms: "Términos y privacidad",
        staff: "Ingreso del equipo",
        crLabel: "COSTA RICA",
        arLabel: "ARGENTINA",
        utcLabel: "UTC",
        buyTicket: "Comprar entrada",
        salesSoon: "Las entradas se abren en breve.",
        unavailable: "Los horarios no están disponibles por el momento — tu código de entrada sigue funcionando.",
        noSessions: "No hay sesiones programadas por el momento. Volvé a consultar pronto.",
    },
    en: {
        eyebrow: "HARMONIC PROJECTION · VIRTUAL SESSION",
        hero: ["The myth", "is alive."],
        lead: "A live online experience to enter your inner landscape through body, sound and the images already living inside you.",
        portalLabel: "the return",
        portalSub: "PAYMENT → PRESENCE",
        sessionsHeading: "CHOOSE YOUR PORTAL",
        loginHeading: "ALREADY HAVE A TICKET?",
        terms: "Terms & privacy",
        staff: "Staff sign-in",
        crLabel: "COSTA RICA",
        arLabel: "ARGENTINA",
        utcLabel: "UTC",
        buyTicket: "Buy a ticket",
        salesSoon: "Ticket sales open shortly.",
        unavailable: "Session times are temporarily unavailable — your ticket code still works.",
        noSessions: "No sessions are currently scheduled. Check back soon.",
    },
} as const;

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
            <div className="relative z-10 mx-auto flex min-h-screen max-w-[1120px] flex-col gap-10 px-6 py-12">
                {/* Top bar */}
                <header className="flex items-center justify-between">
                    <BrandLockup />
                    <LanguageControl />
                </header>

                {/* Hero + Portal */}
                <section className="grid gap-8 lg:grid-cols-[1fr_0.72fr] lg:gap-12 items-center">
                    <div className="space-y-5">
                        <p className="flex items-center gap-2.5 text-[10px] font-mono uppercase tracking-[0.18em] text-[var(--gold)]">
                            <span className="inline-block h-1.5 w-1.5 rounded-full bg-[var(--pink)] shadow-[0_0_10px_var(--pink)]" />
                            <span data-copy="es">{COPY.es.eyebrow}</span>
                            <span data-copy="en">{COPY.en.eyebrow}</span>
                        </p>
                        <h1 className="font-serif text-[clamp(2.8rem,8vw,5rem)] font-normal leading-[0.85] tracking-[-0.04em] text-[var(--paper)]">
                            <span data-copy="es">{COPY.es.hero[0]}<br />
                                <em className="text-[var(--lime)] not-italic" style={{ textShadow: "0 0 28px rgba(200,255,122,0.25)" }}>
                                    {COPY.es.hero[1]}
                                </em>
                            </span>
                            <span data-copy="en">{COPY.en.hero[0]}<br />
                                <em className="text-[var(--lime)] not-italic" style={{ textShadow: "0 0 28px rgba(200,255,122,0.25)" }}>
                                    {COPY.en.hero[1]}
                                </em>
                            </span>
                        </h1>
                        <p className="max-w-md text-[15px] leading-[1.75] text-[var(--text-secondary)]">
                            <span data-copy="es">{COPY.es.lead}</span>
                            <span data-copy="en">{COPY.en.lead}</span>
                        </p>
                    </div>
                    <div className="flex justify-center lg:justify-end">
                        <PortalOrbit size="lg">
                            <div className="text-center">
                                <span className="block font-serif text-lg text-[var(--gold)]" data-copy="es">{COPY.es.portalLabel}</span>
                                <span className="block font-serif text-lg text-[var(--gold)]" data-copy="en">{COPY.en.portalLabel}</span>
                                <small className="block font-mono text-[9px] tracking-[0.15em] text-[var(--muted)] uppercase mt-1">
                                    <span data-copy="es">{COPY.es.portalSub}</span>
                                    <span data-copy="en">{COPY.en.portalSub}</span>
                                </small>
                            </div>
                        </PortalOrbit>
                    </div>
                </section>

                {/* Sessions */}
                <section className="space-y-5" aria-labelledby="events-heading">
                    <h2 id="events-heading" className="text-xs font-mono uppercase tracking-[0.14em] text-[var(--muted)]">
                        <span data-copy="es">{COPY.es.sessionsHeading}</span>
                        <span data-copy="en">{COPY.en.sessionsHeading}</span>
                    </h2>

                    {events === null ? (
                        <div className="event-alert event-alert--warning">
                            <span data-copy="en">{COPY.en.unavailable}</span>
                            <span data-copy="es">{COPY.es.unavailable}</span>
                        </div>
                    ) : events.length === 0 ? (
                        <div className="event-alert event-alert--info">
                            <span data-copy="en">{COPY.en.noSessions}</span>
                            <span data-copy="es">{COPY.es.noSessions}</span>
                        </div>
                    ) : (
                        <ul className="grid gap-4 md:grid-cols-2">
                            {events.map((event) => (
                                <li key={event.id} className="event-card">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-2">
                                            <p className="text-[11px] font-mono uppercase tracking-[0.11em] text-[var(--paper)]">
                                                {event.language === "ENGLISH" ? "English" : "Español"}
                                            </p>
                                            <p className="text-sm text-[var(--text-secondary)]">
                                                <span className="font-medium text-[var(--paper)]">Costa Rica: </span>
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

                                    <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                                        <p className="text-xs text-[var(--text-secondary)]">
                                            {event.language === "ENGLISH"
                                                ? "USD $50 Global North · USD $20 Global South"
                                                : "USD $50 Norte Global · USD $20 Sur Global"}
                                        </p>
                                        {purchaseUrlFor(event.language) ? (
                                            <a
                                                href={purchaseUrlFor(event.language)}
                                                className="event-button event-button--primary mt-3 inline-flex w-full text-center sm:w-auto"
                                                rel="noreferrer noopener"
                                                target="_blank"
                                            >
                                                <span data-copy="es">{COPY.es.buyTicket}</span>
                                                <span data-copy="en">{COPY.en.buyTicket}</span>
                                                <span aria-hidden="true" className="text-base">↗</span>
                                            </a>
                                        ) : (
                                            <p className="mt-3 text-xs text-[var(--text-muted)]">
                                                <span data-copy="es">{COPY.es.salesSoon}</span>
                                                <span data-copy="en">{COPY.en.salesSoon}</span>
                                            </p>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                {/* Login */}
                <section className="space-y-5" aria-labelledby="login-heading">
                    <h2 id="login-heading" className="text-xs font-mono uppercase tracking-[0.14em] text-[var(--muted)]">
                        <span data-copy="es">{COPY.es.loginHeading}</span>
                        <span data-copy="en">{COPY.en.loginHeading}</span>
                    </h2>
                    <div className="max-w-xl">
                        <LoginClient next={next} />
                    </div>
                </section>

                {/* Footer */}
                <footer className="mt-auto flex flex-wrap gap-x-5 gap-y-2 text-[11px] text-[var(--text-muted)]">
                    <a
                        href="https://harmonicbeacon.com/politica/"
                        className="underline underline-offset-2 transition-colors hover:text-[var(--paper)]"
                        rel="noreferrer noopener"
                        target="_blank"
                    >
                        <span data-copy="es">{COPY.es.terms}</span>
                        <span data-copy="en">{COPY.en.terms}</span>
                    </a>
                    <Link
                        href="/staff/login"
                        className="underline underline-offset-2 transition-colors hover:text-[var(--paper)]"
                    >
                        <span data-copy="es">{COPY.es.staff}</span>
                        <span data-copy="en">{COPY.en.staff}</span>
                    </Link>
                </footer>
            </div>
        </main>
    );
}
