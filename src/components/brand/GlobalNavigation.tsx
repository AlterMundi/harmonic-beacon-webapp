import { createElement } from 'react';
import Script from 'next/script';

import type { UiLocale } from '@/lib/i18n';

export const GLOBAL_NAVIGATION_ASSET = 'https://harmonicbeacon.com/assets/hb-global-nav.js';
export const GLOBAL_NAVIGATION_EMBED_GUARD = `
(() => {
    if (window.self === window.top) return;
    if (new URLSearchParams(window.location.search).get('surface') !== 'cockpit') return;
    document.documentElement.dataset.hbEmbeddedSurface = 'cockpit';
})();`;

export type GlobalNavigationSurface = 'events' | 'listen';

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
}: {
    active: GlobalNavigationSurface;
    locale: UiLocale;
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
                            href={withLanguage(link.href, locale)}
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
            <script
                id="hb-global-navigation-embed-guard"
                dangerouslySetInnerHTML={{ __html: GLOBAL_NAVIGATION_EMBED_GUARD }}
            />
            {createElement('hb-global-nav', { 'data-surface': active }, fallback)}
            <Script src={GLOBAL_NAVIGATION_ASSET} strategy="afterInteractive" />
        </>
    );
}
