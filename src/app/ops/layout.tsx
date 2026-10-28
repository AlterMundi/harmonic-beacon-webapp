import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { OpsNavigation } from '@/components/ops/LiveLocaleSurfaces';
import { resolveStaffByToken } from '@/lib/ops-auth';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';
import { effectiveAnalyticsRole } from '@/lib/analytics-access';
import { RoomSiteChrome } from '@/components/navigation/RoomSiteChrome';

export const dynamic = 'force-dynamic';

export default async function OpsLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const cookieStore = await cookies();
    const staff = await resolveStaffByToken(
        cookieStore.get(SESSION_COOKIE_NAME)?.value,
    );
    if (!staff) {
        redirect('/staff/login');
    }

    const analyticsRole = await effectiveAnalyticsRole(staff).catch(() => null);

    return (
        <div className="live-ops-shell min-h-screen bg-[var(--night)]">
            <RoomSiteChrome><OpsNavigation analytics={Boolean(analyticsRole)} /></RoomSiteChrome>
            <main className="hb-ops-content mx-auto max-w-5xl px-4 py-6">{children}</main>
        </div>
    );
}
