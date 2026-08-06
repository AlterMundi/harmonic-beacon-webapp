'use client';

import { useState } from 'react';

import BrandLockup from '@/components/brand/BrandLockup';
import LanguageControl from '@/components/brand/LanguageControl';
import { useLocale } from '@/context/LocaleContext';
import { earlyBirdAuthClient } from '@/lib/early-birds/auth-client';
import { earlyBirdCopy } from '@/lib/early-birds/copy';

import SyntheticTeamEntryForm from './SyntheticTeamEntryForm';

type Props = {
    signedIn: boolean;
    entitled: boolean;
    invitationAvailable: boolean;
    authError: boolean;
    providers: { google: boolean; apple: boolean };
    syntheticTeamEntryAvailable: boolean;
};

export default function EarlyBirdLanding(props: Props) {
    const { locale } = useLocale();
    const copy = earlyBirdCopy[locale];
    const [busy, setBusy] = useState<'google' | 'apple' | null>(null);
    const [error, setError] = useState(false);
    const callbackURL = props.invitationAvailable
        ? '/early-birds/redeem'
        : '/early-birds';

    async function signIn(provider: 'google' | 'apple') {
        if (busy || !props.providers[provider]) return;
        setBusy(provider);
        setError(false);
        try {
            const result = await earlyBirdAuthClient.signIn.social({
                provider,
                callbackURL,
                errorCallbackURL: '/early-birds?authError=1',
                requestSignUp: true,
            });
            if (!result.error) return;
        } catch {}
        setBusy(null);
        setError(true);
    }

    return (
        <main className="event-shell">
            <div className="relative z-10 mx-auto flex min-h-screen w-full max-w-5xl flex-col px-6 py-8 sm:px-10 sm:py-10">
                <header className="flex items-center justify-between gap-4">
                    <BrandLockup href="/early-birds" />
                    <LanguageControl />
                </header>

                <div className="grid flex-1 items-center gap-12 py-14 lg:grid-cols-[1.2fr_0.8fr]">
                    <section className="max-w-2xl space-y-7">
                        <p className="font-mono text-xs tracking-[0.24em] text-[var(--gold)]">{copy.eyebrow}</p>
                        <h1 className="font-serif text-5xl font-normal leading-[0.95] text-[var(--paper)] sm:text-7xl">
                            {copy.title}
                        </h1>
                        <p className="max-w-xl text-base leading-7 text-[var(--text-secondary)] sm:text-lg">
                            {copy.intro}
                        </p>
                        <ul className="space-y-3 text-sm text-[var(--text-secondary)]">
                            {[copy.live, copy.privateDropIns, copy.membership].map((item) => (
                                <li key={item} className="flex items-center gap-3">
                                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--cyan)]" />
                                    {item}
                                </li>
                            ))}
                        </ul>
                    </section>

                    <section className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-6 shadow-[var(--shadow-deep)] backdrop-blur-xl sm:p-8">
                        {(props.authError || error) && (
                            <p role="alert" className="mb-5 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">
                                {copy.authError}
                            </p>
                        )}

                        {props.signedIn ? (
                            <div className="space-y-5">
                                <p className="text-sm text-[var(--text-secondary)]">{copy.signedIn}</p>
                                {props.entitled ? (
                                    <a href="/early-birds" className="event-button event-button--primary inline-flex w-full">
                                        {copy.enter}
                                    </a>
                                ) : props.invitationAvailable ? (
                                    <a href={callbackURL} className="event-button event-button--primary inline-flex w-full">
                                        {copy.redeem}
                                    </a>
                                ) : (
                                    <p className="event-alert event-alert--info">{copy.accessNeeded}</p>
                                )}
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {(['google', 'apple'] as const).map((provider) => (
                                    <button
                                        key={provider}
                                        type="button"
                                        onClick={() => signIn(provider)}
                                        disabled={busy !== null || !props.providers[provider]}
                                        className="event-button event-button--secondary w-full"
                                        title={!props.providers[provider] ? copy.providerSoon : undefined}
                                    >
                                        {busy === provider
                                            ? copy.signingIn
                                            : provider === 'google' ? copy.signInGoogle : copy.signInApple}
                                        {!props.providers[provider] && (
                                            <span className="ml-2 text-xs uppercase tracking-wider opacity-60">{copy.providerSoon}</span>
                                        )}
                                    </button>
                                ))}
                                {props.syntheticTeamEntryAvailable && (
                                    <SyntheticTeamEntryForm
                                        authOnly={props.invitationAvailable}
                                        postLoginPath={callbackURL}
                                    />
                                )}
                            </div>
                        )}
                    </section>
                </div>

                <footer className="max-w-3xl border-t border-[var(--border-subtle)] pt-5 text-xs leading-5 text-[var(--text-muted)]">
                    {copy.privacy}
                </footer>
            </div>
        </main>
    );
}
