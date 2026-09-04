/**
 * Public landing page and ticket login.
 * Phase 5: Wider layout and bilingual control.
 *
 * Server component: fetches events from database.
 * Client component: LoginClient.
 */

import Link from "next/link";

import { EventLocalTime, EventSchedule } from "@/components/events/EventSchedule";
import { prisma } from "@/lib/db";
import { isPublicCycleSession } from "@/lib/public-cycle";
import { redactError } from "@/lib/redact";

import LoginClient from "./login/LoginClient";
import { messages } from "@/lib/i18n";
import { requestLocale } from "@/lib/i18n-server";
import { beaconAccountEnabled } from "@/lib/account-rp";
import { currentAccountIdentity } from "@/lib/principal";

export const dynamic = "force-dynamic";

type WeekendEvent = {
    id: string;
    title: string;
    description: string | null;
    language: "ENGLISH" | "SPANISH";
    scheduledAt: Date;
    publicAccess: boolean;
};

const INTERNAL_NEXT = /^\/session(\/[A-Za-z0-9_-]+)*$/;
// Rollout-safe editorial override: normalize only the legacy stored times.
// Once scheduled_at is migrated to the canonical value, this becomes a no-op
// so the app cannot show 15:00 while old and new revisions overlap.
const LANDING_1400_ART_SCHEDULES = new Map([
    ['50000000-0000-4000-8000-202609050001', {
        legacy: '2026-09-05T16:00:00.000Z',
        canonical: '2026-09-05T17:00:00.000Z',
    }],
    ['50000000-0000-4000-8000-202609120001', {
        legacy: '2026-09-12T16:00:00.000Z',
        canonical: '2026-09-12T17:00:00.000Z',
    }],
]);
// A missed lifecycle transition must not leave an old LIVE row advertising the
// current checkout indefinitely. Weekend sessions last hours, not days; 24
// hours keeps a delayed/extended live room discoverable while failing closed
// before a stale row can be presented as the next paid event.
const PUBLIC_LIVE_DISCOVERY_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function landingDisplayTime(event: Pick<WeekendEvent, 'id' | 'scheduledAt'>): string {
    const stored = event.scheduledAt.toISOString();
    const schedule = LANDING_1400_ART_SCHEDULES.get(event.id);
    return schedule?.legacy === stored ? schedule.canonical : stored;
}

function publicScheduleNow(): Date {
    const pinned = process.env.E2E_DASHBOARD_ENABLED === '1'
        ? process.env.E2E_CLOCK_NOW?.trim()
        : undefined;
    if (!pinned) return new Date();

    const now = new Date(pinned);
    if (Number.isNaN(now.getTime())) {
        throw new Error('E2E_CLOCK_NOW must be an ISO-8601 timestamp');
    }
    return now;
}

function safeNext(raw: string | string[] | undefined): string | undefined {
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && INTERNAL_NEXT.test(value) ? value : undefined;
}

async function weekendEvents(): Promise<WeekendEvent[] | null> {
    try {
        // Browser gates pin their own clock so a real event crossing its start
        // time cannot change the fixture landing halfway through CI. The pin is
        // ignored unless the already test-only dashboard gate is enabled.
        const now = publicScheduleNow();
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
                publicAccess: true,
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
    const params = await searchParams;
    const next = safeNext(params.next);
    const accountEnabled = beaconAccountEnabled();
    const account = accountEnabled
        ? await currentAccountIdentity().catch(() => null)
        : null;
    const accountError = params.account_error === '1';
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
                                {events.map((event) => {
                                    const publicCycle = isPublicCycleSession(event.id);
                                    return (
                                <li key={event.id} className="event-card">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="space-y-2">
                                            <p className="event-card__label">
                                                {event.language === "ENGLISH" ? copy.english : copy.spanish}
                                            </p>
                                            {publicCycle && (
                                                <>
                                                    <h3 className="font-serif text-xl text-[var(--paper)]">{event.title}</h3>
                                                    {event.description && (
                                                        <p className="text-xs leading-relaxed text-[var(--text-muted)]">{event.description}</p>
                                                    )}
                                                </>
                                            )}
                                            <EventLocalTime at={landingDisplayTime(event)} />
                                        </div>
                                        <div className="text-right">
                                            <p className="text-xs font-mono text-[var(--text-secondary)]">
                                                {publicCycle ? (locale === 'en' ? 'Free' : 'Gratis') : (event.language === "ENGLISH" ? "US $50" : "US $20")}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="mt-4 pt-4 border-t border-[var(--border-subtle)]">
                                        {publicCycle ? (
                                            <a
                                                href={`/api/public-sessions/${event.id}/enter`}
                                                className="event-button event-button--primary mt-3 inline-flex w-full text-center sm:w-auto"
                                            >
                                                {locale === 'en' ? 'Enter event' : 'Ingresar al evento'}
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
                                        {!publicCycle && (
                                            <p className="mt-3 text-xs text-[var(--text-secondary)]">
                                                USD $50 {copy.globalNorth} · USD $20 {copy.globalSouth}
                                            </p>
                                        )}
                                    </div>
                                </li>
                                    );
                                })}
                            </ul>
                        </EventSchedule>
                    )}
                </section>

                {/* The wider practice, secondary to the current event cycle. */}
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

                {/* Ticket login remains available only when a ticketed event is listed. */}
                {hasTicketedEvents && <section className="space-y-5" aria-labelledby="login-heading">
                    <h2 id="login-heading" className="hb-section-label">
                        {copy.loginHeading}
                    </h2>
                    <div className="event-card max-w-xl">
                        {accountEnabled && !account ? (
                            <div className="space-y-4">
                                <p className="text-sm leading-relaxed text-[var(--text-secondary)]">
                                    {copy && messages[locale].ticketLogin.accountRequired}
                                </p>
                                {accountError && (
                                    <div role="alert" className="event-alert event-alert--danger">
                                        {messages[locale].ticketLogin.accountError}
                                    </div>
                                )}
                                <a
                                    className="event-button event-button--primary inline-flex w-full"
                                    href={`/api/account/login?flow=attendee${next ? `&next=${encodeURIComponent(next)}` : ''}`}
                                >
                                    {messages[locale].ticketLogin.accountContinue}
                                </a>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                {accountEnabled && (
                                    <p className="text-xs text-[var(--text-muted)]">
                                        {messages[locale].ticketLogin.accountConnected}
                                    </p>
                                )}
                                <LoginClient
                                    next={next}
                                    {...(accountEnabled ? {
                                        accountEnabled: true,
                                        defaultDisplayName: account?.displayName ?? '',
                                    } : {})}
                                />
                            </div>
                        )}
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
