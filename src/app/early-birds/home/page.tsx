import { redirect } from 'next/navigation';

import EarlyBirdHome from '@/components/early-birds/EarlyBirdHome';
import { currentEarlyBirdSession } from '@/lib/early-birds/auth';
import { getEarlyBirdAccess } from '@/lib/early-birds/membership';

export const dynamic = 'force-dynamic';

function configuredMediaUrl(name: string): string | null {
    const value = process.env[name]?.trim();
    if (!value) return null;
    try {
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol)) return null;
        if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') return null;
        return url.toString();
    } catch {
        return null;
    }
}

export default async function EarlyBirdHomePage() {
    const session = await currentEarlyBirdSession().catch(() => null);
    if (!session) redirect('/early-birds');
    const access = await getEarlyBirdAccess(session.user.id).catch(() => null);
    if (!access?.allowed || !access.projection) redirect('/early-birds?membership=required');

    return (
        <EarlyBirdHome
            displayName={session.user.name}
            membershipSource={access.projection.source}
            dropIns={{
                es: configuredMediaUrl('EARLY_BIRDS_DROPIN_ES_URL'),
                en: configuredMediaUrl('EARLY_BIRDS_DROPIN_EN_URL'),
            }}
        />
    );
}
