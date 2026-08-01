/**
 * Operator admission console (/ops/admission).
 *
 * Staff-only surface: the page resolves the hb_session cookie against the
 * database on every load and sends anyone without an active staff session to
 * the staff login. The API routes re-check authorization for every call; this
 * gate is navigation, not the boundary.
 */

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import AdmissionConsole from '@/components/ops/AdmissionConsole';
import { prisma } from '@/lib/db';
import { resolveStaffByToken } from '@/lib/ops-auth';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';

export const dynamic = 'force-dynamic';

export default async function AdmissionPage() {
    const cookieStore = await cookies();
    const staff = await resolveStaffByToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
    if (!staff) {
        redirect('/staff/login');
    }

    const events = await prisma.scheduledSession.findMany({
        orderBy: { scheduledAt: 'asc' },
        select: { id: true, title: true, language: true, scheduledAt: true, attendeeCap: true },
    });

    return (
        <main className="mx-auto max-w-4xl px-4 py-8">
            <h1 className="mb-1 text-2xl font-semibold">Admission support</h1>
            <p className="mb-6 text-sm text-[var(--text-secondary)]">
                Signed in as {staff.name} ({staff.role}). Every mutation requires a non-PII reason and is audited.
            </p>
            <AdmissionConsole
                role={staff.role}
                events={events.map((event) => ({
                    id: event.id,
                    title: event.title,
                    language: event.language,
                    scheduledAt: event.scheduledAt.toISOString(),
                    attendeeCap: event.attendeeCap,
                }))}
            />
        </main>
    );
}
