'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type { UiLocale } from '@/lib/i18n';

export function trustedAccountLogoutURL(
    raw: unknown,
    accountHref: 'https://account-staging.harmonicbeacon.com/account',
): string | null {
    if (typeof raw !== 'string') return null;
    try {
        const accountOrigin = new URL(accountHref).origin;
        const logoutURL = new URL(raw);
        if (
            logoutURL.protocol !== 'https:' ||
            logoutURL.origin !== accountOrigin ||
            logoutURL.pathname !== '/account/logout' ||
            logoutURL.username ||
            logoutURL.password
        ) return null;
        return logoutURL.href;
    } catch {
        return null;
    }
}

export function LiveNavigationAccountMenu({
    displayName,
    staffRoleLabel,
    accountHref,
    locale,
}: {
    displayName: string | null;
    staffRoleLabel: string | null;
    accountHref: 'https://account-staging.harmonicbeacon.com/account';
    locale: UiLocale;
}) {
    const [busy, setBusy] = useState(false);
    const [signOutError, setSignOutError] = useState(false);
    const router = useRouter();
    const es = locale === 'es';
    const accountURL = new URL(accountHref);
    accountURL.searchParams.set('lang', locale);

    async function signOut() {
        if (busy) return;
        setBusy(true);
        setSignOutError(false);
        try {
            const response = await fetch('/api/auth/logout', {
                method: 'POST',
                headers: { Accept: 'application/json' },
            });
            if (!response.ok) throw new Error('Live sign-out failed');
            const body = await response.json() as { issuerLogoutUrl?: unknown };
            if (body.issuerLogoutUrl !== undefined) {
                const logoutURL = trustedAccountLogoutURL(body.issuerLogoutUrl, accountHref);
                if (!logoutURL) throw new Error('Unexpected Account logout origin');
                window.location.assign(logoutURL);
                return;
            }
            router.replace('/');
            router.refresh();
        } catch {
            setBusy(false);
            setSignOutError(true);
        }
    }

    return (
        <div className="hb-live-account-menu">
            {displayName && <p className="hb-live-account-menu__identity">{displayName}</p>}
            {staffRoleLabel && <p className="hb-live-account-menu__role">{staffRoleLabel}</p>}
            <a role="menuitem" href={accountURL.toString()}>
                {es ? 'Cuenta' : 'Account'}
            </a>
            {staffRoleLabel && (
                <Link role="menuitem" href="/ops/events">
                    {es ? 'Operaciones' : 'Operations'}
                </Link>
            )}
            <button type="button" role="menuitem" disabled={busy} onClick={signOut}>
                {busy
                    ? es ? 'Cerrando…' : 'Signing out…'
                    : es ? 'Cerrar sesión' : 'Sign out'}
            </button>
            {signOutError && (
                <small role="alert">
                    {es
                        ? 'No pudimos cerrar la sesión. Intentá de nuevo.'
                        : 'We could not sign you out. Please try again.'}
                </small>
            )}
        </div>
    );
}
