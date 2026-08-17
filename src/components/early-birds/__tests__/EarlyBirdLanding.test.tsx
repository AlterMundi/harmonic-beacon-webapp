// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LocaleProvider } from '@/context/LocaleContext';
import { earlyBirdCopy } from '@/lib/early-birds/copy';

const signInSocial = vi.hoisted(() => vi.fn());
const signInMagicLink = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/early-birds/auth-client', () => ({
    earlyBirdAuthClient: { signIn: { social: signInSocial, magicLink: signInMagicLink }, signOut },
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
                providers={{ google: true, apple: true }}
                emailMagicLinkAvailable={false}
                syntheticTeamEntryAvailable={false}
                membership={{ kind: 'none', state: 'none' }}
                serverNow="2026-08-07T15:00:00.000Z"
                {...overrides}
            />
        </LocaleProvider>,
    );
}

describe('EarlyBird public landing', () => {
    beforeEach(() => {
        signInSocial.mockReset();
        signInSocial.mockResolvedValue({ error: null });
        signInMagicLink.mockReset();
        signInMagicLink.mockResolvedValue({ data: { status: true }, error: null });
        signOut.mockReset();
        signOut.mockResolvedValue({ error: null });
        refresh.mockReset();
        window.localStorage.clear();
    });
    afterEach(() => cleanup());

    it('offers exactly Google and Apple and preserves a cookie-backed invitation through OAuth', async () => {
        renderLanding({ invitationAvailable: true });
        expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
        expect(signInSocial).toHaveBeenCalledWith({
            provider: 'google',
            callbackURL: '/listener/redeem',
            errorCallbackURL: '/listener?authError=1',
            requestSignUp: true,
        });
    });

    it('keeps login in the compact hero and removes explanatory landing copy', () => {
        const { container } = renderLanding();

        expect(screen.queryByRole('link', { name: 'Harmonic Beacon' })).not.toBeInTheDocument();
        expect(container.querySelector('.listener-field__mark')).toHaveProperty('tagName', 'svg');
        expect(container.querySelector('.listener-public-hero .listener-access__card'))
            .toContainElement(screen.getByRole('button', { name: 'Continue with Google' }));
        expect(screen.getByRole('heading', { name: 'Remember your harmonic center.' }))
            .toBeInTheDocument();
        expect(screen.queryByText('Listen within the time available to your account')).not.toBeInTheDocument();
        expect(screen.queryByText('An optional introduction before entering the Beacon')).not.toBeInTheDocument();
        expect(screen.queryByText('Three Free hours each week')).not.toBeInTheDocument();
        expect(screen.queryByText(/Your account and membership manage access/)).not.toBeInTheDocument();
    });

    it('hides an unconfigured provider from the public identity surface', () => {
        renderLanding({ providers: { google: true, apple: false } });
        expect(screen.queryByRole('button', { name: /Continue with Apple/ })).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    });

    it('reports a rejected social sign-in and re-enables the providers', async () => {
        signInSocial.mockRejectedValueOnce(new Error('network unavailable'));
        renderLanding();

        await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(earlyBirdCopy.en.authError);
        expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeEnabled();
        expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeEnabled();
    });

    it('offers an enumeration-resistant email fallback only when delivery is configured', async () => {
        renderLanding({ providers: { google: true, apple: false }, emailMagicLinkAvailable: true });

        await userEvent.type(screen.getByLabelText('Email address'), 'listener@example.test');
        await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));

        expect(signInMagicLink).toHaveBeenCalledWith({
            email: 'listener@example.test',
            callbackURL: '/listener',
            errorCallbackURL: '/listener?authError=1',
            metadata: { locale: 'en' },
        });
        expect(screen.getByRole('status')).toHaveTextContent('If this email can be used for access');
        expect(screen.queryByDisplayValue('listener@example.test')).not.toBeInTheDocument();
    });

    it('shows the same generic response when the email request transport rejects', async () => {
        signInMagicLink.mockRejectedValueOnce(new Error('provider unavailable'));
        renderLanding({ emailMagicLinkAvailable: true });

        await userEvent.type(screen.getByLabelText('Email address'), 'unknown@example.test');
        await userEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }));

        expect(await screen.findByRole('status')).toHaveTextContent('If this email can be used for access');
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('hides email login when the delivery boundary is incomplete', () => {
        renderLanding({ emailMagicLinkAvailable: false });
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
        expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
        expect(screen.queryByLabelText('Email address')).toBeNull();
    });

    it('takes an entitled signed-in listener directly to the private home', () => {
        renderLanding({ signedIn: true, entitled: true });
        expect(screen.getAllByRole('link', { name: 'Enter the Beacon' }))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ href: expect.stringMatching(/\/listener$/) }),
            ]));
        expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    });

    it('shows the server-supplied weekly quota without a schedule or welcome action', () => {
        renderLanding({
            signedIn: true,
            providers: { google: true, apple: false },
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
        expect(screen.queryByText(/daily time|first listen/i)).toBeNull();
    });

    it('uses the private checkout action instead of the mail contact fallback', () => {
        renderLanding({
            signedIn: true,
            liveWorkbench: { provider: 'mercado_pago', csrfToken: 'csrf-proof' },
        });

        expect(screen.queryByRole('link', { name: 'Become a member for full access' })).toBeNull();
        expect(document.querySelector('details[data-listener-live-workbench="private"]'))
            .toHaveTextContent('Become a member for full access');
        expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    });

    it('explains terminal Founder access and returns the account to truthful Free choices', () => {
        renderLanding({
            signedIn: true,
            membership: { kind: 'founder', provider: 'mercado-pago', state: 'refunded' },
        });

        expect(screen.getByRole('status')).toHaveTextContent(
            'The payment was refunded and Founder access has ended.',
        );
        expect(screen.getByRole('status')).toHaveTextContent(
            'You can continue with the Free listening available to your account.',
        );
        expect(screen.queryByText(/daily time|first listen/i)).toBeNull();
        expect(screen.queryByText('MERCADO_PAGO')).not.toBeInTheDocument();
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
