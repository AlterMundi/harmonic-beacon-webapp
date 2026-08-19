'use client';

import { useState } from 'react';

import { recoverListenerIdentity } from '@/lib/early-birds/auth-client';
import type { UiLocale } from '@/lib/i18n';

export function ListenerNavigationAccountMenu({
    displayName,
    accountHref,
    locale,
}: {
    displayName: string;
    accountHref: 'https://account.harmonicbeacon.com/account' | 'https://account-staging.harmonicbeacon.com/account';
    locale: UiLocale;
}) {
    const [signOutError, setSignOutError] = useState(false);
    const es = locale === 'es';
    const accountURL = new URL(accountHref);
    accountURL.searchParams.set('lang', locale);

    async function signOut() {
        setSignOutError(false);
        if (!await recoverListenerIdentity()) setSignOutError(true);
    }

    return (
        <div className="hb-listener-account-menu">
            <p className="hb-listener-account-menu__identity">{displayName}</p>
            <a role="menuitem" href={accountURL.toString()}>
                {es ? 'Cuenta' : 'Account'}
            </a>
            <a role="menuitem" href="/listener/membership">
                {es ? 'Membresía' : 'Membership'}
            </a>
            <button type="button" role="menuitem" onClick={signOut}>
                {es ? 'Cerrar sesión' : 'Sign out'}
            </button>
            {signOutError && (
                <small role="alert">
                    {es
                        ? 'No pudimos preparar un nuevo ingreso. Intentá de nuevo.'
                        : 'We could not prepare a new sign-in. Please try again.'}
                </small>
            )}
        </div>
    );
}
