import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import ProfileDashboard from '@/components/profile/ProfileDashboard';
import { beaconAccountEnabled } from '@/lib/account-rp';
import { resolveLiveProfile } from '@/lib/live-profile';
import { globalNavigationAccountHref } from '@/lib/brand/global-navigation';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Mi Beacon | Harmonic Beacon', robots: { index: false, follow: false } };

export default async function ProfilePage() {
    const profile = await resolveLiveProfile();
    if (!profile) redirect(beaconAccountEnabled() ? '/api/account/login?flow=attendee&next=%2Fprofile' : '/login');
    return <ProfileDashboard accountHref={globalNavigationAccountHref(await headers())} profile={{ ...profile,
        events: profile.events?.map(event => ({ ...event, scheduledAt: event.scheduledAt.toISOString() })) ?? null,
    }} />;
}
