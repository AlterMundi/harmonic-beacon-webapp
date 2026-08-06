import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import ConductorCockpit from '@/components/ops/ConductorCockpit';
import { prisma } from '@/lib/db';
import { messages } from '@/lib/i18n';
import { requestLocale } from '@/lib/i18n-server';
import { resolveStaffByToken } from '@/lib/ops-auth';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';
import { eventStaffPolicy } from '@/lib/staff-capabilities';
import { resolveStaffLanding } from '@/lib/staff-navigation';

export const dynamic = 'force-dynamic';

export default async function EventPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const cookieStore = await cookies();
    const staff = await resolveStaffByToken(cookieStore.get(SESSION_COOKIE_NAME)?.value);
    if (!staff) redirect('/staff/login');

    const scheduledSession = await prisma.scheduledSession.findUnique({
        where: { id },
        select: {
            id: true,
            title: true,
            language: true,
            status: true,
            scheduledAt: true,
            facilitatorId: true,
            attendeeCap: true,
        },
    });
    const canOpen = scheduledSession &&
        (scheduledSession.status === 'SCHEDULED' || scheduledSession.status === 'LIVE') &&
        eventStaffPolicy(
            staff.role,
            scheduledSession.facilitatorId === staff.id,
        ).canOperateEvent;

    if (!canOpen) {
        const locale = await requestLocale();
        const copy = messages[locale].ops;
        const recovery = await resolveStaffLanding(staff);
        return (
            <section className="mx-auto max-w-xl py-16 text-center">
                <p className="text-[10px] font-mono uppercase tracking-[0.16em] text-[var(--gold)]">404</p>
                <h1 className="mt-3 font-serif text-3xl text-[var(--paper)]">{copy.unavailableTitle}</h1>
                <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--text-secondary)]">
                    {copy.unavailableBody}
                </p>
                <Link href={recovery} className="event-button event-button--primary mt-7 inline-flex">
                    {copy.recover} →
                </Link>
            </section>
        );
    }

    const locale = await requestLocale(scheduledSession.language);
    const copy = messages[locale].ops;
    return (
        <section className="mx-auto max-w-4xl py-4">
            <div className="mb-1 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <p className="text-xs font-mono uppercase tracking-[0.12em] text-[var(--gold)]">
                        {copy.eventConsole}
                    </p>
                    <h1 className="mt-1 font-serif text-3xl text-[var(--paper)]">
                        {scheduledSession.title}
                    </h1>
                </div>
            </div>
            <p className="mb-6 text-sm text-[var(--text-secondary)]">
                {scheduledSession.language === 'SPANISH' ? 'ES' : 'EN'} ·{' '}
                {scheduledSession.status === 'LIVE' ? copy.live : copy.scheduled} ·{' '}
                {new Intl.DateTimeFormat(locale === 'es' ? 'es-AR' : 'en-GB', {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                }).format(scheduledSession.scheduledAt)}
            </p>
            <ConductorCockpit
                session={{
                    id: scheduledSession.id,
                    title: scheduledSession.title,
                    status: scheduledSession.status,
                    scheduledAt: scheduledSession.scheduledAt.toISOString(),
                }}
                role={staff.role}
                locale={locale}
                admissionEvents={[{
                    id: scheduledSession.id,
                    title: scheduledSession.title,
                    language: scheduledSession.language,
                    scheduledAt: scheduledSession.scheduledAt.toISOString(),
                    attendeeCap: scheduledSession.attendeeCap,
                }]}
                copy={copy.cockpit}
                lifecycleCopy={copy.lifecycle}
                spotlightCopy={copy.spotlight}
                healthCopy={copy.healthPanel}
                admissionCopy={copy.admissionPanel}
                contributionsCopy={copy.contributionsPanel}
                tapestryCopy={copy.tapestryArrange}
                opsTapestryCopy={copy.opsTapestry}
                staffRoleLabels={messages[locale].staffRoles}
            />
        </section>
    );
}
