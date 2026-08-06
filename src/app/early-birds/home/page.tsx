import { redirect } from 'next/navigation';

import EarlyBirdHome from '@/components/early-birds/EarlyBirdHome';
import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { configuredEarlyBirdDropIn } from '@/lib/early-birds/drop-ins';
import { getEarlyBirdAccess } from '@/lib/early-birds/membership';
import { earlyBirdsEnabled } from '@/lib/early-birds/enabled';

export const dynamic = 'force-dynamic';

export default async function EarlyBirdHomePage() {
    if (!earlyBirdsEnabled()) redirect('/early-birds');

    const session = await currentEarlyBirdSession().catch(() => null);
    if (!session) redirect('/early-birds');
    const access = await getEarlyBirdAccess(session.user.id).catch(() => null);
    if (!access?.allowed || !access.projection) redirect('/early-birds?membership=required');

    return (
        <EarlyBirdHome
            displayName={session.user.name}
            membershipSource={access.projection.source}
            dropIns={{
                es: configuredEarlyBirdDropIn('es'),
                en: configuredEarlyBirdDropIn('en'),
            }}
        />
    );
}
