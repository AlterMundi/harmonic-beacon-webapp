// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import manifest from '@/brand/canonical/manifest.json';
import {
    GlobalNavigation,
    GLOBAL_NAVIGATION_ASSET,
    GLOBAL_NAVIGATION_PROVENANCE,
    GLOBAL_NAVIGATION_SHA256,
} from '@/components/brand/GlobalNavigation';
import {
    globalNavigationAccountHref,
    globalNavigationSurface,
} from '@/lib/brand/global-navigation';

describe('canonical Harmonic Beacon global navigation', () => {
    it.each([
        ['live.harmonicbeacon.com', 'events'],
        ['live.harmonicbeacon.com:443', 'events'],
        ['listen.harmonicbeacon.com', 'listen'],
        ['earlybirds-staging.harmonicbeacon.com', 'listen'],
        ['harmonicbeacon.com', null],
        ['live.harmonicbeacon.com, listen.harmonicbeacon.com', null],
        ['live.harmonicbeacon.com@listen.harmonicbeacon.com', null],
    ] as const)('maps exact host %s to %s', (host, expected) => {
        expect(globalNavigationSurface(new Headers({ host }))).toBe(expected);
    });

    it.each([
        ['account-staging.harmonicbeacon.com', 'https://account-staging.harmonicbeacon.com/account'],
        ['earlybirds-staging.harmonicbeacon.com', 'https://account-staging.harmonicbeacon.com/account'],
        ['live-staging.harmonicbeacon.com', 'https://account-staging.harmonicbeacon.com/account'],
        ['listen.harmonicbeacon.com', null],
        ['account.harmonicbeacon.com', null],
        ['earlybirds-staging.harmonicbeacon.com, account.harmonicbeacon.com', null],
    ] as const)('maps the exact host %s to Account href %s', (host, expected) => {
        expect(globalNavigationAccountHref(new Headers({ host }))).toBe(expected);
    });

    it('keeps an accessible same-destination fallback while the shared asset loads', () => {
        render(<GlobalNavigation active="listen" locale="en" />);

        expect(GLOBAL_NAVIGATION_ASSET).toBe('/assets/hb-global-nav.js');
        expect(screen.getByRole('link', { name: 'Events' })).toHaveAttribute('href', 'https://live.harmonicbeacon.com/?lang=en');
        expect(screen.getByRole('link', { name: 'Listen' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'News' })).toHaveAttribute('href', 'https://harmonicbeacon.com/eventos/?lang=en');
        expect(screen.queryByLabelText('User menu')).toBeNull();
        expect(screen.queryByRole('menuitem', { name: 'Account' })).toBeNull();
    });

    it('loads a byte-pinned local canonical asset instead of remote same-origin code', () => {
        expect(GLOBAL_NAVIGATION_PROVENANCE).toBe('ed7421616429681a37836f4698c73cf01799b75e');
        const bytes = readFileSync(resolve(process.cwd(), 'public/assets/hb-global-nav.js'));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(GLOBAL_NAVIGATION_SHA256);
        expect(manifest.globalNavigation.commit).toBe(GLOBAL_NAVIGATION_PROVENANCE);
        expect(manifest.globalNavigation.sha256).toBe(GLOBAL_NAVIGATION_SHA256);
        expect(manifest.snapshots[manifest.globalNavigation.path as keyof typeof manifest.snapshots])
            .toBe(GLOBAL_NAVIGATION_SHA256);
        const source = bytes.toString('utf8');
        expect(source).toContain('class="account-trigger');
        expect(source).toContain("'data-account-signed-in'");
        expect(source).toContain("this.hasAttribute('data-account-signed-in')");
        expect(source).toContain('User menu, signed in');
        expect(source).toContain('Menú de usuario, sesión iniciada');
        expect(source).toContain('beaconMarkPath()');
        expect(source).toContain('Math.cos(angle * 3)');
        expect(source).toContain('Math.sin(angle * 2)');
        expect(source).toContain('index <= 280');
        expect(source).toContain('@media (max-width:365px) { .wordmark { display:none; } }');
        expect(source).toContain('<svg class="mark"');
        expect(source).toContain('<circle cx="12" cy="8" r="3.25">');
        expect(source).toContain('aria-haspopup="menu"');
        expect(source).toContain('class="account-menu"');
        expect(source).not.toContain('class="account-link"');
        expect(source).not.toContain('<iframe');
        expect(source).not.toContain('/favicon.svg');
    });

    it('renders the same destinations in Spanish', () => {
        render(<GlobalNavigation active="events" locale="es" />);

        expect(screen.getByRole('link', { name: 'Eventos' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Escuchar' })).toHaveAttribute('href', 'https://listen.harmonicbeacon.com/?lang=es');
        expect(screen.getByRole('link', { name: 'Novedades' })).toBeInTheDocument();
    });

    it('keeps the non-enhanced Account staging fallback inside staging', () => {
        const view = render(<GlobalNavigation
            active="account"
            locale="en"
            allowRemoteEnhancement={false}
            accountHref="https://account-staging.harmonicbeacon.com/account"
            accountSignedIn
        />);
        const account = within(view.container).getByRole('menuitem', { name: 'Account' });
        expect(account)
            .toHaveAttribute('href', 'https://account-staging.harmonicbeacon.com/account?lang=en');
        expect(account).toHaveAttribute('aria-current', 'page');
        expect(within(view.container).getByLabelText('User menu, signed in').querySelector('svg')).toBeTruthy();
        expect(view.container.querySelector('[data-account-signed-in]')).toBeTruthy();
        expect(view.container.querySelector('.hb-global-navigation-fallback__account-control--signed-in'))
            .toBeTruthy();
        expect(view.container.querySelector('script')).toBeNull();
    });

    it('keeps Account absent from production even when the local signed-in hint is present', () => {
        document.body.innerHTML = '';
        document.documentElement.lang = 'en';
        const source = readFileSync(resolve(process.cwd(), 'public/assets/hb-global-nav.js'), 'utf8');
        window.eval(source);

        const navigation = document.querySelector('hb-global-nav');
        navigation?.setAttribute('data-account-signed-in', '');
        const shadow = navigation?.shadowRoot;
        expect(shadow).toBeTruthy();
        expect(shadow?.querySelector('iframe')).toBeNull();
        const markPath = shadow?.querySelector<SVGPathElement>('.mark path')?.getAttribute('d');
        expect(markPath).toMatch(/^M192\.00 100\.00 L191\.79 104\.13/);
        expect(markPath?.match(/[ML]/g)).toHaveLength(281);
        expect(shadow?.querySelector('.links')?.textContent).not.toContain('Account');

        expect(shadow?.querySelector('.account-trigger')).toBeNull();
        expect(shadow?.querySelector('.account-menu')).toBeNull();
    });
});
