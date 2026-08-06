// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LocaleProvider } from '@/context/LocaleContext';

const signInSocial = vi.hoisted(() => vi.fn());
vi.mock('@/lib/early-birds/auth-client', () => ({
    earlyBirdAuthClient: { signIn: { social: signInSocial } },
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
                inviteToken={null}
                authError={false}
                testAccessEnabled={false}
                providers={{ google: true, apple: true }}
                {...overrides}
            />
        </LocaleProvider>,
    );
}

describe('EarlyBird public landing', () => {
    beforeEach(() => {
        signInSocial.mockReset();
        signInSocial.mockResolvedValue({ error: null });
        window.localStorage.clear();
    });
    afterEach(() => cleanup());

    it('offers exactly Google and Apple and preserves an invitation through OAuth', async () => {
        renderLanding({ inviteToken: 'opaque_'.padEnd(43, 'x') });
        expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Continue with Apple' })).toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Continue with Google' }));
        expect(signInSocial).toHaveBeenCalledWith({
            provider: 'google',
            callbackURL: expect.stringMatching(/^\/early-birds\/redeem\?token=/),
            errorCallbackURL: '/early-birds?authError=1',
            requestSignUp: true,
        });
    });

    it('makes an unconfigured provider visibly unavailable', () => {
        renderLanding({ providers: { google: true, apple: false } });
        expect(screen.getByRole('button', { name: /Continue with Apple/ })).toBeDisabled();
        expect(screen.getByText('Configuration pending')).toBeInTheDocument();
    });

    it('takes an entitled signed-in listener directly to the private home', () => {
        renderLanding({ signedIn: true, entitled: true });
        expect(screen.getByRole('link', { name: 'Enter the Beacon' })).toHaveAttribute('href', '/early-birds/home');
        expect(screen.queryByRole('button', { name: 'Continue with Google' })).toBeNull();
    });
});
