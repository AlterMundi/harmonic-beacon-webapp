'use client';

import { useState } from 'react';

import BrandLockup from '@/components/brand/BrandLockup';
import LanguageControl from '@/components/brand/LanguageControl';
import { useLocale } from '@/context/LocaleContext';
import { earlyBirdAuthClient } from '@/lib/early-birds/auth-client';
import { earlyBirdCopy } from '@/lib/early-birds/copy';

import BeaconField from './BeaconField';
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
        <main className="listener-shell listener-shell--public">
            <div className="listener-shell__frame">
                <header className="listener-rail">
                    <BrandLockup href="/early-birds" />
                    <LanguageControl />
                </header>

                <section className="listener-public-hero">
                    <div className="listener-public-hero__copy">
                        <p>{copy.eyebrow}</p>
                        <h1>
                            {copy.title}
                        </h1>
                        <p>{copy.intro}</p>
                        <a href="#listener-access" className="listener-public-hero__cta">{copy.enter}</a>
                    </div>
                    <BeaconField phase="ready" />
                </section>

                <section className="listener-public-story" aria-label={copy.membership}>
                    {[copy.live, copy.privateDropIns, copy.membership].map((item, index) => (
                        <article key={item}>
                            <span aria-hidden="true">0{index + 1}</span>
                            <p>{item}</p>
                        </article>
                    ))}
                </section>

                <section id="listener-access" className="listener-access">
                    <div className="listener-access__intro">
                        <p>{copy.eyebrow}</p>
                        <h2>{copy.enter}</h2>
                    </div>
                    <div className="listener-access__card">
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
                    </div>
                </section>

                <footer className="listener-footer">
                    {copy.privacy}
                </footer>
            </div>
        </main>
    );
}
