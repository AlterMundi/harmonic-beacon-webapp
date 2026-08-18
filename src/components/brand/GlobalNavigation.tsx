import { createElement } from 'react';
import Script from 'next/script';

import type { UiLocale } from '@/lib/i18n';

// Byte-pinned local snapshot of harmonicbeacon.com@ceeea30a. Protected product
// origins never execute remotely supplied JavaScript with their host cookies.
export const GLOBAL_NAVIGATION_ASSET = '/assets/hb-global-nav.js';
export const GLOBAL_NAVIGATION_PROVENANCE = 'ceeea30a94417331450c420fbfb8fc2e6a0a9b2d';
export const GLOBAL_NAVIGATION_SHA256 = '16f17fdd9dfde76e5d574dd0e408a5b533d9138f222910821a4425169e147151';

export type GlobalNavigationSurface = 'events' | 'listen' | 'account';

const links = [
    { key: 'events', href: 'https://live.harmonicbeacon.com/', en: 'Events', es: 'Eventos' },
    { key: 'listen', href: 'https://listen.harmonicbeacon.com/', en: 'Listen', es: 'Escuchar' },
    { key: 'account', href: 'https://account.harmonicbeacon.com/account', en: 'Account', es: 'Cuenta' },
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
    const fallback = (
        <nav className="hb-global-navigation-fallback" aria-label={navLabel}>
            <a className="hb-global-navigation-fallback__brand" href={withLanguage('https://harmonicbeacon.com/', locale)}>
                Harmonic Beacon
            </a>
            <ul>
                {links.map((link) => (
                    <li key={link.key}>
                        <a
                            href={withLanguage(link.key === 'account' && accountHref
                                ? accountHref : link.href, locale)}
                            aria-current={link.key === active ? 'page' : undefined}
                        >
                            {locale === 'es' ? link.es : link.en}
                        </a>
                    </li>
                ))}
            </ul>
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
