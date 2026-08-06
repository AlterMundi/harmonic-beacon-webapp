import type { Metadata } from 'next';
import { cookies, headers as requestHeaders } from 'next/headers';

import EarlyBirdLanding from '@/components/early-birds/EarlyBirdLanding';
import EarlyBirdUnavailable from '@/components/early-birds/EarlyBirdUnavailable';
import {
    currentEarlyBirdSession,
    earlyBirdOAuthAvailability,
} from '@/lib/early-birds/auth';
import { getEarlyBirdAccess } from '@/lib/early-birds/membership';
import { earlyBirdsEnabled } from '@/lib/early-birds/enabled';
import {
    canonicalEarlyBirdInvitation,
    EARLY_BIRD_INVITATION_COOKIE,
} from '@/lib/early-birds/invitation-cookie';
import { syntheticTeamEntryAllowed } from '@/lib/early-birds/synthetic-team-entry';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
    title: 'EarlyBirds · Harmonic Beacon',
    description: 'Beacon 24/7 and private bilingual drop-ins for EarlyBird listeners.',
};

export default async function EarlyBirdsPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    if (!earlyBirdsEnabled()) return <EarlyBirdUnavailable />;

    const params = await searchParams;
    const incomingHeaders = new Headers(await requestHeaders());
    const cookieStore = await cookies();
    const session = await currentEarlyBirdSession().catch(() => null);
    const access = session
        ? await getEarlyBirdAccess(session.user.id).catch(() => null)
        : null;
    const invitationAvailable = canonicalEarlyBirdInvitation(
        cookieStore.get(EARLY_BIRD_INVITATION_COOKIE)?.value,
    ) !== null;

    return (
        <EarlyBirdLanding
            signedIn={Boolean(session)}
            entitled={access?.allowed === true}
            invitationAvailable={invitationAvailable}
            authError={params.authError === '1'}
            providers={earlyBirdOAuthAvailability()}
            syntheticTeamEntryAvailable={syntheticTeamEntryAllowed({ headers: incomingHeaders })}
        />
    );
}
