// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    headers: vi.fn(),
    localNavigationIdentity: vi.fn(),
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
    locallyKnownLiveNavigationIdentity: mocks.localNavigationIdentity,
}));
vi.mock('@/components/brand/GlobalNavigation', () => ({
    GlobalNavigation: ({ accountHref, accountSignedIn, accountMenu }: {
        accountHref: string;
        accountSignedIn: boolean;
        accountMenu?: React.ReactNode;
    }) => <div data-testid="global-navigation" data-account-href={accountHref} data-signed-in={accountSignedIn}>{accountMenu}</div>,
}));
vi.mock('@/components/brand/LiveNavigationAccountMenu', () => ({
    LiveNavigationAccountMenu: ({ displayName, staffRoleLabel }: { displayName: string; staffRoleLabel: string | null }) => (
        <div data-testid="local-account-menu" data-role={staffRoleLabel}>{displayName}</div>
    ),
}));
vi.mock('@/components/brand/LiveIdentityCacheBoundary', () => ({
    LiveIdentityCacheBoundary: () => <div data-testid="identity-cache-boundary" />,
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
        mocks.localNavigationIdentity.mockResolvedValue({ displayName: 'Nicolás', staffRole: 'ADMIN' });

        render(await RootLayout({ children: <main>Live</main> }), { container: document });

        expect(mocks.localNavigationIdentity).toHaveBeenCalledWith(requestHeaders);
        expect(screen.getByTestId('global-navigation')).toHaveAttribute(
            'data-account-href',
            'https://account-staging.harmonicbeacon.com/account',
        );
        expect(screen.getByTestId('global-navigation')).toHaveAttribute('data-signed-in', 'true');
        expect(screen.getByTestId('local-account-menu')).toHaveTextContent('Nicolás');
        expect(screen.getByTestId('local-account-menu')).toHaveAttribute('data-role', 'Administration');
        expect(screen.getByTestId('identity-cache-boundary')).toBeInTheDocument();
    });

    it('keeps production Account hidden without reading local identity state', async () => {
        mocks.headers.mockResolvedValue(new Headers({
            host: 'live.harmonicbeacon.com',
            cookie: `hb_session=${'a'.repeat(43)}`,
        }));

        render(await RootLayout({ children: <main>Live</main> }), { container: document });

        expect(mocks.localNavigationIdentity).not.toHaveBeenCalled();
        expect(screen.getByTestId('global-navigation')).toHaveAttribute(
            'data-account-href',
            'https://account.harmonicbeacon.com/account',
        );
        expect(screen.getByTestId('global-navigation')).toHaveAttribute('data-signed-in', 'false');
        expect(screen.queryByTestId('local-account-menu')).toBeNull();
        expect(screen.queryByTestId('identity-cache-boundary')).toBeNull();
    });

    it('fails neutral when the local presentation lookup is unavailable', async () => {
        mocks.headers.mockResolvedValue(new Headers({ host: 'live-staging.harmonicbeacon.com' }));
        mocks.localNavigationIdentity.mockRejectedValue(new Error('database unavailable'));

        render(await RootLayout({ children: <main>Live</main> }), { container: document });

        expect(screen.getByTestId('global-navigation')).toHaveAttribute('data-signed-in', 'false');
        expect(screen.queryByTestId('local-account-menu')).toBeNull();
    });
});
