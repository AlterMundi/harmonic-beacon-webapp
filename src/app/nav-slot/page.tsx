import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { currentAccountSession } from '@/lib/account/auth';
import { isAccountHost } from '@/lib/account/config';

export const dynamic = 'force-dynamic';

export default async function AccountNavSlot() {
    const incoming = await headers();
    if (!isAccountHost(incoming.get('host'))) notFound();
    const session = await currentAccountSession(new Headers(incoming)).catch(() => null);
    const label = session ? session.profile.displayName.slice(0, 1).toLocaleUpperCase() : '◯';
    return <main className="account-nav-slot" aria-label={session ? 'Signed-in Account' : 'Account'} style={{
        width: 44, height: 44, display: 'grid', placeItems: 'center', overflow: 'hidden',
        color: '#f4eee2', background: 'transparent', font: '600 16px Inter, system-ui, sans-serif',
    }}><span aria-hidden="true" style={{
        width: 36, height: 36, border: '1px solid rgba(201,162,78,.55)', borderRadius: '50%',
        display: 'grid', placeItems: 'center', background: 'rgba(22,18,13,.82)',
    }}>{label}</span></main>;
}
