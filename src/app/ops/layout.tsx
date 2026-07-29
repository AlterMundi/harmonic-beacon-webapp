import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

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

    return (
        <div className="min-h-screen">
            <nav className="border-b border-white/10 bg-black/40 px-4 py-3">
                <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 text-sm">
                    <span className="font-semibold text-[var(--text-primary)]">
                        Beacon Ops
                    </span>
                    <span className="text-[var(--text-secondary)]">
                        {staff.name} ({staff.role})
                    </span>
                    <span className="mx-1 text-white/20">|</span>
                    <Link
                        href="/ops/health"
                        className="text-[var(--text-secondary)] underline-offset-4 hover:text-[var(--text-primary)] hover:underline"
                    >
                        Health
                    </Link>
                    <Link
                        href="/ops/admission"
                        className="text-[var(--text-secondary)] underline-offset-4 hover:text-[var(--text-primary)] hover:underline"
                    >
                        Admission
                    </Link>
                    {sessions.map((s) => (
                        <Link
                            key={s.id}
                            href={`/ops/session/${s.id}`}
                            className="text-[var(--text-secondary)] underline-offset-4 hover:text-[var(--text-primary)] hover:underline"
                        >
                            {s.language === 'SPANISH' ? 'ES' : 'EN'} Spotlight
                            {s.status === 'LIVE' && (
                                <span className="ml-1 inline-block h-2 w-2 rounded-full bg-green-400" />
                            )}
                        </Link>
                    ))}
                    <span className="mx-1 text-white/20">|</span>
                    <Link
                        href="/"
                        className="text-[var(--text-secondary)] underline-offset-4 hover:text-[var(--text-primary)] hover:underline"
                    >
                        Public site
                    </Link>
                </div>
            </nav>
            {children}
        </div>
    );
}
