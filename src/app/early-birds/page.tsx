import { headers as requestHeaders } from 'next/headers';
import { redirect } from 'next/navigation';

import EarlyBirdLanding from '@/components/early-birds/EarlyBirdLanding';
import EarlyBirdHome from '@/components/early-birds/EarlyBirdHome';
import EarlyBirdUnavailable from '@/components/early-birds/EarlyBirdUnavailable';
import {
    currentEarlyBirdSession,
} from '@/lib/early-birds/auth';
import { getEarlyBirdListeningAccess } from '@/lib/early-birds/access';
import { earlyBirdsEnabled, earlyBirdsFreeForAll } from '@/lib/early-birds/enabled';
import {
    listenerInvitationFromCookieHeader,
} from '@/lib/early-birds/invitation-cookie';
import { syntheticTeamEntryAllowed } from '@/lib/early-birds/synthetic-team-entry';
import { configuredEarlyBirdDropIn } from '@/lib/early-birds/drop-ins';
import { listenerAccountRPConfig } from '@/lib/listener/account-rp';
import { serializeEarlyBirdQuotaSnapshot } from '@/lib/early-birds/quota';
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
                reactiveVisualizationAvailable={reactiveVisualizationAvailable}
                reactiveFieldLabAvailable={reactiveFieldLabAvailable}
                accessKind={access.kind === 'free-quota' ? 'free-quota' : 'membership'}
                quota={access.quota ? serializeEarlyBirdQuotaSnapshot(access.quota) : null}
                serverNow={access.serverNow.toISOString()}
                dropIns={{
                    es: configuredEarlyBirdDropIn('es'),
                    en: configuredEarlyBirdDropIn('en'),
                }}
            />
        );
    }

    let accountIdentityAvailable = true;
    try { listenerAccountRPConfig(incomingHeaders); } catch { accountIdentityAvailable = false; }
    const syntheticTeamEntryAvailable = syntheticTeamEntryAllowed({ headers: incomingHeaders });
    const identityUnavailable = sessionResolution.unavailable || (
        !session
        && !accountIdentityAvailable
        && !syntheticTeamEntryAvailable
    );
    return (
        <EarlyBirdLanding
            signedIn={Boolean(session)}
            entitled={access?.membership.allowed === true}
            serviceUnavailable={identityUnavailable ? 'identity' : accessResolution.unavailable ? 'access' : null}
            invitationAvailable={invitationAvailable}
            authError={params.authError === '1'}
            syntheticTeamEntryAvailable={syntheticTeamEntryAvailable}
            quota={access?.quota ? serializeEarlyBirdQuotaSnapshot(access.quota) : null}
            serverNow={access?.serverNow.toISOString() ?? new Date().toISOString()}
        />
    );
}
