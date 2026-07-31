/**
 * Spotlight operator console (`/ops/session/[id]`) — WS3-02.
 *
 * Staff-only surface. Like the other /ops pages, the cookie is resolved
 * against the database on every load; middleware is navigation, not the
 * boundary. A facilitator sees only the event they facilitate, matching the
 * scoping the stage/participants API routes enforce on every mutation.
 */

import { cookies } from 'next/headers';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import SpotlightConsole from '@/components/ops/SpotlightConsole';
import TapestryArrange from '@/components/ops/TapestryArrange';
import { prisma } from '@/lib/db';
import { resolveStaffByToken } from '@/lib/ops-auth';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';

export const dynamic = 'force-dynamic';

export default async function OpsSessionPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const cookieStore = await cookies();
    const staff = await resolveStaffByToken(
        cookieStore.get(SESSION_COOKIE_NAME)?.value,
    );
    if (!staff) {
        redirect('/staff/login');
    }

    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id },
        select: {
            id: true,
            title: true,
            language: true,
            status: true,
            scheduledAt: true,
            facilitatorId: true,
        },
    });
    if (!scheduledSession) {
        notFound();
    }
    if (
        staff.role === 'FACILITATOR' &&
        scheduledSession.facilitatorId !== staff.id
    ) {
        return (
            <main className="mx-auto max-w-3xl px-4 py-8">
                <h1 className="mb-2 text-2xl font-semibold">Not your event</h1>
                <p className="text-sm text-[var(--text-secondary)]">
                    This console is limited to the facilitator assigned to the
                    event, plus operators and admins.
                </p>
            </main>
        );
    }

    return (
        <main className="mx-auto max-w-4xl px-4 py-8">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-semibold">
                    Spotlight console — {scheduledSession.title}
                </h1>
                <Link
                    href={`/session/${scheduledSession.id}`}
                    className="rounded border border-[var(--gold)]/40 px-3 py-2 text-sm text-[var(--gold)] hover:bg-[var(--gold)]/10"
                >
                    Enter session room →
                </Link>
            </div>
            <p className="mb-6 text-sm text-[var(--text-secondary)]">
                {scheduledSession.language} · {scheduledSession.status} ·{' '}
                {scheduledSession.scheduledAt.toISOString()} · signed in as{' '}
                {staff.name} ({staff.role})
            </p>
            <SpotlightConsole sessionId={scheduledSession.id} role={staff.role} />
            <TapestryArrange sessionId={scheduledSession.id} />
        </main>
    );
}
