'use client';

import { useEffect } from 'react';

import { useLocale } from '@/context/LocaleContext';
import { clearListenerOAuthAttempt } from '@/lib/early-birds/auth-client';
import { earlyBirdCopy, earlyBirdHomeCopy, listenerMembershipPresentationCopy } from '@/lib/early-birds/copy';
import type { ListenerMembershipPresentation } from '@/lib/early-birds/membership-presentation';

import BeaconField from './BeaconField';
import FreeQuotaStatus from './FreeQuotaStatus';
import FoundingListenerCheckout from './FoundingListenerCheckout';
import FoundingListenerLiveWorkbench, {
    type ListenerLiveWorkbenchClientConfig,
} from './FoundingListenerLiveWorkbench';
import FoundingListenerMembershipActions from './FoundingListenerMembershipActions';
import type { SerializedEarlyBirdQuotaSnapshot } from './free-quota';
import ListenerPlayer from './ListenerPlayer';

export default function EarlyBirdHome({
    membership,
    accessKind = 'membership',
    serverNow = new Date(0).toISOString(),
    dropIns,
    publicAccess = false,
    reactiveVisualizationAvailable = false,
    reactiveFieldLabAvailable = false,
    quota = null,
    checkoutAvailability = { paypal: false, mercadoPago: false },
    checkoutEnvironment = 'staging',
    liveWorkbench = null,
}: {
    /** @deprecated Identity presentation now belongs to the canonical navbar. */
    displayName?: string;
    membership: ListenerMembershipPresentation;
    accessKind?: 'membership' | 'free-quota';
    serverNow?: string;
    dropIns: { es: string | null; en: string | null };
    publicAccess?: boolean;
    reactiveVisualizationAvailable?: boolean;
    reactiveFieldLabAvailable?: boolean;
    quota?: SerializedEarlyBirdQuotaSnapshot | null;
    checkoutAvailability?: { paypal: boolean; mercadoPago: boolean };
    checkoutEnvironment?: 'staging' | 'live';
    liveWorkbench?: ListenerLiveWorkbenchClientConfig | null;
}) {
    const { locale } = useLocale();
    const copy = earlyBirdHomeCopy[locale];
    const membershipCopy = listenerMembershipPresentationCopy(earlyBirdCopy[locale], membership);

    useEffect(() => clearListenerOAuthAttempt(), []);

    return (
        <main className="listener-shell">
            <div className="listener-shell__frame listener-shell__frame--home">
                {publicAccess && (
                    <header className="listener-rail">
                        <div className="listener-rail__actions">
                            <FreeQuotaStatus serverNow={serverNow} unlimited="free-for-all" compact />
                        </div>
                    </header>
                )}
                <div className="listener-static-field" data-testid="listener-static-field">
                    <BeaconField phase="ready" />
                </div>
                <section className="listener-altar" aria-labelledby="listener-heading">
                    <div className="listener-altar__heading" aria-hidden="true">
                        <p>{copy.eyebrow}</p>
                        <strong>{copy.heading}</strong>
                    </div>
                    <ListenerPlayer
                        dropIns={dropIns}
                        reactiveVisualizationAvailable={reactiveVisualizationAvailable}
                        reactiveVisualizationInitiallyEnabled={false}
                        reactiveFieldLabAvailable={reactiveFieldLabAvailable}
                    />
                    {!publicAccess && membershipCopy && (
                        <footer className="listener-home-membership-status">
                            <p>{membershipCopy.title ?? copy.active}</p>
                            {membership.kind !== 'none' && membershipCopy.detail && (
                                <small>{membershipCopy.detail}</small>
                            )}
                            {accessKind === 'membership' && membership.kind === 'founder' && (
                                <FreeQuotaStatus serverNow={serverNow} unlimited="membership" compact />
                            )}
                            {accessKind === 'membership' && membership.kind === 'founder' && (
                                <FoundingListenerMembershipActions membership={membership} />
                            )}
                        </footer>
                    )}
                    {!publicAccess && accessKind === 'free-quota' && (
                        <footer className="listener-listening-status">
                            <FreeQuotaStatus
                                snapshot={quota}
                                serverNow={serverNow}
                                compact
                                showMembershipUnavailable={
                                    !checkoutAvailability.paypal
                                    && !checkoutAvailability.mercadoPago
                                    && !liveWorkbench
                                }
                            />
                            <FoundingListenerCheckout
                                available={checkoutAvailability}
                                environment={checkoutEnvironment}
                            />
                            <FoundingListenerLiveWorkbench config={liveWorkbench} />
                        </footer>
                    )}
                </section>
            </div>
        </main>
    );
}
