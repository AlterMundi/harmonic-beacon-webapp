import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import AnalyticsDashboard from './AnalyticsDashboard';
import { effectiveAnalyticsRole } from '@/lib/analytics-access';
import { resolveStaffByToken } from '@/lib/ops-auth';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';

export const dynamic = 'force-dynamic';

export default async function AnalyticsPage() {
    const jar = await cookies();
    const staff = await resolveStaffByToken(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!staff) redirect('/staff/login');
    const role = await effectiveAnalyticsRole(staff);
    if (!role) redirect('/ops/events');
    return <AnalyticsDashboard canExport={role !== 'ANALYTICS_VIEWER'} />;
}
