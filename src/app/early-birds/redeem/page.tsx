import { redirect } from 'next/navigation';
import { headers } from 'next/headers';

import FreeInvitationRedeemer from '@/components/early-birds/FreeInvitationRedeemer';
import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { earlyBirdsEnabled } from '@/lib/early-birds/enabled';
import {
    listenerInvitationFromCookieHeader,
} from '@/lib/early-birds/invitation-cookie';
import { LISTENER_NAMESPACE } from '@/lib/listener/namespace';

export const dynamic = 'force-dynamic';

export default async function EarlyBirdRedeemPage() {
    if (!earlyBirdsEnabled()) redirect(LISTENER_NAMESPACE.canonical.home);

    const incomingHeaders = await headers();
    const token = listenerInvitationFromCookieHeader(incomingHeaders.get('cookie'));
    if (!token) redirect(LISTENER_NAMESPACE.canonical.home);

    const session = await currentEarlyBirdSession().catch(() => null);
    if (!session) redirect(LISTENER_NAMESPACE.canonical.home);

    return <FreeInvitationRedeemer />;
}
