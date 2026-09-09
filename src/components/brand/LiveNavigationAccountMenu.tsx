'use client';

import { useState } from 'react';
import { useLocale } from '@/context/LocaleContext';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { liveNavigationCopy } from '@/lib/live-navigation-copy';
import type { LocalizedStaffRole, UiLocale } from '@/lib/i18n';

type AccountHref =
    | 'https://account.harmonicbeacon.com/account'
    | 'https://account-staging.harmonicbeacon.com/account';

export function trustedAccountLogoutURL(
    raw: unknown,
    accountHref: AccountHref,
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
    staffRole,
    accountHref,
}: {
    displayName: string | null;
    staffRoleLabel: string | null;
    staffRole?: LocalizedStaffRole | null;
    accountHref: AccountHref;
    locale: UiLocale;
}) {
    const { locale, copy } = useLocale();
    const roleLabel = staffRole ? copy.staffRoles[staffRole] : staffRoleLabel;
    const [busy, setBusy] = useState(false);
    const [signOutError, setSignOutError] = useState(false);
    const router = useRouter();
    const navCopy = liveNavigationCopy[locale];
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
            {roleLabel && <p className="hb-live-account-menu__role">{roleLabel}</p>}
            <a role="menuitem" href={accountURL.toString()}>
                {navCopy.account}
            </a>
            {staffRoleLabel && (
                <Link role="menuitem" href="/ops/events">
                    {navCopy.operations}
                </Link>
            )}
            <button type="button" role="menuitem" disabled={busy} onClick={signOut}>
                {busy ? navCopy.signingOut : navCopy.signOut}
            </button>
            {signOutError && (
                <small role="alert">
                    {navCopy.signOutError}
                </small>
            )}
        </div>
    );
}
