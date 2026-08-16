import { headers as requestHeaders } from 'next/headers';
import { redirect } from 'next/navigation';

import EarlyBirdLanding from '@/components/early-birds/EarlyBirdLanding';
import EarlyBirdHome from '@/components/early-birds/EarlyBirdHome';
import EarlyBirdUnavailable from '@/components/early-birds/EarlyBirdUnavailable';
import {
    currentEarlyBirdSession,
    earlyBirdOAuthAvailability,
} from '@/lib/early-birds/auth';
import { getEarlyBirdListeningAccess } from '@/lib/early-birds/access';
import { earlyBirdsEnabled, earlyBirdsFreeForAll } from '@/lib/early-birds/enabled';
import {
    listenerInvitationFromCookieHeader,
} from '@/lib/early-birds/invitation-cookie';
import { syntheticTeamEntryAllowed } from '@/lib/early-birds/synthetic-team-entry';
import { configuredEarlyBirdDropIn } from '@/lib/early-birds/drop-ins';
import { earlyBirdMagicLinkAvailable } from '@/lib/early-birds/magic-link';
import { serializeEarlyBirdQuotaSnapshot } from '@/lib/early-birds/quota';
import { listenerCheckoutAvailability } from '@/lib/early-birds/checkout';
import {
    createListenerLiveWorkbenchCsrfToken,
    listenerLiveWorkbenchConfig,
} from '@/lib/early-birds/live-workbench';
import { listenerMembershipPresentation } from '@/lib/early-birds/membership-presentation';
import {
    isCanonicalListenerHost,
    isListenerStagingHost,
    listenerLocaleForHeaders,
    listenerPreviewMetadata,
    listenerPublicMetadata,
} from '@/lib/listener/public-discovery';

export const dynamic = 'force-dynamic';

export async function generateMetadata() {
    const incomingHeaders = await requestHeaders();
    if (!isCanonicalListenerHost(incomingHeaders)) return listenerPreviewMetadata();

    return listenerPublicMetadata(
        listenerLocaleForHeaders(incomingHeaders),
    );
}

export default async function EarlyBirdsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    if (!earlyBirdsEnabled()) return <EarlyBirdUnavailable />;
    const incomingHeaders = new Headers(await requestHeaders());
    const listenerStagingHost = isListenerStagingHost(incomingHeaders);
    const canonicalListenerHost = isCanonicalListenerHost(incomingHeaders);
    const reactiveFieldLabAvailable = listenerStagingHost
        && process.env.BEACON_LISTENER_REACTIVE_FIELD_LAB_ENABLED === '1';
    // Public playback uses the inert CSS field. Remote analysis remains
    // available only inside the explicitly enabled staging laboratory.
    const reactiveVisualizationAvailable = reactiveFieldLabAvailable;
    const checkoutEnvironment = canonicalListenerHost ? 'live' : 'staging';
    const checkoutAvailability = (listenerStagingHost || canonicalListenerHost)
        ? listenerCheckoutAvailability(process.env, checkoutEnvironment)
        : { paypal: false, mercadoPago: false };
    const params = await searchParams;
    const paypalReturn = params.paypal;
    const checkoutReturn = params.checkout;
    if ((listenerStagingHost || canonicalListenerHost) && (
        paypalReturn === 'success'
        || paypalReturn === 'cancel'
        || checkoutReturn === 'returned'
        || checkoutReturn === 'cancelled'
    )) {
        // Provider redirects are never membership authority. Remove their opaque
        // browser parameters before rendering; the clean request will read the
        // canonical server-side membership projection instead.
        redirect('/');
    }

    if (earlyBirdsFreeForAll()) {
        return (
            <EarlyBirdHome
                publicAccess
                reactiveVisualizationAvailable={reactiveVisualizationAvailable}
                reactiveFieldLabAvailable={reactiveFieldLabAvailable}
                displayName=""
                membership={listenerMembershipPresentation(null)}
                dropIns={{
                    es: configuredEarlyBirdDropIn('es'),
                    en: configuredEarlyBirdDropIn('en'),
                }}
            />
        );
    }

    const sessionResolution = await currentEarlyBirdSession()
        .then((session) => ({ session, unavailable: false as const }))
        .catch(() => ({ session: null, unavailable: true as const }));
    const session = sessionResolution.session;
    const liveWorkbenchConfig = listenerStagingHost
        ? listenerLiveWorkbenchConfig()
        : null;
    const liveWorkbenchToken = session && liveWorkbenchConfig
        ? createListenerLiveWorkbenchCsrfToken({
            config: liveWorkbenchConfig,
            accountId: session.user.id,
            sessionId: session.session.id,
        })
        : null;
    const liveWorkbench = liveWorkbenchConfig && liveWorkbenchToken
        ? { provider: liveWorkbenchConfig.provider, csrfToken: liveWorkbenchToken }
        : null;
    const accessResolution = session
        ? await getEarlyBirdListeningAccess(session.user.id)
            .then((access) => ({ access, unavailable: false as const }))
            .catch(() => ({ access: null, unavailable: true as const }))
        : { access: null, unavailable: false as const };
    const access = accessResolution.access;
    const invitationAvailable = listenerInvitationFromCookieHeader(
        incomingHeaders.get('cookie'),
    ) !== null;

    if (session && access?.allowed === true) {
        return (
            <EarlyBirdHome
                displayName={session.user.name}
                reactiveVisualizationAvailable={reactiveVisualizationAvailable}
                reactiveFieldLabAvailable={reactiveFieldLabAvailable}
                membership={listenerMembershipPresentation(access.membership.projection)}
                accessKind={access.kind === 'free-quota' ? 'free-quota' : 'membership'}
                quota={access.quota ? serializeEarlyBirdQuotaSnapshot(access.quota) : null}
                checkoutAvailability={checkoutAvailability}
                checkoutEnvironment={checkoutEnvironment}
                liveWorkbench={liveWorkbench}
                serverNow={access.serverNow.toISOString()}
                dropIns={{
                    es: configuredEarlyBirdDropIn('es'),
                    en: configuredEarlyBirdDropIn('en'),
                }}
            />
        );
    }

    const providers = earlyBirdOAuthAvailability();
    const emailMagicLinkAvailable = earlyBirdMagicLinkAvailable();
    const syntheticTeamEntryAvailable = syntheticTeamEntryAllowed({ headers: incomingHeaders });
    const identityUnavailable = sessionResolution.unavailable || (
        !session
        && !providers.google
        && !providers.apple
        && !emailMagicLinkAvailable
        && !syntheticTeamEntryAvailable
    );

    return (
        <EarlyBirdLanding
            signedIn={Boolean(session)}
            entitled={access?.membership.allowed === true}
            serviceUnavailable={identityUnavailable ? 'identity' : accessResolution.unavailable ? 'access' : null}
            invitationAvailable={invitationAvailable}
            authError={params.authError === '1'}
            providers={providers}
            emailMagicLinkAvailable={emailMagicLinkAvailable}
            syntheticTeamEntryAvailable={syntheticTeamEntryAvailable}
            quota={access?.quota ? serializeEarlyBirdQuotaSnapshot(access.quota) : null}
            checkoutAvailability={checkoutAvailability}
            checkoutEnvironment={checkoutEnvironment}
            liveWorkbench={liveWorkbench}
            membership={listenerMembershipPresentation(access?.membership.projection ?? null)}
            serverNow={access?.serverNow.toISOString() ?? new Date().toISOString()}
        />
    );
}
