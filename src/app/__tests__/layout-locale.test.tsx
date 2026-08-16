import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    headers: vi.fn(),
    requestLocale: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('@/lib/i18n-server', () => ({ requestLocale: mocks.requestLocale }));
vi.mock('next/font/local', () => ({
    default: () => ({ variable: 'local-font' }),
}));
vi.mock('@/context/LocaleContext', () => ({
    LocaleProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('sonner', () => ({ Toaster: () => null }));

import RootLayout, { generateViewport } from '../layout';

function requestHeaders(host: string, acceptLanguage: string): Headers {
    return new Headers({ host, 'accept-language': acceptLanguage });
}

describe('root document locale boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('matches the canonical Listener SSR document to browser-language content', async () => {
        mocks.headers.mockResolvedValue(requestHeaders(
            'listen.harmonicbeacon.com',
            'en-US,en;q=0.9,es;q=0.7',
        ));
        mocks.requestLocale.mockResolvedValue('es');

        const result = await RootLayout({ children: <main /> });

        expect(result.props.lang).toBe('en');
        expect(result.props['data-lang']).toBe('en');
        expect(result.props['data-hb-surface']).toBe('listener');
        expect(mocks.requestLocale).not.toHaveBeenCalled();
    });

    it('preserves the existing event locale decision on every non-Listener host', async () => {
        mocks.headers.mockResolvedValue(requestHeaders(
            'live.harmonicbeacon.com',
            'en-US,en;q=0.9',
        ));
        mocks.requestLocale.mockResolvedValue('es');

        const result = await RootLayout({ children: <main /> });

        expect(result.props.lang).toBe('es');
        expect(result.props['data-lang']).toBe('es');
        expect(result.props['data-hb-surface']).toBeUndefined();
        expect(mocks.requestLocale).toHaveBeenCalledOnce();
    });

    it.each([
        ['listen.harmonicbeacon.com', '#16120D'],
        ['listen.harmonicbeacon.com:443', '#16120D'],
        ['live.harmonicbeacon.com', '#07120f'],
        ['harmonicbeacon.com', '#07120f'],
        ['earlybirds-staging.harmonicbeacon.com', '#07120f'],
    ])('scopes the browser theme color for %s', async (host, themeColor) => {
        mocks.headers.mockResolvedValue(requestHeaders(host, 'en-US'));

        await expect(generateViewport()).resolves.toEqual({
            width: 'device-width',
            initialScale: 1,
            themeColor,
        });
    });

    it('pins warm overscroll and Inter to the exact Listener document marker', () => {
        const css = readFileSync('src/app/globals.css', 'utf8');

        expect(css).toContain("html[data-hb-surface='listener'] body");
        expect(css).toContain('background: var(--hb-bg-0);');
        expect(css).toContain('font-family: var(--hb-font-sans);');
    });
});
