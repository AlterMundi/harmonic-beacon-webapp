import { redirect } from 'next/navigation';

import FreeInvitationRedeemer from '@/components/early-birds/FreeInvitationRedeemer';
import { currentEarlyBirdSession } from '@/lib/early-birds/auth';

export const dynamic = 'force-dynamic';

export default async function EarlyBirdRedeemPage({
    searchParams,
}: {
    searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
    const params = await searchParams;
    const token = typeof params.token === 'string' && params.token.length <= 512
        ? params.token
        : null;
    if (!token) redirect('/early-birds');

    const session = await currentEarlyBirdSession().catch(() => null);
    if (!session) redirect(`/early-birds?invite=${encodeURIComponent(token)}`);

    return <FreeInvitationRedeemer token={token} />;
}
