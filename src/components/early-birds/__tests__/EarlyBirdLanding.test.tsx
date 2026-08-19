// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LocaleProvider } from '@/context/LocaleContext';
import { earlyBirdCopy } from '@/lib/early-birds/copy';
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
const recoverIdentity = vi.hoisted(() => vi.fn());
const markOAuthAttempt = vi.hoisted(() => vi.fn());
const consumeOAuthAttempt = vi.hoisted(() => vi.fn());
vi.mock('@/lib/early-birds/auth-client', () => ({
    recoverListenerIdentity: recoverIdentity,
    markListenerOAuthAttempt: markOAuthAttempt,
    consumeListenerOAuthAttempt: consumeOAuthAttempt,
}));
import EarlyBirdLanding from '../EarlyBirdLanding';

function renderLanding(overrides: Partial<React.ComponentProps<typeof EarlyBirdLanding>> = {}) {
    return render(
        <LocaleProvider initialLocale="en">
            <EarlyBirdLanding
                signedIn={false}
                entitled={false}
                serviceUnavailable={null}
                invitationAvailable={false}
                authError={false}
                syntheticTeamEntryAvailable={false}
                serverNow="2026-08-07T15:00:00.000Z"
                {...overrides}
            />
        </LocaleProvider>,
    );
}

