import type { Metadata } from 'next';
import { headers as requestHeaders } from 'next/headers';
import { notFound, redirect } from 'next/navigation';

import ListenerMembershipPage from '@/components/early-birds/ListenerMembershipPage';
import { getEarlyBirdListeningAccess } from '@/lib/early-birds/access';
import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { listenerCheckoutAvailability } from '@/lib/early-birds/checkout';
import { earlyBirdsEnabled } from '@/lib/early-birds/enabled';
import {
    createListenerLiveWorkbenchCsrfToken,
    listenerLiveWorkbenchConfig,
} from '@/lib/early-birds/live-workbench';
import { listenerMembershipPresentation } from '@/lib/early-birds/membership-presentation';
import { serializeEarlyBirdQuotaSnapshot } from '@/lib/early-birds/quota';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';
import {
    isCanonicalListenerHost,
    isListenerStagingHost,
    listenerLocaleForHeaders,
} from '@/lib/listener/public-discovery';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
    const locale = listenerLocaleForHeaders(await requestHeaders());
    return {
        title: `${locale === 'es' ? 'Membresía' : 'Membership'} | Harmonic Beacon`,
        robots: { index: false, follow: false, nocache: true },
    };
}

const emptyCheckout = { paypal: false, mercadoPago: false } as const;

export default async function ListenerMembershipManagementPage() {
    if (!earlyBirdsEnabled()) notFound();
    const incomingHeaders = new Headers(await requestHeaders());
    const staging = isListenerStagingHost(incomingHeaders);
    const canonical = isCanonicalListenerHost(incomingHeaders);
    if (!staging && !canonical) notFound();

    const sessionResolution = await currentEarlyBirdSession(incomingHeaders)
        .then((session) => ({ session, unavailable: false as const }))
        .catch(() => ({ session: null, unavailable: true as const }));
    if (sessionResolution.unavailable) {
        return (
            <ListenerMembershipPage
                membership={{ kind: 'none', state: 'none' }}
                quota={null}
                serverNow={new Date(0).toISOString()}
                checkoutAvailability={emptyCheckout}
                checkoutEnvironment={canonical ? 'live' : 'staging'}
                liveWorkbench={null}
                serviceUnavailable
            />
        );
    }
    if (!sessionResolution.session) redirect(LISTENER_NAMESPACE.canonical.home);
    const session = sessionResolution.session;

    const access = await getEarlyBirdListeningAccess(session.user.id).catch(() => null);
    if (!access) {
        return (
            <ListenerMembershipPage
                membership={{ kind: 'none', state: 'none' }}
                quota={null}
                serverNow={new Date(0).toISOString()}
                checkoutAvailability={emptyCheckout}
                checkoutEnvironment={canonical ? 'live' : 'staging'}
                liveWorkbench={null}
                serviceUnavailable
            />
        );
    }

    const checkoutEnvironment = canonical ? 'live' : 'staging';
    const checkoutAvailability = listenerCheckoutAvailability(process.env, checkoutEnvironment);
    const workbenchConfig = staging ? listenerLiveWorkbenchConfig() : null;
    const workbenchToken = workbenchConfig
        ? createListenerLiveWorkbenchCsrfToken({
            config: workbenchConfig,
            accountId: session.user.id,
            sessionId: session.session.id,
        })
        : null;
    const liveWorkbench = workbenchConfig && workbenchToken
        ? { provider: workbenchConfig.provider, csrfToken: workbenchToken }
        : null;

    return (
        <ListenerMembershipPage
            membership={listenerMembershipPresentation(access.membership.projection)}
            quota={access.quota ? serializeEarlyBirdQuotaSnapshot(access.quota) : null}
            serverNow={access.serverNow.toISOString()}
            checkoutAvailability={checkoutAvailability}
            checkoutEnvironment={checkoutEnvironment}
            liveWorkbench={liveWorkbench}
        />
    );
}
