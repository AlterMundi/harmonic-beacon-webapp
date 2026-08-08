import { headers as requestHeaders } from 'next/headers';

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
import { serializeFreeWindowState } from '@/lib/early-birds/free-window';
import { serializeWelcomeAccessState } from '@/lib/early-birds/welcome-access';
import { earlyBirdMagicLinkAvailable } from '@/lib/early-birds/magic-link';
import { listenerCampfirePrototypeConfig } from '@/lib/early-birds/campfire-prototype';
import { listenerMembershipPresentation } from '@/lib/early-birds/membership-presentation';
import {
    isCanonicalListenerHost,
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
    const campfire = listenerCampfirePrototypeConfig();

    if (earlyBirdsFreeForAll()) {
        return (
            <EarlyBirdHome
                publicAccess
                campfirePrototype={campfire.enabled}
                campfireFixture={campfire.fixture}
                displayName=""
                membership={listenerMembershipPresentation(null)}
                dropIns={{
                    es: configuredEarlyBirdDropIn('es'),
                    en: configuredEarlyBirdDropIn('en'),
                }}
            />
        );
    }

    const params = await searchParams;
    const serverNow = new Date().toISOString();
    const incomingHeaders = new Headers(await requestHeaders());
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
                displayName={session.user.name}
                campfirePrototype={campfire.enabled}
                campfireFixture={campfire.fixture}
                membership={listenerMembershipPresentation(access.membership.projection)}
                accessKind={access.kind === 'free-window'
                    ? 'free-window'
                    : access.kind === 'welcome' ? 'welcome' : 'membership'}
                accessUntil={access.allowedUntil?.toISOString() ?? null}
                serverNow={serverNow}
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
            freeWindow={access ? serializeFreeWindowState(access.freeWindow) : null}
            welcome={access ? serializeWelcomeAccessState(access.welcome) : null}
            membership={listenerMembershipPresentation(access?.membership.projection ?? null)}
            serverNow={serverNow}
        />
    );
}
