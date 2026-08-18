// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    headers: vi.fn(),
    localAccountState: vi.fn(),
}));

vi.mock('next/headers', () => ({ headers: mocks.headers }));
vi.mock('next/font/google', () => ({
    Syne: () => ({ variable: '--font-syne' }),
    Space_Mono: () => ({ variable: '--font-space-mono' }),
}));
vi.mock('next/font/local', () => ({
    default: () => ({ variable: '--font-local' }),
}));
vi.mock('@/lib/i18n-server', () => ({ requestLocale: vi.fn().mockResolvedValue('en') }));
vi.mock('@/lib/brand/account-navigation-state', () => ({
    locallyKnownLiveAccountSession: mocks.localAccountState,
}));
vi.mock('@/components/brand/GlobalNavigation', () => ({
    GlobalNavigation: ({ accountHref, accountSignedIn }: {
        accountHref: string;
        accountSignedIn: boolean;
    }) => <div data-testid="global-navigation" data-account-href={accountHref} data-signed-in={accountSignedIn} />,
}));
vi.mock('@/context/LocaleContext', () => ({
    LocaleProvider: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock('sonner', () => ({ Toaster: () => null }));

import RootLayout from '../layout';

describe('root layout Account navigation hint', () => {
    afterEach(() => {
        cleanup();
        vi.clearAllMocks();
    });

    it('derives the staging hint from the host-local session and SSRs only the boolean', async () => {
        const requestHeaders = new Headers({
            host: 'live-staging.harmonicbeacon.com',
            cookie: `hb_session=${'a'.repeat(43)}`,
        });
        mocks.headers.mockResolvedValue(requestHeaders);
        mocks.localAccountState.mockResolvedValue(true);

        render(await RootLayout({ children: <main>Live</main> }), { container: document });

        expect(mocks.localAccountState).toHaveBeenCalledWith(requestHeaders);
        expect(screen.getByTestId('global-navigation')).toHaveAttribute(
            'data-account-href',
            'https://account-staging.harmonicbeacon.com/account',
        );
        expect(screen.getByTestId('global-navigation')).toHaveAttribute('data-signed-in', 'true');
    });

    it('keeps production Account hidden without reading local identity state', async () => {
        mocks.headers.mockResolvedValue(new Headers({
            host: 'live.harmonicbeacon.com',
            cookie: `hb_session=${'a'.repeat(43)}`,
        }));

        render(await RootLayout({ children: <main>Live</main> }), { container: document });

        expect(mocks.localAccountState).not.toHaveBeenCalled();
        expect(screen.getByTestId('global-navigation')).toHaveAttribute(
            'data-account-href',
            'https://account.harmonicbeacon.com/account',
        );
        expect(screen.getByTestId('global-navigation')).toHaveAttribute('data-signed-in', 'false');
    });
});
