import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveStaffByToken } from '@/lib/ops-auth';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';
import { hasStaffCapability } from '@/lib/staff-capabilities';
import { requestLocale } from '@/lib/i18n-server';
import EventEditor from './EventEditor';

export const dynamic = 'force-dynamic';
export default async function ManageEventsPage() {
    const jar = await cookies();
    const staff = await resolveStaffByToken(jar.get(SESSION_COOKIE_NAME)?.value);
    if (!staff) redirect('/staff/login');
    if (!hasStaffCapability(staff.role,'administer_system')) redirect('/ops/events');
    return <EventEditor locale={await requestLocale()} />;
}
