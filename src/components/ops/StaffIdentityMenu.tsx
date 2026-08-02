'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function StaffIdentityMenu({
    name,
    roleLabel,
    signedInAs,
    signOut,
}: {
    name: string;
    roleLabel: string;
    signedInAs: string;
    signOut: string;
}) {
    const [busy, setBusy] = useState(false);
    const router = useRouter();

    async function logout() {
        if (busy) return;
        setBusy(true);
        try {
            await fetch('/api/auth/logout', { method: 'POST' });
        } finally {
            router.replace('/staff/login');
            router.refresh();
        }
    }

    return (
        <details className="relative ml-auto">
            <summary className="flex min-h-11 cursor-pointer list-none flex-col justify-center rounded-md border border-white/10 px-3 py-1.5 text-right hover:bg-white/5">
                <span className="block text-xs font-medium text-[var(--paper)]">{name}</span>
                <span className="block text-xs text-[var(--text-muted)]">{roleLabel}</span>
            </summary>
            <div className="absolute right-0 z-30 mt-2 min-w-52 rounded-lg border border-[var(--border-subtle)] bg-[var(--forest)] p-3 shadow-xl">
                <p className="text-xs uppercase tracking-wider text-[var(--text-muted)]">{signedInAs}</p>
                <p className="mt-1 text-sm text-[var(--paper)]">{name}</p>
                <p className="text-xs text-[var(--text-secondary)]">{roleLabel}</p>
                <button
                    type="button"
                    disabled={busy}
                    onClick={logout}
                    className="mt-3 min-h-11 w-full rounded border border-white/15 px-3 py-2 text-left text-xs text-[var(--text-secondary)] hover:bg-white/5 hover:text-[var(--paper)] disabled:opacity-50"
                >
                    {signOut}
                </button>
            </div>
        </details>
    );
}
