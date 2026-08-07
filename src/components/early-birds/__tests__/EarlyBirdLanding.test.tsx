// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LocaleProvider } from '@/context/LocaleContext';
import { earlyBirdCopy } from '@/lib/early-birds/copy';

const signInSocial = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
vi.mock('@/lib/early-birds/auth-client', () => ({
    earlyBirdAuthClient: { signIn: { social: signInSocial }, signOut },
}));
vi.mock('@/components/brand/LanguageControl', () => ({ default: () => <div data-testid="language" /> }));
vi.mock('@/components/brand/BrandLockup', () => ({ default: () => <a href="/early-birds">Harmonic Beacon</a> }));

import EarlyBirdLanding from '../EarlyBirdLanding';

function renderLanding(overrides: Partial<React.ComponentProps<typeof EarlyBirdLanding>> = {}) {
    return render(
        <LocaleProvider initialLocale="en">
            <EarlyBirdLanding
                signedIn={false}
                entitled={false}
                invitationAvailable={false}
                authError={false}
                providers={{ google: true, apple: true }}
                syntheticTeamEntryAvailable={false}
                freeWindow={{
                    configured: false,
                    active: false,
                    timeZone: null,
                    localStartMinute: null,
                    selectedAt: null,
                    changeAllowedAt: null,
                    canChange: true,
                    activeStart: null,
                    activeEnd: null,
                    nextStart: null,
                    nextEnd: null,
                }}
                {...overrides}
            />
        </LocaleProvider>,
    );
}

describe('EarlyBird public landing', () => {
    beforeEach(() => {
        signInSocial.mockReset();
        signInSocial.mockResolvedValue({ error: null });
        signOut.mockReset();
        signOut.mockResolvedValue({ error: null });
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
            callbackURL: '/early-birds/redeem',
            errorCallbackURL: '/early-birds?authError=1',
            requestSignUp: true,
        });
    });

    it('uses audience-neutral account and privacy language in both locales', () => {
        expect(earlyBirdCopy.es.privacy).toBe(
            'Tu cuenta y membresía administran el acceso privado. No creamos historiales personales de escucha.',
        );
        expect(earlyBirdCopy.en.privacy).toBe(
            'Your account and membership manage private access. We do not create personal listening histories.',
        );
        expect(`${earlyBirdCopy.es.privacy} ${earlyBirdCopy.en.privacy}`)
            .not.toMatch(/adult|child|minor|menor|adulta/i);
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

    it('takes an entitled signed-in listener directly to the private home', () => {
        renderLanding({ signedIn: true, entitled: true });
        expect(screen.getAllByRole('link', { name: 'Enter the Beacon' }))
            .toEqual(expect.arrayContaining([
                expect.objectContaining({ href: expect.stringMatching(/\/early-birds$/) }),
            ]));
        expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
        expect(screen.getByRole('button', { name: 'Sign out' })).toBeEnabled();
    });
});
