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
    GLOBAL_NAVIGATION_EMBED_GUARD,
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
        ['live-staging.harmonicbeacon.com', 'events'],
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
        ['listen.harmonicbeacon.com', 'https://account.harmonicbeacon.com/account'],
        ['earlybirds-staging.harmonicbeacon.com, account.harmonicbeacon.com', 'https://account.harmonicbeacon.com/account'],
    ] as const)('maps the exact host %s to Account href %s', (host, expected) => {
        expect(globalNavigationAccountHref(new Headers({ host }))).toBe(expected);
    });

    it('keeps accessible primary destinations while hiding unavailable production Account', () => {
        render(<GlobalNavigation active="listen" locale="en" />);

        expect(GLOBAL_NAVIGATION_ASSET).toBe('/assets/hb-global-nav.js');
        expect(screen.getByRole('link', { name: 'Events' })).toHaveAttribute('href', 'https://live.harmonicbeacon.com/?lang=en');
        expect(screen.getByRole('link', { name: 'Listen' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'News' })).toHaveAttribute('href', 'https://harmonicbeacon.com/eventos/?lang=en');
        expect(screen.queryByLabelText('User menu')).toBeNull();
        expect(screen.queryByRole('menuitem', { name: 'Account' })).toBeNull();
    });

    it('loads a byte-pinned local canonical asset instead of remote same-origin code', () => {
        expect(GLOBAL_NAVIGATION_PROVENANCE).toBe('7e2730344e543e6c6ff5abde6d8133fc198214ae');
        const bytes = readFileSync(resolve(process.cwd(), 'public/assets/hb-global-nav.js'));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(GLOBAL_NAVIGATION_SHA256);
        expect(manifest.globalNavigation.commit).toBe(GLOBAL_NAVIGATION_PROVENANCE);
        expect(manifest.globalNavigation.sha256).toBe(GLOBAL_NAVIGATION_SHA256);
        expect(manifest.snapshots[manifest.globalNavigation.path as keyof typeof manifest.snapshots])
            .toBe(GLOBAL_NAVIGATION_SHA256);
        const source = bytes.toString('utf8');
        expect(source).toContain('class="account-trigger\' + (accountSignedIn ? \' signed-in\' : \'\')');
        expect(source).toContain('function accountControlAvailable()');
        expect(source).toContain("return ['data-account-signed-in'];");
        expect(source).toContain('User menu, signed in');
        expect(source).toContain('Menú de usuario, sesión iniciada');
        expect(source).toContain('.account-trigger.signed-in::after');
        expect(source).toContain('beaconMarkPath()');
        expect(source).toContain('Math.cos(angle * 3)');
        expect(source).toContain('Math.sin(angle * 2)');
        expect(source).toContain('index <= 280');
        expect(source).toContain('@media (max-width:365px) { .wordmark { display:none; } }');
        expect(source).toContain('<svg class="mark"');
        expect(source).toContain('<circle cx="12" cy="8" r="3.25">');
        expect(source).toContain('aria-haspopup="menu"');
        expect(source).toContain('class="account-menu"');
        expect(source).toContain('<slot name="account-menu">');
        expect(source).toContain('assignedElements({ flatten:true })');
        expect(source).toContain("querySelectorAll('[role=\"menuitem\"]')");
        expect(source).toContain('event.composedPath().includes(this)');
        expect(source).not.toContain('class="account-link"');
        expect(source).not.toContain('https://account.harmonicbeacon.com');
        expect(source).not.toContain('fetch(');
        expect(source).not.toContain('<iframe');
        expect(source).not.toContain('/favicon.svg');

        const fallbackCss = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
        expect(fallbackCss).toContain(
            '.hb-global-navigation-fallback__account-control[data-account-signed-in] summary::after',
        );
        expect(fallbackCss).toContain('background: #c9a24e');
    });

    it('renders the same destinations in Spanish', () => {
        render(<GlobalNavigation active="events" locale="es" />);

        expect(screen.getByRole('link', { name: 'Eventos' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Escuchar' })).toHaveAttribute('href', 'https://listen.harmonicbeacon.com/?lang=es');
        expect(screen.getByRole('link', { name: 'Novedades' })).toBeInTheDocument();
    });

    it('suppresses only the duplicate navigation inside the cockpit embed', () => {
        expect(GLOBAL_NAVIGATION_EMBED_GUARD).toContain('window.self === window.top');
        expect(GLOBAL_NAVIGATION_EMBED_GUARD).toContain("get('surface') !== 'cockpit'");
        expect(GLOBAL_NAVIGATION_EMBED_GUARD).toContain("hbEmbeddedSurface = 'cockpit'");
    });

    it('keeps the non-enhanced Account staging fallback inside staging', () => {
        const view = render(<GlobalNavigation
            active="account"
            locale="en"
            allowRemoteEnhancement={false}
            accountHref="https://account-staging.harmonicbeacon.com/account"
        />);
        const account = within(view.container).getByRole('menuitem', { name: 'Account' });
        expect(account)
            .toHaveAttribute('href', 'https://account-staging.harmonicbeacon.com/account?lang=en');
        expect(account).toHaveAttribute('aria-current', 'page');
        expect(within(view.container).getByLabelText('User menu').querySelector('svg')).toBeTruthy();
        expect(view.container.querySelector('script[src]')).toBeNull();
    });

    it('SSR-renders only a boolean signed-in hint and accessible staging label', () => {
        const view = render(<GlobalNavigation
            active="events"
            locale="en"
            accountHref="https://account-staging.harmonicbeacon.com/account"
            accountSignedIn
        />);

        expect(within(view.container).getByLabelText('User menu, signed in')).toBeInTheDocument();
        expect(view.container.querySelector('hb-global-nav')).toHaveAttribute('data-account-signed-in', '');
        expect(view.container.querySelector('details')).toHaveAttribute('data-account-signed-in', '');
        expect(view.container.innerHTML).not.toContain('account-subject');
        expect(view.container.innerHTML).not.toContain('email');
    });

    it('uses the signed-in accessible label in Spanish', () => {
        render(<GlobalNavigation
            active="events"
            locale="es"
            accountHref="https://account-staging.harmonicbeacon.com/account"
            accountSignedIn
        />);

        expect(screen.getByLabelText('Menú de usuario, sesión iniciada')).toBeInTheDocument();
    });

    it('provides the host-local signed-in menu through the canonical slot only on staging', () => {
        const view = render(<GlobalNavigation
            active="events"
            locale="en"
            accountHref="https://account-staging.harmonicbeacon.com/account"
            accountSignedIn
            accountMenu={<div><p>Nicolás</p><button role="menuitem">Operations</button></div>}
        />);

        const slot = view.container.querySelector('[slot="account-menu"]');
        expect(slot).toHaveClass('hb-global-navigation-local-account-slot');
        expect(within(slot as HTMLElement).getByText('Nicolás')).toBeInTheDocument();
        expect(within(slot as HTMLElement).getByRole('menuitem', { name: 'Operations' }))
            .toBeInTheDocument();
    });

    it('does not expose a signed-in marker when production Account is unavailable', () => {
        const view = render(<GlobalNavigation
            active="events"
            locale="en"
            accountSignedIn
            accountMenu={<button role="menuitem">Operations</button>}
        />);

        expect(view.container.querySelector('hb-global-nav')).not.toHaveAttribute('data-account-signed-in');
        expect(view.container.querySelector('details')).toBeNull();
        expect(view.container.querySelector('[slot="account-menu"]')).toBeNull();
    });
});
