'use client';

import { useState } from 'react';

import BrandLockup from '@/components/brand/BrandLockup';
import { useLocale } from '@/context/LocaleContext';
import { earlyBirdAuthClient } from '@/lib/early-birds/auth-client';
import { earlyBirdCopy } from '@/lib/early-birds/copy';
import type { SerializedEarlyBirdFreeWindowState } from '@/lib/early-birds/free-window';
import type { SerializedEarlyBirdWelcomeAccessState } from '@/lib/early-birds/welcome-access';

import AccessBoundarySync from './AccessBoundarySync';
import BeaconField from './BeaconField';
import FreeWindowSetup from './FreeWindowSetup';
import SyntheticTeamEntryForm from './SyntheticTeamEntryForm';
import WelcomeAccessAction from './WelcomeAccessAction';

type Props = {
    signedIn: boolean;
    entitled: boolean;
    invitationAvailable: boolean;
    authError: boolean;
    providers: { google: boolean; apple: boolean };
    emailMagicLinkAvailable: boolean;
    syntheticTeamEntryAvailable: boolean;
    freeWindow: SerializedEarlyBirdFreeWindowState;
    welcome: SerializedEarlyBirdWelcomeAccessState;
    serverNow: string;
};

export default function EarlyBirdLanding(props: Props) {
    const { locale } = useLocale();
    const copy = earlyBirdCopy[locale];
    const [busy, setBusy] = useState<'google' | 'apple' | 'email' | null>(null);
    const [error, setError] = useState(false);
    const [email, setEmail] = useState('');
    const [emailRequested, setEmailRequested] = useState(false);
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

    async function signOut() {
        await earlyBirdAuthClient.signOut();
        window.location.assign('/early-birds');
    }

    async function requestMagicLink(event: React.FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy || !props.emailMagicLinkAvailable) return;
        setBusy('email');
        setError(false);
        try {
            await earlyBirdAuthClient.signIn.magicLink({
                email,
                callbackURL,
                errorCallbackURL: '/early-birds?authError=1',
                metadata: { locale },
            });
            // The same response is intentionally shown for unknown accounts,
            // throttled requests and provider delivery uncertainty.
            setEmailRequested(true);
            setEmail('');
        } catch {
            setEmailRequested(true);
            setEmail('');
        } finally {
            setBusy(null);
        }
    }

    return (
        <main className="listener-shell listener-shell--public">
            {props.signedIn && props.freeWindow.nextStart && (
                <AccessBoundarySync
                    expectedKind="denied"
                    boundaryAt={props.freeWindow.nextStart}
                    serverNow={props.serverNow}
                />
            )}
            <div className="listener-shell__frame">
                <header className="listener-rail">
                    <BrandLockup href="/early-birds" />
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
                                    <>
                                        {props.welcome.available && <WelcomeAccessAction />}
                                        <FreeWindowSetup state={props.freeWindow} />
                                    </>
                                )}
                                <button
                                    type="button"
                                    onClick={signOut}
                                    className="listener-account-link"
                                >
                                    {copy.signOut}
                                </button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {(['google', 'apple'] as const).filter((provider) => props.providers[provider]).map((provider) => (
                                    <button
                                        key={provider}
                                        type="button"
                                        onClick={() => signIn(provider)}
                                        disabled={busy !== null}
                                        className="event-button event-button--secondary w-full"
                                    >
                                        {busy === provider
                                            ? copy.signingIn
                                            : provider === 'google' ? copy.signInGoogle : copy.signInApple}
                                    </button>
                                ))}
                                {props.emailMagicLinkAvailable && (
                                    <div className="listener-email-access">
                                        {(props.providers.google || props.providers.apple) && (
                                            <p className="listener-email-access__divider">
                                                <span>{copy.magicLinkDivider}</span>
                                            </p>
                                        )}
                                        {emailRequested ? (
                                            <p role="status" className="listener-email-access__status">
                                                {copy.magicLinkSent}
                                            </p>
                                        ) : (
                                            <form onSubmit={requestMagicLink} className="listener-email-access__form">
                                                <label htmlFor="listener-email">{copy.magicLinkEmail}</label>
                                                <input
                                                    id="listener-email"
                                                    name="email"
                                                    type="email"
                                                    inputMode="email"
                                                    autoComplete="email"
                                                    required
                                                    value={email}
                                                    onChange={(event) => setEmail(event.target.value)}
                                                    placeholder={copy.magicLinkPlaceholder}
                                                />
                                                <button
                                                    type="submit"
                                                    disabled={busy !== null}
                                                    className="event-button event-button--secondary w-full"
                                                >
                                                    {busy === 'email' ? copy.magicLinkSending : copy.magicLinkSend}
                                                </button>
                                            </form>
                                        )}
                                    </div>
                                )}
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
