// @vitest-environment jsdom

import { render, screen, within } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    GlobalNavigation,
    GLOBAL_NAVIGATION_ASSET,
    GLOBAL_NAVIGATION_PROVENANCE,
    GLOBAL_NAVIGATION_SHA256,
} from '@/components/brand/GlobalNavigation';
import { globalNavigationSurface } from '@/lib/brand/global-navigation';

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

    it('keeps an accessible same-destination fallback while the shared asset loads', () => {
        render(<GlobalNavigation active="listen" locale="en" />);

        expect(GLOBAL_NAVIGATION_ASSET).toBe('/assets/hb-global-nav.js');
        expect(screen.getByRole('link', { name: 'Events' })).toHaveAttribute('href', 'https://live.harmonicbeacon.com/?lang=en');
        expect(screen.getByRole('link', { name: 'Listen' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'News' })).toHaveAttribute('href', 'https://harmonicbeacon.com/eventos/?lang=en');
    });

    it('loads a byte-pinned local canonical asset instead of remote same-origin code', () => {
        expect(GLOBAL_NAVIGATION_PROVENANCE).toBe('ceeea30a94417331450c420fbfb8fc2e6a0a9b2d');
        const bytes = readFileSync(resolve(process.cwd(), 'public/assets/hb-global-nav.js'));
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(GLOBAL_NAVIGATION_SHA256);
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
        />);
        expect(within(view.container).getByRole('link', { name: 'Account' }))
            .toHaveAttribute('href', 'https://account-staging.harmonicbeacon.com/account?lang=en');
        expect(view.container.querySelector('script')).toBeNull();
    });
});
