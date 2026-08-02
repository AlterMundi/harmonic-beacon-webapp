/**
 * Operator event health dashboard (`/ops/health`).
 *
 * Staff-only surface. `middleware.ts` redirects cookie-less visitors to the
 * staff sign-in, but the authoritative check is here: the principal is
 * resolved against the database on every load, so a disabled staff account
 * sees the login page again rather than a stale dashboard.
 */

import { redirect } from 'next/navigation';

import { currentPrincipal } from '@/lib/auth';
import { messages } from '@/lib/i18n';
import { requestLocale } from '@/lib/i18n-server';

import OpsHealthClient from './OpsHealthClient';

export const dynamic = 'force-dynamic';

export default async function OpsHealthPage({
    searchParams,
}: {
    searchParams: Promise<{ sessionId?: string | string[] }>;
}) {
    const principal = await currentPrincipal().catch(() => null);
    if (!principal || principal.kind !== 'staff') {
        redirect('/staff/login');
    }
    const requestedSessionId = (await searchParams).sessionId;
    const sessionId = typeof requestedSessionId === 'string'
        ? requestedSessionId
        : undefined;
    const locale = await requestLocale();
    const copy = messages[locale].ops.healthPanel;

    return (
        <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-10">
            <header className="space-y-1">
                <h1 className="text-2xl font-bold">{copy.pageTitle}</h1>
                <p className="text-sm text-[var(--text-secondary)]">
                    {copy.pageIntro}{' '}
                    <code>docs/ops/WEEKEND_EVENT_RUNBOOK.md</code>.
                </p>
            </header>

            <OpsHealthClient
                role={principal.role}
                sessionId={sessionId}
                locale={locale}
                copy={copy}
                staffRoles={messages[locale].staffRoles}
            />
        </main>
    );
}
