'use client';

import Link from 'next/link';
import { useLocale } from '@/context/LocaleContext';
import { liveNavigationCopy } from '@/lib/live-navigation-copy';
import OpsNavLinks from './OpsNavLinks';

/** Copy-only client boundaries keep server authorization and event data intact. */
export function OpsNavigation({ analytics }: { analytics: boolean }) {
    const { locale, copy } = useLocale();
    const links = [
        { href: '/ops/events', label: copy.ops.events },
        { href: '/ops/health', label: copy.ops.health },
        { href: '/ops/admission', label: copy.ops.admission },
        ...(analytics ? [{ href: '/ops/analytics', label: liveNavigationCopy[locale].analytics }] : []),
    ];
    return <nav aria-label={liveNavigationCopy[locale].eventOperations} className="border-b border-[var(--border-subtle)] bg-[var(--forest)]/80 px-4 py-2.5">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Link href="/ops/events" className="font-semibold text-[var(--paper)]">{copy.ops.brand}</Link>
            <span className="mx-1 hidden text-white/20 sm:inline">|</span>
            <OpsNavLinks links={links} />
            <span className="mx-1 hidden text-white/20 sm:inline">|</span>
            <Link href="/" className="inline-flex min-h-11 items-center px-2 text-[var(--text-secondary)] hover:text-[var(--paper)]">{copy.ops.publicSite}</Link>
        </div>
    </nav>;
}

export function EventHeading({ title, language, status, scheduledAt }: {
    title: string; language: string; status: string; scheduledAt: string;
}) {
    const { locale, copy } = useLocale();
    return <>
        <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
            <div>
                <p className="text-xs font-mono uppercase tracking-[0.12em] text-[var(--gold)]">{copy.ops.eventConsole}</p>
                <h1 className="mt-1 font-serif text-3xl text-[var(--paper)]">{title}</h1>
            </div>
        </div>
        <p className="mb-6 text-sm text-[var(--text-secondary)]">
            {language === 'SPANISH' ? 'ES' : 'EN'} ·{' '}
            <span>{status === 'LIVE' ? copy.ops.live : copy.ops.scheduled}</span> ·{' '}
            {new Intl.DateTimeFormat(locale === 'es' ? 'es-AR' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(scheduledAt))}
        </p>
    </>;
}
