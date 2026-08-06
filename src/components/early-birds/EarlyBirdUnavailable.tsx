'use client';

import BrandLockup from '@/components/brand/BrandLockup';
import LanguageControl from '@/components/brand/LanguageControl';
import { useLocale } from '@/context/LocaleContext';

const copy = {
    es: {
        eyebrow: 'EARLYBIRDS',
        title: 'Estamos preparando el Beacon.',
        body: 'El acceso fundador todavía no está disponible. Volvé a intentarlo más tarde.',
    },
    en: {
        eyebrow: 'EARLYBIRDS',
        title: 'We are preparing the Beacon.',
        body: 'Founding access is not available yet. Please try again later.',
    },
} as const;

export default function EarlyBirdUnavailable() {
    const { locale } = useLocale();
    const text = copy[locale];

    return (
        <main className="event-shell">
            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 sm:px-10 sm:py-10">
                <header className="flex items-center justify-between gap-4">
                    <BrandLockup href="/early-birds" />
                    <LanguageControl />
                </header>
                <section className="flex flex-1 items-center py-14">
                    <div className="max-w-2xl space-y-7">
                        <p className="font-mono text-xs tracking-[0.24em] text-[var(--gold)]">
                            {text.eyebrow}
                        </p>
                        <h1 className="font-serif text-5xl font-normal leading-[0.95] text-[var(--paper)] sm:text-7xl">
                            {text.title}
                        </h1>
                        <p className="max-w-xl text-base leading-7 text-[var(--text-secondary)] sm:text-lg">
                            {text.body}
                        </p>
                    </div>
                </section>
            </div>
        </main>
    );
}
