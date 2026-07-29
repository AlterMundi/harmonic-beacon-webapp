import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import OpsNavLinks from '@/components/ops/OpsNavLinks';
import { prisma } from '@/lib/db';
import { resolveStaffByToken } from '@/lib/ops-auth';
import { SESSION_COOKIE_NAME } from '@/lib/session-auth';

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

    const sessions = await prisma.scheduledSession.findMany({
        select: { id: true, title: true, language: true, status: true },
        orderBy: { scheduledAt: 'asc' },
    });

    const links = [
        { href: '/ops/health', label: 'Health' },
        { href: '/ops/admission', label: 'Admission' },
        ...sessions.map((s) => ({
            href: `/ops/session/${s.id}`,
            label: s.language === 'SPANISH' ? 'ES Spotlight' : 'EN Spotlight',
            live: s.status === 'LIVE',
        })),
    ];

    return (
        <div className="min-h-screen">
            <nav className="border-b border-white/10 bg-black/40 px-4 py-2.5">
                <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <Link
                        href="/ops/health"
                        className="font-semibold text-[var(--text-primary)]"
                    >
                        Beacon Ops
                    </Link>
                    <span className="text-[var(--text-secondary)]">
                        {staff.name} · {staff.role}
                    </span>
                    <span className="mx-1 hidden text-white/20 sm:inline">|</span>
                    <OpsNavLinks links={links} />
                    <span className="mx-1 hidden text-white/20 sm:inline">|</span>
                    <Link
                        href="/"
                        className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    >
                        Public site
                    </Link>
                </div>
            </nav>
            {children}
        </div>
    );
}
