import { createElement, type ReactNode } from 'react';
import Script from 'next/script';

import type { UiLocale } from '@/lib/i18n';

// Byte-pinned local navigation with the selected Beacon curve. Protected product
// origins never execute remotely supplied JavaScript with their host cookies.
export const GLOBAL_NAVIGATION_ASSET = '/assets/hb-global-nav.js';
export const GLOBAL_NAVIGATION_PROVENANCE = 'beacon-mark-7e8f789341ed1db5';
export const GLOBAL_NAVIGATION_SHA256 = '3d3916d26d97b5e8591887bebcb349e83bccd6b5fb0c24efd18d1d63fd5cccb1';

export type GlobalNavigationSurface = 'events' | 'listen' | 'account';

const links = [
    { key: 'events', href: 'https://live.harmonicbeacon.com/', en: 'Events', es: 'Eventos' },
    { key: 'listen', href: 'https://listen.harmonicbeacon.com/', en: 'Listen', es: 'Escuchar' },
    { key: 'news', href: 'https://harmonicbeacon.com/eventos/', en: 'News', es: 'Novedades' },
] as const;

function withLanguage(href: string, locale: UiLocale): string {
    const url = new URL(href);
    url.searchParams.set('lang', locale);
    return url.toString();
}

export function GlobalNavigation({
    active,
    locale,
    allowRemoteEnhancement = true,
    accountHref,
    accountSignedIn = false,
    accountMenu,
}: {
    active: GlobalNavigationSurface;
    locale: UiLocale;
    allowRemoteEnhancement?: boolean;
    accountHref?: 'https://account.harmonicbeacon.com/account' | 'https://account-staging.harmonicbeacon.com/account' | null;
    accountSignedIn?: boolean;
    accountMenu?: ReactNode;
}) {
    const navLabel = locale === 'es' ? 'Navegación principal' : 'Primary navigation';
    const userMenuLabel = locale === 'es'
        ? accountSignedIn ? 'Menú de usuario, sesión iniciada' : 'Menú de usuario'
        : accountSignedIn ? 'User menu, signed in' : 'User menu';
    const accountLabel = locale === 'es' ? 'Cuenta' : 'Account';
    const fallback = (
        <nav key="fallback" className="hb-global-navigation-fallback" aria-label={navLabel}>
            <a className="hb-global-navigation-fallback__brand" href={withLanguage('https://harmonicbeacon.com/', locale)}>
                Harmonic Beacon
            </a>
            <div className="hb-global-navigation-fallback__actions">
                <ul>
                    {links.map((link) => (
                        <li key={link.key}>
                            <a
                                href={withLanguage(link.href, locale)}
                                aria-current={link.key === active ? 'page' : undefined}
                            >
                                {locale === 'es' ? link.es : link.en}
                            </a>
                        </li>
                    ))}
                </ul>
                {accountHref && <details className={`hb-global-navigation-fallback__account-control${accountSignedIn ? ' hb-global-navigation-fallback__account-control--signed-in' : ''}`}>
                    <summary aria-label={userMenuLabel}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                            <circle cx="12" cy="8" r="3.25" />
                            <path d="M5.75 19c.6-3.25 2.7-5 6.25-5s5.65 1.75 6.25 5" />
                        </svg>
                    </summary>
                    <div className="hb-global-navigation-fallback__account-menu" role="menu">
                        <a
                            href={withLanguage(accountHref, locale)}
                            role="menuitem"
                            aria-current={active === 'account' ? 'page' : undefined}
                        >
                            {accountLabel}
                        </a>
                        {accountSignedIn && active === 'listen' && (
                            <a href="/listener/membership" role="menuitem">
                                {locale === 'es' ? 'Membresía' : 'Membership'}
                            </a>
                        )}
                    </div>
                </details>}
            </div>
        </nav>
    );

    return (
        <>
            {createElement('hb-global-nav', {
                'data-surface': active,
                ...(accountHref ? { 'data-account-available': '' } : {}),
                ...(accountSignedIn ? { 'data-account-signed-in': '' } : {}),
            }, fallback, accountMenu ? (
                <div key="account-menu" slot="account-menu" className="hb-global-navigation-local-account-slot">
                    {accountMenu}
                </div>
            ) : null)}
            {allowRemoteEnhancement && (
                <Script src={`${GLOBAL_NAVIGATION_ASSET}?v=${GLOBAL_NAVIGATION_PROVENANCE}`} strategy="afterInteractive" />
            )}
        </>
    );
}
