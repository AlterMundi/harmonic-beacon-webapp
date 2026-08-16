'use client';

import { useState } from 'react';

import HarmonicBeaconBrand from '@/components/brand/HarmonicBeaconBrand';
import { useLocale } from '@/context/LocaleContext';
import { earlyBirdAuthClient } from '@/lib/early-birds/auth-client';
import { earlyBirdCopy, listenerMembershipPresentationCopy } from '@/lib/early-birds/copy';
import type { ListenerMembershipPresentation } from '@/lib/early-birds/membership-presentation';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

import BeaconField from './BeaconField';
import FreeQuotaStatus from './FreeQuotaStatus';
import FoundingListenerCheckout from './FoundingListenerCheckout';
import FoundingListenerLiveWorkbench, {
    type ListenerLiveWorkbenchClientConfig,
} from './FoundingListenerLiveWorkbench';
import SyntheticTeamEntryForm from './SyntheticTeamEntryForm';
import type { SerializedEarlyBirdQuotaSnapshot } from './free-quota';

type Props = {
    signedIn: boolean;
    entitled: boolean;
    serviceUnavailable: 'identity' | 'access' | null;
    invitationAvailable: boolean;
    authError: boolean;
    providers: { google: boolean; apple: boolean };
    emailMagicLinkAvailable: boolean;
    syntheticTeamEntryAvailable: boolean;
    quota?: SerializedEarlyBirdQuotaSnapshot | null;
    membership: ListenerMembershipPresentation;
    serverNow: string;
    checkoutAvailability?: { paypal: boolean; mercadoPago: boolean };
    checkoutEnvironment?: 'staging' | 'live';
    liveWorkbench?: ListenerLiveWorkbenchClientConfig | null;
};

export default function EarlyBirdLanding(props: Props) {
    const { locale } = useLocale();
    const copy = earlyBirdCopy[locale];
    const [busy, setBusy] = useState<'google' | 'apple' | 'email' | null>(null);
    const [error, setError] = useState(false);
    const [email, setEmail] = useState('');
    const [emailRequested, setEmailRequested] = useState(false);
    const membership = listenerMembershipPresentationCopy(copy, props.membership);
    const callbackURL = props.invitationAvailable
        ? LISTENER_NAMESPACE.canonical.redeem
        : LISTENER_NAMESPACE.canonical.home;

    async function signIn(provider: 'google' | 'apple') {
        if (busy || !props.providers[provider]) return;
        setBusy(provider);
        setError(false);
        try {
            const result = await earlyBirdAuthClient.signIn.social({
                provider,
                callbackURL,
                errorCallbackURL: LISTENER_NAMESPACE.canonical.authError,
                requestSignUp: true,
            });
            if (!result.error) return;
        } catch {}
        setBusy(null);
        setError(true);
    }

    async function signOut() {
        await earlyBirdAuthClient.signOut();
        window.location.assign(LISTENER_NAMESPACE.canonical.home);
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
                errorCallbackURL: LISTENER_NAMESPACE.canonical.authError,
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
            <div className="listener-shell__frame">
                <header className="listener-rail">
                    <HarmonicBeaconBrand href={LISTENER_NAMESPACE.publicWebsite} />
                </header>

                <section className="listener-public-hero">
                    <BeaconField phase="ready" />
                    <div className="listener-public-hero__copy">
                        <p>{copy.eyebrow}</p>
                        <h1>
                            {copy.title}
                        </h1>
                        <p>{copy.intro}</p>
                    </div>
                    <div id="listener-access" className="listener-access">
                        <div className="listener-access__card">
                        {(props.authError || error) && (
                            <p role="alert" className="mb-5 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">
                                {copy.authError}
                            </p>
                        )}

                        {props.serviceUnavailable ? (
                            <div className="listener-access-unavailable" role="alert">
                                <strong>{copy.serviceUnavailableTitle}</strong>
                                <p>{props.serviceUnavailable === 'identity'
                                    ? copy.identityUnavailable
                                    : copy.accessUnavailable}</p>
                                <a
                                    href={LISTENER_NAMESPACE.canonical.home}
                                    className="listener-button listener-button--secondary w-full"
                                >
                                    {copy.retryAccess}
                                </a>
                                {props.signedIn && (
                                    <button
                                        type="button"
                                        onClick={signOut}
                                        className="listener-account-link"
                                    >
                                        {copy.signOut}
                                    </button>
                                )}
                            </div>
                        ) : props.signedIn ? (
                            <div className="space-y-5">
                                <p className="text-sm text-[var(--text-secondary)]">{copy.signedIn}</p>
                                {props.entitled ? (
                                    <a href={LISTENER_NAMESPACE.canonical.home} className="listener-button listener-button--primary inline-flex w-full">
                                        {copy.enter}
                                    </a>
                                ) : props.invitationAvailable ? (
                                    <a href={callbackURL} className="listener-button listener-button--primary inline-flex w-full">
                                        {copy.redeem}
                                    </a>
                                ) : (
                                    <>
                                        {membership && props.membership.state !== 'active' && (
                                            <div className="listener-membership-status" role="status">
                                                <strong>{membership.title}</strong>
                                                {membership.detail && <p>{membership.detail}</p>}
                                            </div>
                                        )}
                                        <FreeQuotaStatus
                                            snapshot={props.quota}
                                            serverNow={props.serverNow}
                                            showMembershipLink={
                                                !props.checkoutAvailability?.paypal
                                                && !props.checkoutAvailability?.mercadoPago
                                            }
                                        />
                                        <FoundingListenerCheckout available={props.checkoutAvailability ?? {
                                            paypal: false,
                                            mercadoPago: false,
                                        }} environment={props.checkoutEnvironment ?? 'staging'} />
                                        <FoundingListenerLiveWorkbench config={props.liveWorkbench ?? null} />
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
                                        className="listener-button listener-button--secondary w-full"
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
                                                    className="listener-button listener-button--secondary w-full"
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
                    </div>
                </section>
            </div>
        </main>
    );
}
