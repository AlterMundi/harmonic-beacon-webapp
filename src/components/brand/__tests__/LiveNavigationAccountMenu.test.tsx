// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const replace = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace, refresh }),
}));

import {
    LiveNavigationAccountMenu,
    trustedAccountLogoutURL,
} from '../LiveNavigationAccountMenu';

const ACCOUNT = 'https://account-staging.harmonicbeacon.com/account' as const;

describe('Live navigation Account menu', () => {
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('keeps the signed-in menu compact and adds Operations only for staff', () => {
        const { rerender } = render(<LiveNavigationAccountMenu
            displayName="Nicolás Echániz"
            staffRoleLabel="Administración"
            accountHref={ACCOUNT}
            locale="es"
        />);

        expect(screen.getByText('Nicolás Echániz')).toBeInTheDocument();
        expect(screen.getByText('Administración')).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Cuenta' }))
            .toHaveAttribute('href', `${ACCOUNT}?lang=es`);
        expect(screen.getByRole('menuitem', { name: 'Operaciones' }))
            .toHaveAttribute('href', '/ops/events');
        expect(screen.getByRole('menuitem', { name: 'Cerrar sesión' })).toBeInTheDocument();
        expect(document.body).not.toHaveTextContent('PayPal');
        expect(document.body).not.toHaveTextContent('USD');

        rerender(<LiveNavigationAccountMenu
            displayName="Founder Test"
            staffRoleLabel={null}
            accountHref={ACCOUNT}
            locale="en"
        />);
        expect(screen.queryByRole('menuitem', { name: 'Operations' })).toBeNull();
    });

    it('revokes the local session before returning to the public Live landing', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ ok: true }),
        });
        vi.stubGlobal('fetch', fetchMock);
        render(<LiveNavigationAccountMenu
            displayName="Nicolás"
            staffRoleLabel="Administrator"
            accountHref={ACCOUNT}
            locale="en"
        />);

        fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/auth/logout', {
            method: 'POST',
            headers: { Accept: 'application/json' },
        }));
        expect(replace).toHaveBeenCalledWith('/');
        expect(refresh).toHaveBeenCalled();
    });

    it('shows a retryable error without pretending sign-out succeeded', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }));
        render(<LiveNavigationAccountMenu
            displayName={null}
            staffRoleLabel={null}
            accountHref={ACCOUNT}
            locale="en"
        />);

        fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('We could not sign you out');
        expect(replace).not.toHaveBeenCalled();
    });

    it.each([
        ['https://account-staging.harmonicbeacon.com/account/logout?initiation=opaque', true],
        ['https://account-staging.harmonicbeacon.com/api/account/auth/oauth2/end-session?state=opaque', false],
        ['https://account.harmonicbeacon.com/account/logout', false],
        ['https://account-staging.harmonicbeacon.com/account', false],
        ['https://account-staging.harmonicbeacon.com.evil.example/logout', false],
        ['javascript:alert(1)', false],
        ['not a URL', false],
    ])('validates the Account logout destination %s', (raw, accepted) => {
        expect(Boolean(trustedAccountLogoutURL(raw, ACCOUNT))).toBe(accepted);
    });
});
