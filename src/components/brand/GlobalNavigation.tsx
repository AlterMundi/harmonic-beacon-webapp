'use client';

import { createElement, useEffect, useRef, type ReactNode } from 'react';
import { useLocaleOrInitial, useOptionalLocale } from '@/context/LocaleContext';
import Script from 'next/script';

import { liveNavigationCopy } from '@/lib/live-navigation-copy';
import type { UiLocale } from '@/lib/i18n';

// Byte-pinned local snapshot of harmonicbeacon.com@7e27303. Protected product
// origins never execute remotely supplied JavaScript with their host cookies.
export const GLOBAL_NAVIGATION_ASSET = '/assets/hb-global-nav.js';
export const GLOBAL_NAVIGATION_PROVENANCE = '6bd32262318e9a1faf6f4fc54b85b96f856544df';
export const GLOBAL_NAVIGATION_SHA256 = '5e0add357a923bf4609fd1eafd4a96d4989481f17e6c31296252842ce9d881d6';
export const GLOBAL_NAVIGATION_EMBED_GUARD = `
(() => {
    if (window.self === window.top) return;
    if (new URLSearchParams(window.location.search).get('surface') !== 'cockpit') return;
    document.documentElement.dataset.hbEmbeddedSurface = 'cockpit';
})();`;

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
    locale: initialLocale,
    allowRemoteEnhancement = true,
    accountHref,
    accountAvailable = false,
    accountSignedIn = false,
    accountMenu,
}: {
    active: GlobalNavigationSurface;
    locale: UiLocale;
    allowRemoteEnhancement?: boolean;
    accountHref?: 'https://account.harmonicbeacon.com/account' | 'https://account-staging.harmonicbeacon.com/account';
    accountAvailable?: boolean;
    accountSignedIn?: boolean;
    accountMenu?: ReactNode;
}) {
    const locale = useLocaleOrInitial(initialLocale);
    const context = useOptionalLocale();
    const host = useRef<HTMLElement>(null);
    const pendingRedraw = useRef<MutationObserver | null>(null);
    useEffect(() => () => pendingRedraw.current?.disconnect(), []);
    useEffect(() => {
        if (!context) return;
        const change = (event: MouseEvent) => {
            if (!/^\/(?:session|ops\/events)\/[^/]+\/?$/.test(location.pathname)) return;
            const button = event.composedPath().find(node => node instanceof HTMLButtonElement && node.matches('button.language'));
            if (!(button instanceof HTMLButtonElement) || (button.getRootNode() as ShadowRoot).host !== host.current) return;
            // The byte-pinned cross-site asset reloads other product hosts.
            // Live owns this action at capture phase: update shared client copy
            // and storage without executing that destructive target handler.
            event.preventDefault(); event.stopImmediatePropagation();
            const root = button.getRootNode() as ShadowRoot;
            const hadFocus = root.activeElement === button;
            const mobileOpen = root.querySelector('.mobile')?.classList.contains('open') ?? false;
            // The pinned asset observes document language and replaces its shadow
            // tree asynchronously. Restore interaction state after that redraw,
            // not on React's render/effect timing or on the detached old button.
            pendingRedraw.current?.disconnect();
            const redraw = new MutationObserver(() => {
                const current = root.querySelector<HTMLButtonElement>('button.language');
                if (!current || current === button) return;
                redraw.disconnect();
                pendingRedraw.current = null;
                if (!root.host.isConnected) return;
                root.querySelector('.mobile')?.classList.toggle('open', mobileOpen);
                root.querySelector('.toggle')?.setAttribute('aria-expanded', String(mobileOpen));
                if (hadFocus) current.focus({ preventScroll: true });
            });
            pendingRedraw.current = redraw;
            redraw.observe(root, { childList: true });
            context.setLocale(locale === 'en' ? 'es' : 'en');
        };
        window.addEventListener('click', change, true);
        return () => window.removeEventListener('click', change, true);
    }, [context, locale]);
    const copy = liveNavigationCopy[locale];
    const navLabel = copy.primary;
    const userMenuLabel = copy.userMenu;
    const accountLabel = copy.account;
    const resolvedAccountHref = accountHref ?? 'https://account.harmonicbeacon.com/account';
    const showAccount = accountAvailable || resolvedAccountHref === 'https://account-staging.harmonicbeacon.com/account';
    const showSignedIn = showAccount && accountSignedIn;
    const accountControlLabel = showSignedIn
        ? copy.signedInMenu
        : userMenuLabel;
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
                                {copy[link.key]}
                            </a>
                        </li>
                    ))}
                </ul>
                {showAccount && (
                    <details
                        className="hb-global-navigation-fallback__account-control"
                        data-account-signed-in={showSignedIn ? '' : undefined}
                    >
                        <summary aria-label={accountControlLabel}>
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
                )}
            </div>
        </nav>
    );

    return (
        <>
            <script
                id="hb-global-navigation-embed-guard"
                dangerouslySetInnerHTML={{ __html: GLOBAL_NAVIGATION_EMBED_GUARD }}
            />
            {createElement('hb-global-nav', {
                ref: host,
                'data-surface': active,
                'data-account-available': showAccount ? '' : undefined,
                'data-account-signed-in': showSignedIn ? '' : undefined,
            }, fallback, accountMenu && showAccount ? (
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
