import type { Metadata } from 'next';

import { localeForBrowserLanguage, type UiLocale } from '@/lib/i18n';

export const LISTENER_PUBLIC_HOST = 'listen.harmonicbeacon.com';
export const LISTENER_PUBLIC_ORIGIN = `https://${LISTENER_PUBLIC_HOST}`;
export const LISTENER_CANONICAL_URL = `${LISTENER_PUBLIC_ORIGIN}/`;

const localizedMetadata: Record<UiLocale, { title: string; description: string }> = {
    es: {
        title: 'Harmonic Beacon · Recuerda tu centro armónico.',
        description: 'Un campo armónico continuo, compartido alrededor del mundo.',
    },
    en: {
        title: 'Harmonic Beacon · Remember your harmonic center.',
        description: 'A continuous harmonic field, shared across the world.',
    },
};

function normalizedHost(value: string | null): string | null {
    const candidate = value?.trim().toLowerCase();
    if (!candidate) return null;
    const authority = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(candidate);
    if (!authority) return null;
    if (authority[2] && Number(authority[2]) > 65_535) return null;
    return authority[1];
}

/**
 * Public discovery is deliberately bound to the Listener hostname. This keeps
 * the routes inert if the Listener branch is later merged into the event app.
 * The Listener nginx template always forwards the original Host header.
 */
export function isCanonicalListenerHost(headers: Pick<Headers, 'get'>): boolean {
    return normalizedHost(headers.get('host')) === LISTENER_PUBLIC_HOST;
}

export function listenerLocaleForHeaders(headers: Pick<Headers, 'get'>): UiLocale {
    return localeForBrowserLanguage(headers.get('accept-language'));
}

export function listenerPublicMetadata(locale: UiLocale): Metadata {
    const copy = localizedMetadata[locale];

    return {
        metadataBase: new URL(LISTENER_PUBLIC_ORIGIN),
        applicationName: 'Harmonic Beacon',
        title: copy.title,
        description: copy.description,
        keywords: ['Harmonic Beacon'],
        authors: [{ name: 'Harmonic Beacon' }],
        creator: 'Harmonic Beacon',
        publisher: 'Harmonic Beacon',
        alternates: {
            canonical: '/',
        },
        openGraph: {
            type: 'website',
            url: '/',
            siteName: 'Harmonic Beacon',
            title: copy.title,
            description: copy.description,
            locale: locale === 'es' ? 'es_ES' : 'en_US',
        },
        twitter: {
            card: 'summary',
            title: copy.title,
            description: copy.description,
        },
        robots: {
            index: true,
            follow: true,
        },
    };
}

export function listenerPreviewMetadata(): Metadata {
    return {
        title: 'Listen · Harmonic Beacon',
        description: 'A continuous harmonic field, shared across the world.',
        robots: {
            index: false,
            follow: false,
            nocache: true,
        },
    };
}

export function listenerRobotsText(): string {
    return [
        'User-agent: *',
        'Allow: /',
        `Sitemap: ${LISTENER_PUBLIC_ORIGIN}/sitemap.xml`,
        '',
    ].join('\n');
}

export function listenerSitemapXml(): string {
    return [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
        `  <url><loc>${LISTENER_CANONICAL_URL}</loc></url>`,
        '</urlset>',
        '',
    ].join('\n');
}
