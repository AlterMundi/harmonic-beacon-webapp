// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
    beaconAccountEnabled,
    currentAccountIdentity,
    requestLocale,
    loginProps,
} = vi.hoisted(() => ({
    beaconAccountEnabled: vi.fn(),
    currentAccountIdentity: vi.fn(),
    requestLocale: vi.fn(),
    loginProps: vi.fn(),
}));

vi.mock('next/link', () => ({
    default: ({ children, href }: { children: React.ReactNode; href: string }) => (
        <a href={href}>{children}</a>
    ),
}));
vi.mock('@/lib/account-rp', () => ({ beaconAccountEnabled }));
vi.mock('@/lib/principal', () => ({ currentAccountIdentity }));
vi.mock('@/lib/i18n-server', () => ({ requestLocale }));
vi.mock('../LoginClient', () => ({
    default: (props: Record<string, unknown>) => {
        loginProps(props);
        return <form data-testid="ticket-login-form" />;
    },
}));

async function renderPage(params: Record<string, string | string[] | undefined> = {}) {
    const { default: LoginPage } = await import('../page');
    render(await LoginPage({ searchParams: Promise.resolve(params) }));
}

describe('/login stable ticket entry', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        requestLocale.mockResolvedValue('es');
        beaconAccountEnabled.mockReturnValue(false);
        currentAccountIdentity.mockResolvedValue(null);
    });

    afterEach(cleanup);

    it('retains the legacy ticket form while Account is disabled', async () => {
        await renderPage({ next: '/session/public-room' });

        expect(screen.getByTestId('ticket-login-form')).toBeInTheDocument();
        expect(loginProps).toHaveBeenCalledWith({ next: '/session/public-room' });
        expect(currentAccountIdentity).not.toHaveBeenCalled();
    });

    it('starts the Account attendee flow without discarding the safe room return', async () => {
        beaconAccountEnabled.mockReturnValue(true);

        await renderPage({ next: '/session/public-room', account_error: '1' });

        expect(screen.getByRole('link', { name: 'Continuar con Beacon Account' })).toHaveAttribute(
            'href',
            '/api/account/login?flow=attendee&next=%2Fsession%2Fpublic-room',
        );
        expect(screen.getByRole('alert')).toHaveTextContent('No pudimos confirmar tu cuenta');
        expect(screen.queryByTestId('ticket-login-form')).toBeNull();
    });

    it('uses the canonical Account name after SSO and never asks for ticket email', async () => {
        beaconAccountEnabled.mockReturnValue(true);
        currentAccountIdentity.mockResolvedValue({ displayName: 'Nicolás Echániz' });

        await renderPage();

        expect(screen.getByText('Cuenta de Harmonic Beacon conectada')).toBeInTheDocument();
        expect(loginProps).toHaveBeenCalledWith({
            next: undefined,
            accountEnabled: true,
            defaultDisplayName: 'Nicolás Echániz',
        });
    });

    it('drops an external next target before constructing the Account URL', async () => {
        beaconAccountEnabled.mockReturnValue(true);

        await renderPage({ next: 'https://evil.example/steal' });

        expect(screen.getByRole('link', { name: 'Continuar con Beacon Account' })).toHaveAttribute(
            'href',
            '/api/account/login?flow=attendee',
        );
    });
});
