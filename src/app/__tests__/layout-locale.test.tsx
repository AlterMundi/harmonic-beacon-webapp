import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    headers: vi.fn(),
    requestLocale: vi.fn(),
    requestBrowserLocale: vi.fn(),
    locallyKnownAccountSession: vi.fn(),
    locallyKnownListenerNavigationIdentity: vi.fn(),
    validateListenerAccountRPEnvironment: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('@/lib/i18n-server', () => ({
    requestLocale: mocks.requestLocale,
    requestBrowserLocale: mocks.requestBrowserLocale,
}));
vi.mock('@/lib/account/auth', () => ({
    locallyKnownAccountSession: mocks.locallyKnownAccountSession,
}));
vi.mock('@/lib/listener/account-rp', () => ({
    locallyKnownListenerNavigationIdentity: mocks.locallyKnownListenerNavigationIdentity,
    validateListenerAccountRPEnvironment: mocks.validateListenerAccountRPEnvironment,
}));
vi.mock('next/font/local', () => ({
    default: () => ({ variable: 'local-font' }),
}));
vi.mock('@/context/LocaleContext', () => ({
    LocaleProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('sonner', () => ({ Toaster: () => null }));

import RootLayout, { generateMetadata, generateViewport } from '../layout';
import { ListenerIdentityCacheBoundary } from '@/components/brand/ListenerIdentityCacheBoundary';

function requestHeaders(host: string, acceptLanguage: string): Headers {
    return new Headers({ host, 'accept-language': acceptLanguage });
}

describe('root document locale boundary', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.locallyKnownAccountSession.mockResolvedValue(false);
        mocks.locallyKnownListenerNavigationIdentity.mockResolvedValue(null);
        mocks.validateListenerAccountRPEnvironment.mockReturnValue(false);
        delete process.env.BEACON_ACCOUNT_RUNTIME;
        delete process.env.BEACON_ACCOUNT_BASE_URL;
    });

    it('matches the canonical Listener SSR document to browser-language content', async () => {
        mocks.headers.mockResolvedValue(requestHeaders(
            'listen.harmonicbeacon.com',
            'en-US,en;q=0.9,es;q=0.7',
        ));
        mocks.requestLocale.mockResolvedValue('es');
        mocks.requestBrowserLocale.mockResolvedValue('en');

        const result = await RootLayout({ children: <main /> });

        expect(result.props.lang).toBe('en');
        expect(result.props['data-lang']).toBe('en');
        expect(result.props['data-hb-surface']).toBe('listener');
        expect(result.props.suppressHydrationWarning).toBe(true);
        expect(mocks.requestLocale).not.toHaveBeenCalled();
        expect(mocks.requestBrowserLocale).toHaveBeenCalledOnce();
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
        expect(mocks.requestBrowserLocale).not.toHaveBeenCalled();
    });

    it('matches the Account document language to the middleware-resolved explicit locale', async () => {
        const incoming = requestHeaders('account.harmonicbeacon.com', 'es-AR,es;q=0.9');
        incoming.set('x-hb-account-locale', 'en');
        mocks.headers.mockResolvedValue(incoming);
        mocks.requestBrowserLocale.mockResolvedValue('es');

        const result = await RootLayout({ children: <main /> });

        expect(result.props.lang).toBe('en');
        expect(result.props['data-hb-surface']).toBe('account');
        expect(mocks.requestLocale).not.toHaveBeenCalled();
        expect(mocks.requestBrowserLocale).not.toHaveBeenCalled();
    });

    it('enhances Account staging navigation and reflects only a local signed-in boolean', async () => {
        process.env.BEACON_ACCOUNT_RUNTIME = '1';
        process.env.BEACON_ACCOUNT_BASE_URL = 'https://account-staging.harmonicbeacon.com';
        const incoming = requestHeaders('account-staging.harmonicbeacon.com', 'en-US');
        incoming.set('x-hb-account-locale', 'en');
        mocks.headers.mockResolvedValue(incoming);
        mocks.locallyKnownAccountSession.mockResolvedValue(true);

        const result = await RootLayout({ children: <main /> });
        const body = result.props.children;
        const navigation = body.props.children[0];
        expect(navigation.props.accountHref).toBe('https://account-staging.harmonicbeacon.com/account');
        expect(navigation.props.accountSignedIn).toBe(true);
        expect(mocks.locallyKnownAccountSession).toHaveBeenCalledOnce();
        expect(mocks.locallyKnownListenerNavigationIdentity).not.toHaveBeenCalled();
    });

    it('uses only the local Listener projection for the signed-in navigation hint', async () => {
        mocks.validateListenerAccountRPEnvironment.mockReturnValue(true);
        mocks.headers.mockResolvedValue(requestHeaders(
            'earlybirds-staging.harmonicbeacon.com',
            'en-US',
        ));
        mocks.requestBrowserLocale.mockResolvedValue('en');
        mocks.locallyKnownListenerNavigationIdentity.mockResolvedValue({ displayName: 'Nico' });

        const result = await RootLayout({ children: <main /> });
        const bodyChildren = result.props.children.props.children;
        const navigation = bodyChildren[0];

        expect(navigation.props.accountHref).toBe('https://account-staging.harmonicbeacon.com/account');
        expect(navigation.props.accountSignedIn).toBe(true);
        expect(navigation.props.accountMenu.props.displayName).toBe('Nico');
        expect(bodyChildren[1].type).toBe(ListenerIdentityCacheBoundary);
        expect(mocks.locallyKnownListenerNavigationIdentity).toHaveBeenCalledOnce();
        expect(mocks.locallyKnownAccountSession).not.toHaveBeenCalled();
    });

    it('exposes production Account only when the Listener RP environment is enabled', async () => {
        const incoming = requestHeaders('listen.harmonicbeacon.com', 'en-US');
        mocks.headers.mockResolvedValue(incoming);
        mocks.requestBrowserLocale.mockResolvedValue('en');
        mocks.validateListenerAccountRPEnvironment.mockReturnValue(true);
        mocks.locallyKnownListenerNavigationIdentity.mockResolvedValue({ displayName: 'Nico' });

        const result = await RootLayout({ children: <main /> });
        const bodyChildren = result.props.children.props.children;
        const navigation = bodyChildren[0];

        expect(navigation.props.accountHref).toBe('https://account.harmonicbeacon.com/account');
        expect(navigation.props.accountSignedIn).toBe(true);
        expect(navigation.props.accountMenu.props.displayName).toBe('Nico');
        expect(mocks.locallyKnownListenerNavigationIdentity).toHaveBeenCalledOnce();
    });

    it('does not expose an Account control on production before Account production exists', async () => {
        mocks.headers.mockResolvedValue(requestHeaders('listen.harmonicbeacon.com', 'en-US'));
        mocks.requestBrowserLocale.mockResolvedValue('en');

        const result = await RootLayout({ children: <main /> });
        const bodyChildren = result.props.children.props.children;
        const navigation = bodyChildren[0];

        expect(navigation.props.accountHref).toBeNull();
        expect(navigation.props.accountSignedIn).toBe(false);
        expect(bodyChildren[1]).toBeNull();
        expect(mocks.locallyKnownListenerNavigationIdentity).not.toHaveBeenCalled();
        expect(mocks.locallyKnownAccountSession).not.toHaveBeenCalled();
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

    it.each([
        ['account.harmonicbeacon.com', 'Account | Harmonic Beacon'],
        ['account-staging.harmonicbeacon.com', 'Account | Harmonic Beacon'],
        ['live.harmonicbeacon.com', 'Harmonic Projection | Harmonic Beacon'],
    ])('scopes document metadata for %s', async (host, title) => {
        mocks.headers.mockResolvedValue(requestHeaders(host, 'en-US'));

        const result = await generateMetadata();

        expect(result.title).toBe(title);
        expect(result.openGraph?.title).toBe(title);
    });

    it('pins warm overscroll and Inter to the exact Listener document marker', () => {
        const css = readFileSync('src/app/globals.css', 'utf8');

        expect(css).toContain("html[data-hb-surface='listener'] body");
        expect(css).toContain('background: var(--hb-bg-0);');
        expect(css).toContain('font-family: var(--hb-font-sans);');
    });
});
