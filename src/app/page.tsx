/**
 * Public landing page and ticket login.
 * Phase 5: Wider layout and bilingual control.
 *
 * Server component: fetches events from database.
 * Client component: LoginClient.
 */

import Link from "next/link";

import { prisma } from "@/lib/db";
import { redactError } from "@/lib/redact";

import LoginClient from "./login/LoginClient";
import { messages } from "@/lib/i18n";
import { requestLocale } from "@/lib/i18n-server";
import { isPublicCycleSession } from "@/lib/public-cycle";
import { EventLocalTime, EventSchedule } from "@/components/events/EventSchedule";

export const dynamic = "force-dynamic";

type WeekendEvent = {
    id: string;
    title: string;
    description: string | null;
    language: "ENGLISH" | "SPANISH";
    scheduledAt: Date;
};

const INTERNAL_NEXT = /^\/session(\/[A-Za-z0-9_-]+)*$/;
// A missed lifecycle transition must not leave an old LIVE row advertising the
// current checkout indefinitely. Weekend sessions last hours, not days; 24
// hours keeps a delayed/extended live room discoverable while failing closed
// before a stale row can be presented as the next paid event.
const PUBLIC_LIVE_DISCOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function safeNext(raw: string | string[] | undefined): string | undefined {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && INTERNAL_NEXT.test(value) ? value : undefined;
}

async function weekendEvents(): Promise<WeekendEvent[] | null> {
    try {
        const now = new Date();
        const liveStartedAfter = new Date(now.getTime() - PUBLIC_LIVE_DISCOVERY_MAX_AGE_MS);

        return await prisma.scheduledSession.findMany({
            where: {
                isTest: false,
                endedAt: null,
                OR: [
                    { status: "SCHEDULED", scheduledAt: { gte: now } },
                    { status: "LIVE", startedAt: { gte: liveStartedAfter } },
                ],
            },
            orderBy: { scheduledAt: "asc" },
            select: {
                id: true,
                title: true,
                description: true,
                language: true,
                scheduledAt: true,
            },
        });
    } catch (error) {
        console.error(`[landing] could not load the event schedule: ${redactError(error)}`);
        return null;
    }
}

