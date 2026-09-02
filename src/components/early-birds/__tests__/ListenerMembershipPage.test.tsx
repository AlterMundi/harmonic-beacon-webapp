// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

vi.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: vi.fn() }),
}));

import ListenerMembershipPage from '../ListenerMembershipPage';

const base = {
    quota: null,
    serverNow: '2026-08-18T23:40:00.000Z',
    checkoutAvailability: { paypal: false, mercadoPago: false },
    checkoutEnvironment: 'staging' as const,
    liveWorkbench: null,
};

afterEach(() => cleanup());

describe('Listener membership management page', () => {
    it('keeps Founder details and actions on the explicit management page', () => {
        render(
            <LocaleProvider initialLocale="en">
                <ListenerMembershipPage
                    {...base}
                    membership={{
                        kind: 'founder',
                        provider: 'paypal',
                        state: 'active',
                        serviceThrough: '2026-09-18T23:40:00.000Z',
                    }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByRole('heading', { name: 'Membership' })).toBeInTheDocument();
        expect(screen.getByText('Founding Listener · USD 5/month')).toBeInTheDocument();
        expect(screen.getByText('PayPal')).toBeInTheDocument();
        expect(screen.getByText(/Current period through/)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Cancel membership' })).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /Back to Listener/ })).toHaveAttribute('href', '/listener');
    });

    it('puts Free quota and enabled checkout on this page instead of the player', () => {
        render(
            <LocaleProvider initialLocale="en">
                <ListenerMembershipPage
                    {...base}
                    membership={{ kind: 'none', state: 'none' }}
                    checkoutAvailability={{ paypal: true, mercadoPago: false }}
                    quota={{
                        policy: 'personal-7-day-v1',
                        status: 'available',
                        cycleStartedAt: '2026-08-18T23:40:00.000Z',
                        cycleEndsAt: '2026-08-25T23:40:00.000Z',
                        baseAllowanceMs: 10_800_000,
                        bonusAllowanceMs: 0,
                        consumedMs: 0,
                        remainingMs: 10_800_000,
                        activelyConsuming: false,
                        exhaustsAt: null,
                        nextCycleAt: '2026-08-25T23:40:00.000Z',
                    }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByText('You have 3h left this week')).toBeInTheDocument();
        expect(screen.getByText('Try Founder membership')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Continue with PayPal' })).toBeInTheDocument();
        expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    });

    it('shows a quiet non-actionable state when purchasing is unavailable', () => {
        render(
            <LocaleProvider initialLocale="es">
                <ListenerMembershipPage {...base} membership={{ kind: 'none', state: 'none' }} />
            </LocaleProvider>,
        );

        expect(screen.getByRole('heading', { name: 'Membresía' })).toBeInTheDocument();
        expect(screen.getByRole('status')).toHaveTextContent(
            'La membresía no está disponible para compra en este momento.',
        );
        expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    });

    it('fails closed without exposing estimated membership or checkout', () => {
        render(
            <LocaleProvider initialLocale="en">
                <ListenerMembershipPage
                    {...base}
                    membership={{ kind: 'none', state: 'none' }}
                    checkoutAvailability={{ paypal: true, mercadoPago: true }}
                    serviceUnavailable
                />
            </LocaleProvider>,
        );

        expect(screen.getByRole('alert')).toHaveTextContent('We could not check your access or membership.');
        expect(screen.queryByText('Continue with PayPal')).toBeNull();
        expect(screen.queryByText('Continue with Mercado Pago')).toBeNull();
    });
});
