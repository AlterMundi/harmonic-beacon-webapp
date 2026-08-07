import type { Metadata } from 'next';
import { cookies, headers as requestHeaders } from 'next/headers';

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
    canonicalEarlyBirdInvitation,
    EARLY_BIRD_INVITATION_COOKIE,
} from '@/lib/early-birds/invitation-cookie';
import { syntheticTeamEntryAllowed } from '@/lib/early-birds/synthetic-team-entry';
import { configuredEarlyBirdDropIn } from '@/lib/early-birds/drop-ins';
import { freeWindowState, serializeFreeWindowState } from '@/lib/early-birds/free-window';
import { earlyBirdMagicLinkAvailable } from '@/lib/early-birds/magic-link';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'Listen · Harmonic Beacon',
    description: 'A continuous harmonic field, shared across the world.',
};

export default async function EarlyBirdsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    if (!earlyBirdsEnabled()) return <EarlyBirdUnavailable />;

    if (earlyBirdsFreeForAll()) {
        return (
            <EarlyBirdHome
                publicAccess
                displayName=""
                membershipSource={null}
                dropIns={{
                    es: configuredEarlyBirdDropIn('es'),
                    en: configuredEarlyBirdDropIn('en'),
                }}
            />
        );
    }

    const params = await searchParams;
    const incomingHeaders = new Headers(await requestHeaders());
    const cookieStore = await cookies();
    const session = await currentEarlyBirdSession().catch(() => null);
    const access = session
        ? await getEarlyBirdListeningAccess(session.user.id).catch(() => null)
        : null;
    const invitationAvailable = canonicalEarlyBirdInvitation(
        cookieStore.get(EARLY_BIRD_INVITATION_COOKIE)?.value,
    ) !== null;

    if (session && access?.allowed === true) {
        return (
            <EarlyBirdHome
                displayName={session.user.name}
                membershipSource={access.membership.projection?.source ?? null}
                accessKind={access.kind === 'free-window' ? 'free-window' : 'membership'}
                dropIns={{
                    es: configuredEarlyBirdDropIn('es'),
                    en: configuredEarlyBirdDropIn('en'),
                }}
            />
        );
    }

    return (
        <EarlyBirdLanding
            signedIn={Boolean(session)}
            entitled={access?.membership.allowed === true}
            invitationAvailable={invitationAvailable}
            authError={params.authError === '1'}
            providers={earlyBirdOAuthAvailability()}
            emailMagicLinkAvailable={earlyBirdMagicLinkAvailable()}
            syntheticTeamEntryAvailable={syntheticTeamEntryAllowed({ headers: incomingHeaders })}
            freeWindow={serializeFreeWindowState(access?.freeWindow ?? freeWindowState(null))}
        />
    );
}
