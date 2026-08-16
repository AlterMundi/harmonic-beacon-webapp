/**
 * Public landing page and ticket login.
 * Phase 5: Wider layout and bilingual control.
 *
 * Server component: fetches events from database.
 * Client components: LanguageControl, LoginClient.
 */

import Link from "next/link";

import { prisma } from "@/lib/db";
import { redactError } from "@/lib/redact";

import LoginClient from "./login/LoginClient";
import BrandLockup from "@/components/brand/BrandLockup";
import LanguageControl from "@/components/brand/LanguageControl";
import { messages } from "@/lib/i18n";
import { requestLocale } from "@/lib/i18n-server";

export const dynamic = "force-dynamic";

type WeekendEvent = {
    id: string;
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
    const locale = await requestLocale();
    const copy = messages[locale].landing;
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

                {/* Hero */}
                <section className="py-2 lg:py-6">
                    <div className="max-w-2xl space-y-5">
                        <p className="hb-eyebrow flex items-center gap-2.5">
                            <span className="event-eyebrow-mark" aria-hidden="true" />
                            {copy.eyebrow}
                        </p>
                        <h1 className="font-serif text-[clamp(2.8rem,8vw,5rem)] font-normal leading-[0.9] tracking-[-0.025em] text-[var(--paper)]">
                            {copy.heroLead}<br />
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
                        <ul className="grid gap-4 md:grid-cols-2">
                            {events.map((event) => (
                                <li key={event.id} className="event-card">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-2">
                                            <p className="event-card__label">
                                                {event.language === "ENGLISH" ? copy.english : copy.spanish}
                                            </p>
                                            <p className="text-sm text-[var(--text-secondary)]">
                                                <span className="font-medium text-[var(--paper)]">{copy.costaRica}: </span>
                                                {formatEventTime(event.scheduledAt, locale === "en" ? "en-US" : "es-CR", "America/Costa_Rica")}
                                            </p>
                                            <p className="text-xs text-[var(--text-muted)]">
                                                <span className="font-medium">{copy.argentina}: </span>
                                                {formatEventTime(event.scheduledAt, locale === "en" ? "en-GB" : "es-AR", "America/Argentina/Buenos_Aires")}
                                            </p>
                                            <p className="text-xs text-[var(--text-muted)]">
                                                <span className="font-medium">UTC: </span>
                                                {formatEventTime(event.scheduledAt, locale === "en" ? "en-GB" : "es-AR", "UTC")}
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <p className="font-mono text-lg font-normal text-[var(--gold)]">
                                                {formatTimeOnly(event.scheduledAt, locale === "en" ? "en-US" : "es-CR", "America/Costa_Rica")}
                                            </p>
                                            <p className="text-xs font-mono text-[var(--text-secondary)]">
                                                {event.language === "ENGLISH" ? "US $50" : "US $20"}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                                        <p className="text-xs text-[var(--text-secondary)]">
                                            USD $50 {copy.globalNorth} · USD $20 {copy.globalSouth}
                                        </p>
                                        {purchaseUrlFor(event.language) ? (
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
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>

                {/* Login */}
                <section className="space-y-5" aria-labelledby="login-heading">
                    <h2 id="login-heading" className="hb-section-label">
                        {copy.loginHeading}
                    </h2>
                    <div className="event-card event-entry-panel max-w-xl">
                        <LoginClient next={next} />
                    </div>
                </section>

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
