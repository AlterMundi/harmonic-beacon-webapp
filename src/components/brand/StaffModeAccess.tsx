'use client';

import { useLocale } from '@/context/LocaleContext';
import type { LocalizedStaffRole } from '@/lib/i18n';

/** Discoverability only. Server-side staff authorization remains unchanged. */
export function StaffModeAccess({ availableRole, activeStaffRole }: {
    availableRole: LocalizedStaffRole | null;
    activeStaffRole: LocalizedStaffRole | null;
}) {
    const { locale, copy } = useLocale();
    if (!availableRole) return null;
    const es = locale === 'es';
    const manages = availableRole === 'ADMIN' || availableRole === 'FACILITATOR_OP';
    const destination = manages ? '/ops/events/manage' : '/ops/events';
    const staffHref = activeStaffRole ? destination
        : `/api/account/login?flow=staff&next=${encodeURIComponent(destination)}`;
    const participantHref = activeStaffRole ? '/api/account/login?flow=attendee&next=%2F' : '/';
    return <aside aria-label={es ? 'Modo de acceso' : 'Access mode'}
        className="relative z-10 border-b border-[var(--border-subtle)] bg-[var(--night)] text-[var(--paper)]">
        <div className="mx-auto flex max-w-[1120px] flex-wrap items-center justify-between gap-3 px-6 py-3 text-sm">
            <p><span className="font-semibold">{copy.staffRoles[availableRole]}</span>
                {' · '}{activeStaffRole
                    ? (es ? 'Estás en modo equipo' : 'You are in staff mode')
                    : (es ? 'Estás en modo participante' : 'You are in participant mode')}</p>
            <nav aria-label={es ? 'Elegir modo' : 'Choose mode'} className="flex flex-wrap gap-x-5 gap-y-3">
                <a href={staffHref} className="text-[var(--gold)] underline underline-offset-4 focus-visible:outline focus-visible:outline-2">
                    {manages ? (es ? 'Administrar eventos' : 'Manage events') : (es ? 'Ir a operaciones' : 'Open operations')}
                </a>
                <a href={participantHref} className="underline underline-offset-4 focus-visible:outline focus-visible:outline-2">
                    {es ? 'Entrar como participante' : 'Enter as participant'}
                </a>
            </nav>
        </div>
    </aside>;
}
