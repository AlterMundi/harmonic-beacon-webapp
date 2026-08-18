import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import OpsNavLinks from '@/components/ops/OpsNavLinks';
import { resolveStaffByToken } from '@/lib/ops-auth';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';
import { messages, staffRolePresentation } from '@/lib/i18n';
import { requestLocale } from '@/lib/i18n-server';
import StaffIdentityMenu from '@/components/ops/StaffIdentityMenu';

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

    const locale = await requestLocale();
    const copy = messages[locale];
    const rolePresentation = staffRolePresentation(copy, staff.role);

    const links = [
        { href: '/ops/events', label: copy.ops.events },
        { href: '/ops/health', label: copy.ops.health },
        { href: '/ops/admission', label: copy.ops.admission },
    ];

    return (
        <div className="live-ops-shell min-h-screen bg-[var(--night)]">
            <nav
                aria-label={locale === 'es' ? 'Operaciones de eventos' : 'Event operations'}
                className="border-b border-[var(--border-subtle)] bg-[var(--forest)]/80 px-4 py-2.5"
            >
                <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <Link
                        href="/ops/events"
                        className="font-semibold text-[var(--paper)]"
                    >
                        {copy.ops.brand}
                    </Link>
                    <span className="mx-1 hidden text-white/20 sm:inline">|</span>
                    <OpsNavLinks links={links} />
                    <span className="mx-1 hidden text-white/20 sm:inline">|</span>
                    <Link
                        href="/"
                        className="inline-flex min-h-11 items-center px-2 text-[var(--text-secondary)] hover:text-[var(--paper)]"
                    >
                        {copy.ops.publicSite}
                    </Link>
                    <StaffIdentityMenu
                        name={staff.name}
                        roleLabel={rolePresentation.label}
                        roleDescription={rolePresentation.description}
                        signedInAs={copy.ops.signedInAs}
                        signOut={copy.ops.signOut}
                    />
                </div>
            </nav>
            <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
        </div>
    );
}