describe('EarlyBird public landing', () => {
    beforeEach(() => {
        recoverIdentity.mockReset();
        recoverIdentity.mockResolvedValue(false);
        markOAuthAttempt.mockReset();
        consumeOAuthAttempt.mockReset();
        consumeOAuthAttempt.mockReturnValue(false);
        refresh.mockReset();
        window.localStorage.clear();
        window.sessionStorage.clear();
    });
    afterEach(() => cleanup());

    it('delegates provider-neutral sign-in to Account and marks a local OAuth attempt', async () => {
        renderLanding({ invitationAvailable: true });
        const signIn = screen.getByRole('link', { name: 'Sign in or create an account' });
        expect(signIn).toHaveAttribute('href', '/api/account/login');
        expect(screen.queryByText(/Continue with Google|Continue with Apple/)).not.toBeInTheDocument();
        await userEvent.click(signIn);
        expect(markOAuthAttempt).toHaveBeenCalledOnce();
    });

    it('keeps login in the compact hero and removes explanatory landing copy', () => {
        const { container } = renderLanding();

        expect(container.querySelector('.listener-public-hero'))
            .toHaveAttribute('aria-labelledby', 'listener-public-title');
        expect(container.querySelector('.listener-public-altar')).toBeInTheDocument();
        expect(screen.queryByRole('link', { name: 'Harmonic Beacon' })).not.toBeInTheDocument();
        expect(container.querySelector('.listener-field__spark')).toHaveTextContent('✦');
        expect(container.querySelector('.listener-field svg')).not.toBeInTheDocument();
        expect(container.querySelector('.listener-public-altar .listener-field')).not.toBeInTheDocument();
        expect(container.querySelector('.listener-public-hero > .listener-field')).toBeInTheDocument();
        expect(container.querySelector('.listener-public-hero .listener-access__card'))
            .toContainElement(screen.getByRole('link', { name: 'Sign in or create an account' }));
        expect(screen.getByRole('heading', { name: 'Remember your harmonic center.' }))
            .toBeInTheDocument();
        expect(screen.queryByText('Listen within the time available to your account')).not.toBeInTheDocument();
        expect(screen.queryByText('An optional introduction before entering the Beacon')).not.toBeInTheDocument();
        expect(screen.queryByText('Three Free hours each week')).not.toBeInTheDocument();
        expect(screen.queryByText(/Your account and membership manage access/)).not.toBeInTheDocument();
        expect(container.textContent).not.toMatch(/Presence|here now|Your listening space|Listening Altar/i);
    });

    it('does not expose legacy provider, magic-link or password controls in Listener', () => {
        renderLanding();
        expect(screen.queryByText(/Continue with Google|Continue with Apple/)).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Sign in or create an account' }))
            .toHaveAttribute('href', '/api/account/login');
    });

    it('turns a callback failure into an explicit, one-shot account recovery', async () => {
        renderLanding({ authError: true });

        expect(screen.getByRole('alert')).toHaveTextContent('We could not complete sign-in.');
        expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
        expect(consumeOAuthAttempt).toHaveBeenCalledOnce();
        expect(recoverIdentity).not.toHaveBeenCalled();
        await userEvent.click(screen.getByRole('button', { name: 'Use another account' }));

        expect(recoverIdentity).toHaveBeenCalledOnce();
        expect(await screen.findByText(/We could not prepare a new sign-in/))
            .toHaveAttribute('role', 'alert');
        expect(screen.getByRole('button', { name: 'Use another account' })).toBeEnabled();
    });

    it('automatically consumes one locally initiated OAuth failure exactly once', async () => {
        consumeOAuthAttempt.mockReturnValueOnce(true);
        const view = renderLanding({ authError: true });

        expect(await screen.findByText(/We could not prepare a new sign-in/)).toBeInTheDocument();
        expect(consumeOAuthAttempt).toHaveBeenCalledOnce();
        expect(recoverIdentity).toHaveBeenCalledOnce();

        view.rerender(
            <LocaleProvider initialLocale="en">
                <EarlyBirdLanding
                    signedIn={false}
                    entitled={false}
                    serviceUnavailable={null}
                    invitationAvailable={false}
                    authError
                    syntheticTeamEntryAvailable={false}
                    serverNow="2026-08-07T15:00:00.000Z"
                />
            </LocaleProvider>,
        );
        expect(consumeOAuthAttempt).toHaveBeenCalledOnce();
        expect(recoverIdentity).toHaveBeenCalledOnce();
    });

    it('hides email login when the delivery boundary is incomplete', () => {
        renderLanding();
        expect(screen.queryByLabelText('Email address')).not.toBeInTheDocument();
    });

    it.each([
        ['identity', 'The identity service is not responding.'],
        ['access', 'We could not check your access or membership.'],
    ] as const)('fails truthfully and retryably when %s resolution is unavailable', (kind, detail) => {
        renderLanding({
            signedIn: kind === 'access',
            serviceUnavailable: kind,
        });

        expect(screen.getByRole('alert')).toHaveTextContent(detail);
        expect(screen.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/listener');
        expect(screen.queryByText(/daily time|first listen/i)).toBeNull();
        expect(screen.queryByRole('link', { name: 'Sign in or create an account' })).toBeNull();
        expect(screen.queryByLabelText('Email address')).toBeNull();
    });

    it('takes an entitled signed-in listener directly to the private home', () => {
        renderLanding({ signedIn: true, entitled: true });
        expect(screen.getAllByRole('link', { name: 'Enter the Beacon' }))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ href: expect.stringMatching(/\/listener$/) }),
            ]));
        expect(screen.queryByRole('link', { name: 'Sign in or create an account' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    });

    it('shows the server-supplied weekly quota without a schedule or welcome action', () => {
        renderLanding({
            signedIn: true,
            quota: {
                policy: 'personal-7-day-v1',
                status: 'available',
                cycleStartedAt: '2026-08-07T15:00:00.000Z',
                cycleEndsAt: '2026-08-14T15:00:00.000Z',
                baseAllowanceMs: 10_800_000,
                bonusAllowanceMs: 0,
                consumedMs: 1_140_000,
                remainingMs: 9_660_000,
                activelyConsuming: false,
                exhaustsAt: '2026-08-07T17:41:00.000Z',
                nextCycleAt: '2026-08-14T15:00:00.000Z',
            },
        });

        expect(screen.getByText('You have 2h 41m left this week')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'Manage membership' }))
            .toHaveAttribute('href', '/listener/membership');
        expect(screen.queryByText(/PayPal|Mercado Pago|USD 5/)).toBeNull();
        expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
        expect(screen.queryByText(/daily time|first listen/i)).toBeNull();
    });

    it('shows the unavailable membership state in Spanish without inventing a contact action', () => {
        render(
            <LocaleProvider initialLocale="es">
                <EarlyBirdLanding
                    signedIn
                    entitled={false}
                    serviceUnavailable={null}
                    invitationAvailable={false}
                    authError={false}
                    syntheticTeamEntryAvailable={false}
                    serverNow="2026-08-07T15:00:00.000Z"
                    quota={{
                        policy: 'personal-7-day-v1',
                        status: 'available',
                        cycleStartedAt: '2026-08-07T15:00:00.000Z',
                        cycleEndsAt: '2026-08-14T15:00:00.000Z',
                        baseAllowanceMs: 10_800_000,
                        bonusAllowanceMs: 0,
                        consumedMs: 0,
                        remainingMs: 10_800_000,
                        activelyConsuming: false,
                        exhaustsAt: null,
                        nextCycleAt: '2026-08-14T15:00:00.000Z',
                    }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByRole('link', { name: 'Administrar membresía' }))
            .toHaveAttribute('href', '/listener/membership');
        expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    });

    it('keeps checkout and terminal provider detail behind the membership page', () => {
        const { container } = renderLanding({ signedIn: true });

        expect(screen.getByRole('link', { name: 'Manage membership' })).toBeInTheDocument();
        expect(container.querySelector('.listener-checkout')).toBeNull();
        expect(container.querySelector('.listener-membership-status')).toBeNull();
        expect(container.textContent).not.toMatch(/PayPal|Mercado Pago|USD 5|refunded/i);
        expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    });

    it('uses neutral Listener positioning in both languages', () => {
        expect(earlyBirdCopy.es.eyebrow).toBe('HARMONIC BEACON · LISTENER');
        expect(earlyBirdCopy.en.eyebrow).toBe('HARMONIC BEACON · LISTENER');
        expect(`${earlyBirdCopy.es.intro} ${earlyBirdCopy.en.intro}`)
            .not.toMatch(/disponible siempre|available whenever/i);
        expect(Object.values(earlyBirdCopy.es).join(' '))
            .not.toMatch(/\b(elegí|tocá|habilitá|querés)\b/i);
    });
});
