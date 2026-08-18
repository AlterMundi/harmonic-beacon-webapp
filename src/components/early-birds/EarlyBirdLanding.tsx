'use client';

import { useEffect, useRef, useState } from 'react';

import { useLocale } from '@/context/LocaleContext';
import { earlyBirdCopy, listenerMembershipPresentationCopy } from '@/lib/early-birds/copy';
import type { ListenerMembershipPresentation } from '@/lib/early-birds/membership-presentation';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';
import {
    consumeListenerOAuthAttempt,
    markListenerOAuthAttempt,
    recoverListenerIdentity,
} from '@/lib/early-birds/auth-client';

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
    const [busy, setBusy] = useState<'recovery' | null>(null);
    const [error, setError] = useState(false);
    const recoveryStarted = useRef(false);
    const membership = listenerMembershipPresentationCopy(copy, props.membership);
    const callbackURL = props.invitationAvailable
        ? LISTENER_NAMESPACE.canonical.redeem
        : LISTENER_NAMESPACE.canonical.home;

    async function recoverIdentity() {
        if (busy) return;
        setBusy('recovery');
        setError(false);
        if (!await recoverListenerIdentity()) {
            setBusy(null);
            setError(true);
        }
    }

    async function signOut() {
        await recoverIdentity();
    }

    useEffect(() => {
        if (!props.authError || recoveryStarted.current || !consumeListenerOAuthAttempt()) return;
        recoveryStarted.current = true;
        void recoverIdentity();
    // Recovery is intentionally a one-shot reaction to the initial callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [props.authError]);

    return (
        <main className="listener-shell listener-shell--public">
            <div className="listener-shell__frame">
                <section className="listener-public-hero" aria-labelledby="listener-public-title">
                    <BeaconField phase="ready" />
                    <div className="listener-public-altar">
                        <div className="listener-public-hero__copy">
                            <p>{copy.eyebrow}</p>
                            <h1 id="listener-public-title">
                                {copy.title}
                            </h1>
                            <p>{copy.intro}</p>
                        </div>
                        <div id="listener-access" className="listener-access">
                            <div className="listener-access__card">
                        {error && (
                            <p role="alert" className="mb-5 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">
                                {copy.identityRecoveryFailed}
                            </p>
                        )}

                        {props.authError ? (
                            <div className="listener-access-unavailable">
                                <div role="alert">
                                    <strong>{copy.authRecoveryTitle}</strong>
                                    <p>{copy.authRecoveryDetail}</p>
                                </div>
                                <button
                                    type="button"
                                    onClick={recoverIdentity}
                                    disabled={busy !== null}
                                    className="listener-button listener-button--secondary w-full"
                                >
                                    {busy === 'recovery'
                                        ? copy.authRecoveryWorking
                                        : copy.authRecoveryAction}
                                </button>
                            </div>
                        ) : props.serviceUnavailable ? (
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
                                                && !props.liveWorkbench
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
                                <a
                                    href="/api/account/login"
                                    onClick={() => markListenerOAuthAttempt()}
                                    className="listener-button listener-button--secondary w-full"
                                >
                                    {locale === 'es' ? 'Ingresar o crear una cuenta' : 'Sign in or create an account'}
                                </a>
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
                    </div>
                </section>
            </div>
        </main>
    );
}
