import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import FreeInvitationRedeemer from '@/components/early-birds/FreeInvitationRedeemer';
import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { earlyBirdsEnabled } from '@/lib/early-birds/enabled';
import {
    canonicalEarlyBirdInvitation,
    EARLY_BIRD_INVITATION_COOKIE,
} from '@/lib/early-birds/invitation-cookie';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

export const dynamic = 'force-dynamic';

export default async function EarlyBirdRedeemPage() {
    if (!earlyBirdsEnabled()) redirect(LISTENER_NAMESPACE.canonical.home);

    const cookieStore = await cookies();
    const token = canonicalEarlyBirdInvitation(
        cookieStore.get(EARLY_BIRD_INVITATION_COOKIE)?.value,
    );
    if (!token) redirect(LISTENER_NAMESPACE.canonical.home);

    const session = await currentEarlyBirdSession().catch(() => null);
    if (!session) redirect(LISTENER_NAMESPACE.canonical.home);

    return <FreeInvitationRedeemer />;
}
