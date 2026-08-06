'use client';

import BrandLockup from '@/components/brand/BrandLockup';
import LanguageControl from '@/components/brand/LanguageControl';
import { useLocale } from '@/context/LocaleContext';
import { earlyBirdAuthClient } from '@/lib/early-birds/auth-client';
import { earlyBirdHomeCopy } from '@/lib/early-birds/copy';

import ListenerPlayer from './ListenerPlayer';

export default function EarlyBirdHome({
    displayName,
    membershipSource,
    dropIns,
}: {
    displayName: string;
    membershipSource: string | null;
    dropIns: { es: string | null; en: string | null };
}) {
    const { locale } = useLocale();
    const copy = earlyBirdHomeCopy[locale];

    async function signOut() {
        await earlyBirdAuthClient.signOut();
        window.location.assign('/early-birds');
    }

    return (
        <main className="event-shell">
            <div className="relative z-10 mx-auto min-h-screen w-full max-w-5xl px-6 py-8 sm:px-10 sm:py-10">
                <header className="mb-14 flex flex-wrap items-center justify-between gap-4">
                    <BrandLockup href="/early-birds" />
                    <div className="flex items-center gap-3">
                        <LanguageControl />
                        <button type="button" onClick={signOut} className="event-button event-button--ghost">
                            {copy.signOut}
                        </button>
                    </div>
                </header>
                <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="font-mono text-xs tracking-[0.22em] text-[var(--gold)]">{copy.eyebrow}</p>
                        <p className="mt-2 text-sm text-[var(--text-muted)]">{displayName}</p>
                    </div>
                    <span className="rounded-full border border-lime-200/20 bg-lime-200/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-[var(--lime)]">
                        {copy.active} · {membershipSource ?? 'TEST'}
                    </span>
                </div>
                <ListenerPlayer dropIns={dropIns} />
            </div>
        </main>
    );
}
