import { createElement } from 'react';
import Script from 'next/script';

import type { UiLocale } from '@/lib/i18n';

// Byte-pinned local snapshot of harmonicbeacon.com@ae3608e3. Protected product
// origins never execute remotely supplied JavaScript with their host cookies.
export const GLOBAL_NAVIGATION_ASSET = '/assets/hb-global-nav.js';
export const GLOBAL_NAVIGATION_PROVENANCE = 'ae3608e3ec603b424efb729373dddd8d3a7f6e93';
export const GLOBAL_NAVIGATION_SHA256 = 'be7fa241f393ec37b335756408897a47c16e86aaf30eb23a24fb7912a5ebb58f';

export type GlobalNavigationSurface = 'events' | 'listen' | 'account';

const links = [
    { key: 'events', href: 'https://live.harmonicbeacon.com/', en: 'Events', es: 'Eventos' },
    { key: 'listen', href: 'https://listen.harmonicbeacon.com/', en: 'Listen', es: 'Escuchar' },
    { key: 'news', href: 'https://harmonicbeacon.com/eventos/', en: 'News', es: 'Novedades' },
    { key: 'why', href: 'https://harmonicbeacon.com/#porque', en: 'Why it works', es: 'Por qué funciona' },
    { key: 'team', href: 'https://harmonicbeacon.com/#team', en: 'Team', es: 'Equipo' },
    { key: 'foundation', href: 'https://harmonicbeacon.com/#foundation', en: 'HIT', es: 'HIT' },
    { key: 'contact', href: 'https://harmonicbeacon.com/#contact', en: 'Contact', es: 'Contacto' },
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
}: {
    active: GlobalNavigationSurface;
    locale: UiLocale;
    allowRemoteEnhancement?: boolean;
    accountHref?: 'https://account.harmonicbeacon.com/account' | 'https://account-staging.harmonicbeacon.com/account';
}) {
    const navLabel = locale === 'es' ? 'Navegación principal' : 'Primary navigation';
    const userMenuLabel = locale === 'es' ? 'Menú de usuario' : 'User menu';
    const accountLabel = locale === 'es' ? 'Cuenta' : 'Account';
    const resolvedAccountHref = accountHref ?? 'https://account.harmonicbeacon.com/account';
    const fallback = (
        <nav className="hb-global-navigation-fallback" aria-label={navLabel}>
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
                <details className="hb-global-navigation-fallback__account-control">
                    <summary aria-label={userMenuLabel}>
                        <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
                            <circle cx="12" cy="8" r="3.25" />
                            <path d="M5.75 19c.6-3.25 2.7-5 6.25-5s5.65 1.75 6.25 5" />
                        </svg>
                    </summary>
                    <div className="hb-global-navigation-fallback__account-menu" role="menu">
                        <a
                            href={withLanguage(resolvedAccountHref, locale)}
                            role="menuitem"
                            aria-current={active === 'account' ? 'page' : undefined}
                        >
                            {accountLabel}
                        </a>
                    </div>
                </details>
            </div>
        </nav>
    );

    return (
        <>
            {createElement('hb-global-nav', { 'data-surface': active }, fallback)}
            {allowRemoteEnhancement && (
                <Script src={`${GLOBAL_NAVIGATION_ASSET}?v=${GLOBAL_NAVIGATION_PROVENANCE}`} strategy="afterInteractive" />
            )}
        </>
    );
}
