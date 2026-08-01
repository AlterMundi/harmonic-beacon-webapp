import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { messages } from '@/lib/i18n';
import { requestLocale } from '@/lib/i18n-server';
import { resolveStaffByToken } from '@/lib/ops-auth';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';
import { listStaffEvents, type StaffEvent } from '@/lib/staff-navigation';

export const dynamic = 'force-dynamic';

function EventCard({ event, locale }: { event: StaffEvent; locale: 'es' | 'en' }) {
    const copy = messages[locale].ops;
    return (
        <li>
            <Link
                href={`/ops/events/${event.id}`}
                className="group block rounded-xl border border-[var(--border-subtle)] bg-white/[0.025] p-5 transition hover:border-[var(--gold)]/40 hover:bg-white/[0.045]"
            >
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className={`text-[10px] font-mono uppercase tracking-[0.14em] ${
                            event.status === 'LIVE' ? 'text-[var(--lime)]' : 'text-[var(--gold)]'
                        }`}>
                            {event.status === 'LIVE' ? copy.live : copy.scheduled}
                            {' · '}{event.language === 'SPANISH' ? 'ES' : 'EN'}
                        </p>
                        <h2 className="mt-2 font-serif text-xl text-[var(--paper)]">{event.title}</h2>
                        <p className="mt-2 text-xs text-[var(--text-muted)]">
                            {copy.facilitator}: {event.facilitator.name}
                        </p>
                    </div>
                    <span className="text-sm text-[var(--gold)] transition-transform group-hover:translate-x-1" aria-hidden="true">→</span>
                </div>
                <p className="mt-4 text-xs text-[var(--text-secondary)]">
                    {new Intl.DateTimeFormat(locale === 'es' ? 'es-AR' : 'en-GB', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                    }).format(event.scheduledAt)}
                    <span className="sr-only"> · {copy.openEvent}</span>
                </p>
            </Link>
        </li>
    );
}

export default async function EventsHubPage() {
    const cookieStore = await cookies();
    const staff = await resolveStaffByToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
    if (!staff) redirect('/staff/login');

    const locale = await requestLocale();
    const copy = messages[locale].ops;
    const events = await listStaffEvents(staff);
    const programme = events.filter((event) => !event.isTest);
    const tests = events.filter((event) => event.isTest);

    return (
        <section className="mx-auto max-w-4xl py-4">
            <header className="mb-7 max-w-2xl">
                <h1 className="font-serif text-3xl text-[var(--paper)]">{copy.hubTitle}</h1>
                <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{copy.hubIntro}</p>
            </header>

            {programme.length > 0 ? (
                <ul className="grid gap-4 md:grid-cols-2">
                    {programme.map((event) => <EventCard key={event.id} event={event} locale={locale} />)}
                </ul>
            ) : (
                <p className="rounded-lg border border-[var(--border-subtle)] p-5 text-sm text-[var(--text-secondary)]">
                    {copy.noEvents}
                </p>
            )}

            {tests.length > 0 && (
                <details className="mt-8 rounded-lg border border-dashed border-[var(--border-subtle)] bg-black/10">
                    <summary className="cursor-pointer px-5 py-4 text-sm text-[var(--text-secondary)]">
                        {copy.testEvents} <span className="text-[var(--text-muted)]">({tests.length})</span>
                    </summary>
                    <div className="border-t border-[var(--border-subtle)] px-5 py-5">
                        <p className="mb-4 text-xs text-[var(--text-muted)]">{copy.testEventsHint}</p>
                        <ul className="grid gap-3 md:grid-cols-2">
                            {tests.map((event) => <EventCard key={event.id} event={event} locale={locale} />)}
                        </ul>
                    </div>
                </details>
            )}
        </section>
    );
}
