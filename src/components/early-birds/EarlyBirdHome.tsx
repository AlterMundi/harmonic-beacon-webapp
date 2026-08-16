'use client';

import BrandLockup from '@/components/brand/BrandLockup';
import { useLocale } from '@/context/LocaleContext';
import { earlyBirdAuthClient } from '@/lib/early-birds/auth-client';
import { earlyBirdCopy, earlyBirdHomeCopy, listenerMembershipPresentationCopy } from '@/lib/early-birds/copy';
import type { ListenerMembershipPresentation } from '@/lib/early-birds/membership-presentation';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

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
    displayName,
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
    displayName: string;
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

    async function signOut() {
        await earlyBirdAuthClient.signOut();
        window.location.assign(LISTENER_NAMESPACE.canonical.home);
    }

    return (
        <main className="listener-shell">
            <div className="listener-shell__frame listener-shell__frame--home">
                <header className="listener-rail">
                    <BrandLockup href={LISTENER_NAMESPACE.publicWebsite} />
                    <div className="listener-rail__actions">
                        {publicAccess && (
                            <FreeQuotaStatus serverNow={serverNow} unlimited="free-for-all" compact />
                        )}
                        {!publicAccess && <details className="listener-account">
                            <summary aria-label={copy.account} title={copy.account}>
                                {displayName.slice(0, 1).toUpperCase()}
                            </summary>
                            <div className="listener-account__menu">
                                <p>{displayName}</p>
                                {membershipCopy && (
                                    <span>{membershipCopy?.title ?? copy.active}</span>
                                )}
                                {membership.kind !== 'none' && membershipCopy?.detail && (
                                    <small>{membershipCopy.detail}</small>
                                )}
                                {accessKind === 'membership' && membership.kind === 'founder' && (
                                    <FreeQuotaStatus serverNow={serverNow} unlimited="membership" compact />
                                )}
                                {accessKind === 'membership' && membership.kind === 'founder' && (
                                    <FoundingListenerMembershipActions membership={membership} />
                                )}
                                <button type="button" onClick={signOut}>{copy.signOut}</button>
                            </div>
                        </details>}
                    </div>
                </header>
                <div className="listener-static-field" data-testid="listener-static-field">
                    <BeaconField phase="ready" />
                </div>
                <ListenerPlayer
                    dropIns={dropIns}
                    reactiveVisualizationAvailable={reactiveVisualizationAvailable}
                    reactiveVisualizationInitiallyEnabled={false}
                    reactiveFieldLabAvailable={reactiveFieldLabAvailable}
                />
                {!publicAccess && accessKind === 'free-quota' && (
                    <footer className="listener-listening-status">
                        <FreeQuotaStatus
                            snapshot={quota}
                            serverNow={serverNow}
                            compact
                            showMembershipLink={!checkoutAvailability.paypal && !checkoutAvailability.mercadoPago}
                        />
                        <FoundingListenerCheckout
                            available={checkoutAvailability}
                            environment={checkoutEnvironment}
                        />
                        <FoundingListenerLiveWorkbench config={liveWorkbench} />
                    </footer>
                )}
            </div>
        </main>
    );
}
