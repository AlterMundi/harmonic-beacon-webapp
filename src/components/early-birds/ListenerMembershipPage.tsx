'use client';

import { useLocale } from '@/context/LocaleContext';
import { earlyBirdCopy, listenerMembershipPresentationCopy } from '@/lib/early-birds/copy';
import type { ListenerMembershipPresentation } from '@/lib/early-birds/membership-presentation';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

import FoundingListenerCheckout from './FoundingListenerCheckout';
import FoundingListenerLiveWorkbench, {
    type ListenerLiveWorkbenchClientConfig,
} from './FoundingListenerLiveWorkbench';
import FoundingListenerMembershipActions from './FoundingListenerMembershipActions';
import FreeQuotaStatus from './FreeQuotaStatus';
import type { SerializedEarlyBirdQuotaSnapshot } from './free-quota';

type Props = {
    membership: ListenerMembershipPresentation;
    quota: SerializedEarlyBirdQuotaSnapshot | null;
    serverNow: string;
    checkoutAvailability: { paypal: boolean; mercadoPago: boolean };
    checkoutEnvironment: 'staging' | 'live';
    liveWorkbench: ListenerLiveWorkbenchClientConfig | null;
    serviceUnavailable?: boolean;
};

export default function ListenerMembershipPage({
    membership,
    quota,
    serverNow,
    checkoutAvailability,
    checkoutEnvironment,
    liveWorkbench,
    serviceUnavailable = false,
}: Props) {
    const { locale } = useLocale();
    const copy = earlyBirdCopy[locale];
    const membershipCopy = listenerMembershipPresentationCopy(copy, membership);
    const canPurchase = membership.kind === 'none' || membership.kind === 'paid-status';
    const checkoutAvailable = checkoutAvailability.paypal
        || checkoutAvailability.mercadoPago
        || liveWorkbench !== null;

    return (
        <main className="listener-page-shell">
            <article className="listener-membership-page" aria-labelledby="listener-membership-title">
                <a className="listener-membership-page__back" href={LISTENER_NAMESPACE.canonical.home}>
                    ← {copy.membershipBackToListener}
                </a>
                <header>
                    <p>{copy.membershipManageEyebrow}</p>
                    <h1 id="listener-membership-title">{copy.membershipManageTitle}</h1>
                    <p>{copy.membershipManageIntro}</p>
                </header>

                <section className="listener-membership-page__card">
                    {serviceUnavailable ? (
                        <div className="listener-access-unavailable" role="alert">
                            <strong>{copy.serviceUnavailableTitle}</strong>
                            <p>{copy.accessUnavailable}</p>
                        </div>
                    ) : (
                        <>
                            {membershipCopy && (
                                <div className="listener-membership-page__status" role="status">
                                    <strong>{membershipCopy.title}</strong>
                                    {membershipCopy.detail && <p>{membershipCopy.detail}</p>}
                                </div>
                            )}
                            {membership.kind === 'founder' && (
                                <FoundingListenerMembershipActions membership={membership} />
                            )}
                            {quota && (
                                <FreeQuotaStatus snapshot={quota} serverNow={serverNow} />
                            )}
                            {canPurchase && (
                                <div className="listener-membership-page__checkout">
                                    {checkoutAvailable ? (
                                        <>
                                            <FoundingListenerCheckout
                                                available={checkoutAvailability}
                                                environment={checkoutEnvironment}
                                            />
                                            <FoundingListenerLiveWorkbench config={liveWorkbench} />
                                        </>
                                    ) : (
                                        <p role="status">{copy.membershipPurchaseUnavailable}</p>
                                    )}
                                </div>
                            )}
                        </>
                    )}
                </section>
            </article>
        </main>
    );
}
