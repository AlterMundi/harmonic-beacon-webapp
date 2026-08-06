import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';

import FreeInvitationRedeemer from '@/components/early-birds/FreeInvitationRedeemer';
import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { earlyBirdsEnabled } from '@/lib/early-birds/enabled';
import {
    canonicalEarlyBirdInvitation,
    EARLY_BIRD_INVITATION_COOKIE,
} from '@/lib/early-birds/invitation-cookie';

export const dynamic = 'force-dynamic';

export default async function EarlyBirdRedeemPage() {
    if (!earlyBirdsEnabled()) redirect('/early-birds');

    const cookieStore = await cookies();
    const token = canonicalEarlyBirdInvitation(
        cookieStore.get(EARLY_BIRD_INVITATION_COOKIE)?.value,
    );
    if (!token) redirect('/early-birds');

    const session = await currentEarlyBirdSession().catch(() => null);
    if (!session) redirect('/early-birds');

    return <FreeInvitationRedeemer />;
}