export default async function LandingPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const locale = await requestLocale();
    const copy = messages[locale].landing;
    const next = safeNext((await searchParams).next);
    const events = await weekendEvents();
    const hasTicketedEvents = events === null || events.some((event) => !isPublicCycleSession(event.id));
    const purchaseUrlSession1 = process.env.TICKET_PURCHASE_URL_SESSION_1 || process.env.TICKET_PURCHASE_URL;
    const purchaseUrlSession2 = process.env.TICKET_PURCHASE_URL_SESSION_2 || process.env.TICKET_PURCHASE_URL;
    const purchaseUrlFor = (language: string) =>
        language === "SPANISH" ? purchaseUrlSession1 : purchaseUrlSession2;

    return (
        <main className="event-shell">
            <div className="relative z-10 mx-auto flex min-h-screen max-w-[1120px] flex-col gap-10 px-6 py-12">
                {/* Hero */}
                <section className="py-2 lg:py-6">
                    <div className="max-w-2xl space-y-5">
                        <p className="hb-eyebrow flex items-center gap-2.5">
                            <span className="event-eyebrow-mark" aria-hidden="true" />
                            {copy.eyebrow}
                        </p>
                        <h1 className="font-serif text-[clamp(2.8rem,8vw,5rem)] font-normal leading-[0.9] tracking-[-0.025em] text-[var(--paper)]">
                            {copy.heroLead}<br />{" "}
                            <em className="event-hero-accent not-italic">
                                {copy.heroAccent}
                            </em>
                        </h1>
                        <p className="max-w-md text-[15px] leading-[1.75] text-[var(--text-secondary)]">
                            {copy.lead}
                        </p>
                    </div>
                </section>

                {/* Sessions */}
                <section className="space-y-5" aria-labelledby="events-heading">
                    <h2 id="events-heading" className="hb-section-label">
                        {copy.sessionsHeading}
                    </h2>

                    {events === null ? (
                        <div className="event-alert event-alert--warning">
                            {copy.unavailable}
                        </div>
                    ) : events.length === 0 ? (
                        <div className="event-alert event-alert--info">
                            {copy.noSessions}
                        </div>
                    ) : (
                        <EventSchedule locale={locale}>
                            <ul className="grid gap-4 md:grid-cols-2">
                                {events.map((event) => (
                                    <li key={event.id} className="event-card">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-2">
                                            <p className="event-card__label">
                                                {event.language === "ENGLISH" ? copy.english : copy.spanish}
                                            </p>
                                            {isPublicCycleSession(event.id) && (
                                                <>
                                                    <h3 className="font-serif text-xl text-[var(--paper)]">{event.title}</h3>
                                                    {event.description && (
                                                        <p className="text-xs leading-relaxed text-[var(--text-muted)]">{event.description}</p>
                                                    )}
                                                </>
                                            )}
                                            <EventLocalTime at={event.scheduledAt.toISOString()} />
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-mono text-[var(--text-secondary)]">
                                                {isPublicCycleSession(event.id) ? (locale === "en" ? "Free" : "Gratis") : (event.language === "ENGLISH" ? "US $50" : "US $20")}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                                        {isPublicCycleSession(event.id) ? (
                                            <a
                                                href={`/api/public-sessions/${event.id}/enter`}
                                                className="event-button event-button--primary mt-3 inline-flex w-full text-center sm:w-auto"
                                            >
                                                {locale === "en" ? "Enter event" : "Ingresar al evento"}
                                            </a>
                                        ) : purchaseUrlFor(event.language) ? (
                                            <a
                                                href={purchaseUrlFor(event.language)}
                                                className="event-button event-button--primary mt-3 inline-flex w-full text-center sm:w-auto"
                                                rel="noreferrer noopener"
                                                target="_blank"
                                            >
                                                {copy.buyTicket}
                                                <span aria-hidden="true" className="text-base">↗</span>
                                            </a>
                                        ) : (
                                            <p className="mt-3 text-xs text-[var(--text-muted)]">
                                                {copy.salesSoon}
                                            </p>
                                        )}
                                        {!isPublicCycleSession(event.id) && (
                                            <p className="mt-3 text-xs text-[var(--text-secondary)]">
                                                USD $50 {copy.globalNorth} · USD $20 {copy.globalSouth}
                                            </p>
                                        )}
                                    </div>
                                    </li>
                                ))}
                            </ul>
                        </EventSchedule>
                    )}
                </section>

                <section className="space-y-5" aria-labelledby="experience-heading">
                    <p className="hb-section-label">{copy.experienceEyebrow}</p>
                    <div className="event-card max-w-3xl">
                        <div className="max-w-2xl space-y-4">
                            <h2 id="experience-heading" className="font-serif text-3xl text-[var(--paper)] sm:text-4xl">
                                {copy.experienceHeading}
                            </h2>
                            <p className="text-sm leading-[1.75] text-[var(--text-secondary)]">
                                {copy.experienceBody}
                            </p>
                            <a
                                href="https://harmonicbeacon.com/proyeccion-armonica-del-mito/"
                                className="event-button event-button--secondary inline-flex w-full sm:w-auto"
                                rel="noreferrer noopener"
                                target="_blank"
                            >
                                {copy.experienceLink}
                                <span aria-hidden="true" className="text-base">↗</span>
                            </a>
                        </div>
                    </div>
                </section>

                {/* Login */}
                {hasTicketedEvents && <section className="space-y-5" aria-labelledby="login-heading">
                    <h2 id="login-heading" className="hb-section-label">
                        {copy.loginHeading}
                    </h2>
                    <div className="event-card max-w-xl">
                        <LoginClient next={next} />
                    </div>
                </section>}

                {/* Footer */}
                <footer className="mt-auto flex flex-wrap gap-x-5 gap-y-2 text-xs text-[var(--text-muted)]">
                    <a
                        href="https://harmonicbeacon.com/politica/"
                        className="underline underline-offset-2 transition-colors hover:text-[var(--paper)]"
                        rel="noreferrer noopener"
                        target="_blank"
                    >
                        {copy.terms}
                    </a>
                    <Link
                        href="/staff/login"
                        className="underline underline-offset-2 transition-colors hover:text-[var(--paper)]"
                    >
                        {copy.staff}
                    </Link>
                </footer>
            </div>
        </main>
    );
}
