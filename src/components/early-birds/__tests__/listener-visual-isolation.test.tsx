// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';
import type { SerializedEarlyBirdFreeWindowState } from '@/lib/early-birds/free-window';

const refresh = vi.hoisted(() => vi.fn());
const signInSocial = vi.hoisted(() => vi.fn());
const signInMagicLink = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/early-birds/auth-client', () => ({
    earlyBirdAuthClient: { signIn: { social: signInSocial, magicLink: signInMagicLink }, signOut },
}));
vi.mock('@/components/brand/BrandLockup', () => ({
    default: ({ href }: { href: string }) => <a href={href}>Harmonic Beacon</a>,
}));

import EarlyBirdLanding from '../EarlyBirdLanding';
import EarlyBirdUnavailable from '../EarlyBirdUnavailable';
import FreeInvitationRedeemer from '../FreeInvitationRedeemer';
import FreeWindowSetup from '../FreeWindowSetup';
import SyntheticTeamEntryForm from '../SyntheticTeamEntryForm';
import WelcomeAccessAction from '../WelcomeAccessAction';

const EVENT_VISUAL_CLASS = /event-(shell|button|alert|field|card)/;

const emptyFreeWindow: SerializedEarlyBirdFreeWindowState = {
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
};

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
                freeWindow={emptyFreeWindow}
                welcome={{ available: false, active: false, used: false, startedAt: null, endsAt: null }}
                membership={{ kind: 'none', state: 'none' }}
                serverNow="2026-08-07T15:00:00.000Z"
                {...overrides}
            />
        </LocaleProvider>,
    );
}

describe('Listener visual isolation from event surfaces (issues #213, #198)', () => {
    beforeEach(() => {
        refresh.mockReset();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));
    });
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('globals.css defines additive listener-scoped mirrors of the borrowed event primitives', () => {
        const css = readFileSync('src/app/globals.css', 'utf8');
        for (const rule of [
            '.listener-page-shell',
            '.listener-button--primary',
            '.listener-button--secondary',
            '.listener-button--ghost',
            '.listener-alert--danger',
            '.listener-alert--error',
            '.listener-input',
        ]) {
            expect(css, `globals.css is missing ${rule}`).toContain(rule);
        }
    });

    it('standalone Listener pages render the listener page shell, never the event shell', () => {
        const unavailable = render(
            <LocaleProvider initialLocale="es"><EarlyBirdUnavailable /></LocaleProvider>,
        );
        expect(unavailable.container.querySelector('main')).toHaveClass('listener-page-shell');
        expect(unavailable.container.innerHTML).not.toMatch(EVENT_VISUAL_CLASS);
        unavailable.unmount();

        const redeemer = render(
            <LocaleProvider initialLocale="en"><FreeInvitationRedeemer /></LocaleProvider>,
        );
        expect(redeemer.container.querySelector('main')).toHaveClass('listener-page-shell');
        expect(redeemer.container.innerHTML).not.toMatch(EVENT_VISUAL_CLASS);
    });

    it('invitation redemption keeps one contextual primary listener action and a styled danger alert', async () => {
        render(<LocaleProvider initialLocale="en"><FreeInvitationRedeemer /></LocaleProvider>);

        const action = screen.getByRole('button', { name: 'Activate invitation' });
        expect(action).toHaveClass('listener-button', 'listener-button--primary');

        await userEvent.click(action);
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveClass('listener-alert', 'listener-alert--danger');
    });

    it('Free schedule errors surface through the styled listener error alert variant', async () => {
        render(
            <LocaleProvider initialLocale="en"><FreeWindowSetup state={emptyFreeWindow} /></LocaleProvider>,
        );

        const primary = await waitFor(() => screen.getByRole('button', { name: 'Listen free now' }));
        expect(primary).toHaveClass('listener-button', 'listener-button--primary');
        expect(screen.getByRole('button', { name: 'Choose another time' }))
            .toHaveClass('listener-button', 'listener-button--secondary');

        await userEvent.click(primary);
        const alert = await screen.findByRole('alert');
        // `event-alert--error` never had a rule; the listener-scoped variant does.
        expect(alert).toHaveClass('listener-alert', 'listener-alert--error');
    });

    it('welcome access errors surface through the styled listener error alert variant', async () => {
        render(<LocaleProvider initialLocale="es"><WelcomeAccessAction /></LocaleProvider>);

        const action = screen.getByRole('button', { name: 'Escuchar ahora' });
        expect(action).toHaveClass('listener-button', 'listener-button--primary');

        await userEvent.click(action);
        const alert = await screen.findByRole('alert');
        expect(alert).toHaveClass('listener-alert', 'listener-alert--error');
    });

    it('the staging team entry form uses listener fields, alert and button classes only', async () => {
        render(<LocaleProvider initialLocale="en"><SyntheticTeamEntryForm /></LocaleProvider>);

        expect(screen.getByLabelText('Test name')).toHaveClass('listener-input');
        expect(screen.getByLabelText('Synthetic account')).toHaveClass('listener-input');
        expect(screen.getByLabelText('Temporary access code')).toHaveClass('listener-input');
        expect(screen.getByRole('button', { name: 'Enter staging' }))
            .toHaveClass('listener-button', 'listener-button--ghost');

        await userEvent.type(screen.getByLabelText('Test name'), 'Team Listener');
        await userEvent.type(screen.getByLabelText('Synthetic account'), 'team.listener@e2e.invalid');
        await userEvent.type(
            screen.getByLabelText('Temporary access code'),
            'team-staging-access-code-0000000000000001',
        );
        await userEvent.click(screen.getByRole('button', { name: 'Enter staging' }));

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveClass('listener-alert', 'listener-alert--danger');
    });

    it('the public landing actions use listener button classes and keep one contextual primary action', () => {
        const anonymous = renderLanding();
        expect(screen.getByRole('button', { name: 'Continue with Google' }))
            .toHaveClass('listener-button', 'listener-button--secondary');
        expect(anonymous.container.innerHTML).not.toMatch(EVENT_VISUAL_CLASS);
        // The anonymous surface offers no competing primary action inside the access card.
        expect(
            anonymous.container.querySelectorAll('.listener-access__card .listener-button--primary'),
        ).toHaveLength(0);
        anonymous.unmount();

        const entitled = renderLanding({ signedIn: true, entitled: true });
        const primaries = entitled.container.querySelectorAll(
            '.listener-access__card .listener-button--primary',
        );
        expect(primaries).toHaveLength(1);
        expect(primaries[0]).toHaveTextContent('Enter the Beacon');
        expect(entitled.container.innerHTML).not.toMatch(EVENT_VISUAL_CLASS);
    });
});
