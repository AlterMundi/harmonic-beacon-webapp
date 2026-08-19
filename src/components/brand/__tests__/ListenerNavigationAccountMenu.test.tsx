// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const recover = vi.hoisted(() => vi.fn());
vi.mock('@/lib/early-birds/auth-client', () => ({ recoverListenerIdentity: recover }));

import { ListenerNavigationAccountMenu } from '../ListenerNavigationAccountMenu';

describe('Listener canonical navigation Account menu', () => {
    beforeEach(() => vi.clearAllMocks());

    it('shows only local presentation and routes sign-out through recovery', async () => {
        recover.mockResolvedValue(true);
        render(<ListenerNavigationAccountMenu
            displayName="Founder Test"
            accountHref="https://account-staging.harmonicbeacon.com/account"
            locale="en"
        />);

        expect(screen.getByText('Founder Test')).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Account' })).toHaveAttribute(
            'href',
            'https://account-staging.harmonicbeacon.com/account?lang=en',
        );
        await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
        expect(recover).toHaveBeenCalledOnce();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('keeps a failed recovery visible inside the one user menu', async () => {
        recover.mockResolvedValue(false);
        render(<ListenerNavigationAccountMenu
            displayName="Nicolás"
            accountHref="https://account-staging.harmonicbeacon.com/account"
            locale="es"
        />);

        await userEvent.click(screen.getByRole('menuitem', { name: 'Cerrar sesión' }));
        expect(screen.getByRole('alert')).toHaveTextContent(
            'No pudimos preparar un nuevo ingreso.',
        );
    });
});
