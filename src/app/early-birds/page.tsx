import type { Metadata } from 'next';

import EarlyBirdLanding from '@/components/early-birds/EarlyBirdLanding';
import {
    currentEarlyBirdSession,
    earlyBirdOAuthAvailability,
} from '@/lib/early-birds/auth';
import { getEarlyBirdAccess } from '@/lib/early-birds/membership';

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
    const params = await searchParams;
    const session = await currentEarlyBirdSession().catch(() => null);
    const access = session
        ? await getEarlyBirdAccess(session.user.id).catch(() => null)
        : null;
    const invite = typeof params.invite === 'string' && params.invite.length <= 512
        ? params.invite
        : null;

    return (
        <EarlyBirdLanding
            signedIn={Boolean(session)}
            entitled={access?.allowed === true}
            inviteToken={invite}
            authError={params.authError === '1'}
            providers={earlyBirdOAuthAvailability()}
        />
    );
}
