'use client';

import { useState } from 'react';
import { useRoomExit } from '@/components/navigation/RoomExitGuard';
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
    accountIssuer: string,
): string | null {
    if (typeof raw !== 'string') return null;
    try {
        const accountOrigin = new URL(accountIssuer).origin;
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
    accountIssuer,
}: {
    displayName: string | null;
    staffRoleLabel: string | null;
    staffRole?: LocalizedStaffRole | null;
    accountHref: AccountHref;
    accountIssuer: string;
    locale: UiLocale;
}) {
    const { locale, copy } = useLocale();
    const roleLabel = staffRole ? copy.staffRoles[staffRole] : staffRoleLabel;
    const [busy, setBusy] = useState(false);
    const [signOutError, setSignOutError] = useState(false);
    const router = useRouter();
    const requestExit = useRoomExit();
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
                const logoutURL = trustedAccountLogoutURL(body.issuerLogoutUrl, accountIssuer);
                if (!logoutURL) throw new Error('Unexpected Account logout origin');
                window.location.assign(logoutURL);
                return;
            }
            router.replace('/');
            router.refresh();
        } catch {
            setBusy(false);
            setSignOutError(true);
            return false;
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
            <button type="button" role="menuitem" disabled={busy} onClick={event => { event.currentTarget.focus(); requestExit(signOut); }}>
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
