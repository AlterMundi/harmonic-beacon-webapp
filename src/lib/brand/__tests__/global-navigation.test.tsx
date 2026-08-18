// @vitest-environment jsdom

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import manifest from '@/brand/canonical/manifest.json';
import {
    GlobalNavigation,
    GLOBAL_NAVIGATION_ASSET,
    GLOBAL_NAVIGATION_EMBED_GUARD,
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

    it('keeps an accessible same-destination fallback while the local snapshot loads', () => {
        render(<GlobalNavigation active="listen" locale="en" />);

        expect(GLOBAL_NAVIGATION_ASSET).toBe('/assets/hb-global-nav.js');
        expect(screen.getByRole('link', { name: 'Events' })).toHaveAttribute('href', 'https://live.harmonicbeacon.com/?lang=en');
        expect(screen.getByRole('link', { name: 'Listen' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'News' })).toHaveAttribute('href', 'https://harmonicbeacon.com/eventos/?lang=en');
    });

    it('renders the same destinations in Spanish', () => {
        render(<GlobalNavigation active="events" locale="es" />);

        expect(screen.getByRole('link', { name: 'Eventos' })).toHaveAttribute('aria-current', 'page');
        expect(screen.getByRole('link', { name: 'Escuchar' })).toHaveAttribute('href', 'https://listen.harmonicbeacon.com/?lang=es');
        expect(screen.getByRole('link', { name: 'Novedades' })).toBeInTheDocument();
    });

    it('suppresses only the duplicate navigation inside the cockpit iframe', () => {
        expect(GLOBAL_NAVIGATION_EMBED_GUARD).toContain('window.self === window.top');
        expect(GLOBAL_NAVIGATION_EMBED_GUARD).toContain("get('surface') !== 'cockpit'");
        expect(GLOBAL_NAVIGATION_EMBED_GUARD).toContain("hbEmbeddedSurface = 'cockpit'");
    });

    it('loads only the byte-pinned local snapshot without token or PII access', () => {
        const assetPath = join(process.cwd(), manifest.globalNavigation.snapshotFile);
        const asset = readFileSync(assetPath);
        const source = asset.toString('utf8');
        const digest = createHash('sha256').update(asset).digest('hex');

        expect(manifest.globalNavigation.commit).toBe('70400675b807ba90988517eb28871ad81c6ac369');
        expect(manifest.globalNavigation.sourceFile).toBe('assets/hb-global-nav.js');
        expect(digest).toBe(manifest.globalNavigation.sha256);
        const snapshotKey = manifest.globalNavigation.snapshotFile as keyof typeof manifest.snapshots;
        expect(digest).toBe(manifest.snapshots[snapshotKey]);
        expect(source).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|postMessage/);
        expect(source).not.toMatch(/access[_-]?token|id[_-]?token|authorization|\bemail\b/i);
        expect(source.match(/document\.cookie/g)).toHaveLength(1);
        expect(source).toContain("document.cookie = 'hb_locale='");
    });

    it('restricts executable scripts to the Live origin', () => {
        const nextConfig = readFileSync(join(process.cwd(), 'next.config.ts'), 'utf8');

        expect(nextConfig).toContain("script-src 'self' 'unsafe-inline'");
        expect(nextConfig).not.toMatch(/script-src[^;]*https?:/);
    });
});
