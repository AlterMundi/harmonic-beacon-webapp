import { describe, expect, it } from 'vitest';

import {
    isCanonicalListenerHost,
    LISTENER_CANONICAL_URL,
    listenerPreviewMetadata,
    listenerPublicMetadata,
    listenerRobotsText,
    listenerSitemapXml,
} from '../public-discovery';

function requestHeaders(host: string | null): Headers {
    const headers = new Headers();
    if (host) headers.set('host', host);
    return headers;
}

describe('Listener public discovery', () => {
    it('accepts only the canonical Listener host, including its explicit port', () => {
        expect(isCanonicalListenerHost(requestHeaders('listen.harmonicbeacon.com'))).toBe(true);
        expect(isCanonicalListenerHost(requestHeaders('listen.harmonicbeacon.com:443'))).toBe(true);
        expect(isCanonicalListenerHost(requestHeaders('earlybirds-staging.harmonicbeacon.com'))).toBe(false);
        expect(isCanonicalListenerHost(requestHeaders('live.harmonicbeacon.com'))).toBe(false);
        expect(isCanonicalListenerHost(requestHeaders('live.harmonicbeacon.com, listen.harmonicbeacon.com'))).toBe(false);
        expect(isCanonicalListenerHost(requestHeaders('live.harmonicbeacon.com@listen.harmonicbeacon.com'))).toBe(false);
        expect(isCanonicalListenerHost(requestHeaders('listen.harmonicbeacon.com:99999'))).toBe(false);
        expect(isCanonicalListenerHost(requestHeaders(null))).toBe(false);
    });

    it.each([
        ['es', 'Harmonic Beacon · Recuerda tu centro armónico.', 'Un campo armónico continuo, compartido alrededor del mundo.'],
        ['en', 'Harmonic Beacon · Remember your harmonic center.', 'A continuous harmonic field, shared across the world.'],
    ] as const)('builds complete %s metadata for the one canonical URL', (locale, title, description) => {
        const metadata = listenerPublicMetadata(locale);

        expect(metadata.metadataBase?.toString()).toBe('https://listen.harmonicbeacon.com/');
        expect(metadata.title).toBe(title);
        expect(metadata.description).toBe(description);
        expect(metadata.alternates).toEqual({ canonical: '/' });
        expect(metadata.openGraph).toMatchObject({
            type: 'website',
            url: '/',
            siteName: 'Harmonic Beacon',
            title,
            description,
        });
        expect(metadata.twitter).toEqual({ card: 'summary', title, description });
        expect(metadata.robots).toEqual({ index: true, follow: true });
        expect(JSON.stringify(metadata)).not.toMatch(/early.?bird|projection|psychodrama|therap/i);
    });

    it('keeps non-public hosts out of search indexes without assigning a canonical URL', () => {
        const metadata = listenerPreviewMetadata();

        expect(metadata.metadataBase).toBeUndefined();
        expect(metadata.alternates).toBeUndefined();
        expect(metadata.robots).toEqual({ index: false, follow: false, nocache: true });
    });

    it('enumerates only the canonical Listener surface in robots and sitemap', () => {
        const robots = listenerRobotsText();
        const sitemap = listenerSitemapXml();

        expect(robots).toBe(
            'User-agent: *\nAllow: /\nSitemap: https://listen.harmonicbeacon.com/sitemap.xml\n',
        );
        expect(sitemap).toContain(`<loc>${LISTENER_CANONICAL_URL}</loc>`);
        expect(sitemap.match(/<url>/g)).toHaveLength(1);
        expect(`${robots}\n${sitemap}`).not.toMatch(/early.?bird|staging|live\.harmonic|event|evento|hreflang/i);
    });
});
