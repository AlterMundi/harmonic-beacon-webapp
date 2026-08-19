// @vitest-environment jsdom
import { readFileSync } from 'node:fs';

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

const refresh = vi.hoisted(() => vi.fn());
const signInSocial = vi.hoisted(() => vi.fn());
const signInMagicLink = vi.hoisted(() => vi.fn());
const signOut = vi.hoisted(() => vi.fn());
const recoverIdentity = vi.hoisted(() => vi.fn());
const markOAuthAttempt = vi.hoisted(() => vi.fn());
const clearOAuthAttempt = vi.hoisted(() => vi.fn());
const consumeOAuthAttempt = vi.hoisted(() => vi.fn(() => false));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/early-birds/auth-client', () => ({
    earlyBirdAuthClient: { signIn: { social: signInSocial, magicLink: signInMagicLink }, signOut },
    recoverListenerIdentity: recoverIdentity,
    markListenerOAuthAttempt: markOAuthAttempt,
    clearListenerOAuthAttempt: clearOAuthAttempt,
    consumeListenerOAuthAttempt: consumeOAuthAttempt,
}));
import EarlyBirdLanding from '../EarlyBirdLanding';
import EarlyBirdUnavailable from '../EarlyBirdUnavailable';
import FreeInvitationRedeemer from '../FreeInvitationRedeemer';
import FreeQuotaStatus from '../FreeQuotaStatus';
import SyntheticTeamEntryForm from '../SyntheticTeamEntryForm';

const EVENT_VISUAL_CLASS = /event-(shell|button|alert|field|card)/;

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

    it('maps every Listener surface to the canonical warm brand without changing event tokens', () => {
        const css = readFileSync('src/app/globals.css', 'utf8');
        const listenerCss = css.slice(css.indexOf('HARMONIC BEACON LISTENER'));

        expect(listenerCss).toContain('--night: var(--hb-bg-0);');
        expect(listenerCss).toContain('--paper: var(--hb-bone);');
        expect(listenerCss).toContain('--gold: var(--hb-gold);');
        expect(listenerCss).toContain('font-family: var(--hb-font-sans);');
        expect(listenerCss).toContain('font-family: var(--hb-font-serif);');
        expect(listenerCss).not.toContain('rgba(124, 234, 255');
        expect(listenerCss).not.toContain('rgba(158, 114, 255');
        expect(listenerCss).not.toContain('rgba(255, 143, 200');
    });

    it('keeps the real BeaconField visible through the warm translucent altars', () => {
        const css = readFileSync('src/app/globals.css', 'utf8');

        const staticFieldStart = css.indexOf('.listener-static-field {');
        const staticFieldEnd = css.indexOf('\n}', staticFieldStart);
        const staticField = css.slice(staticFieldStart, staticFieldEnd);
        expect(staticField).toContain('position: fixed;');
        expect(css).toContain('.listener-shell__frame--home > .listener-static-field .listener-field {');
        expect(css).toContain('.listener-public-hero > .listener-field {');
        expect(css).not.toContain('.listener-altar > .listener-static-field .listener-field {');
        expect(css).not.toContain('.listener-public-altar > .listener-field {');

        for (const selector of ['.listener-altar', '.listener-public-altar']) {
            const start = css.indexOf(`${selector} {`);
            const end = css.indexOf('\n}', start);
            const rule = css.slice(start, end);

            expect(start, `${selector} must exist`).toBeGreaterThanOrEqual(0);
            expect(rule).toContain('rgba(36, 29, 21, 0.24)');
            expect(rule).toContain('rgba(22, 18, 13, 0.44)');
            expect(rule).toContain('backdrop-filter: blur(3px) saturate(105%);');
            expect(rule).toContain('overflow: hidden;');
        }

        for (const selector of ['.listener-control-panel', '.listener-access__card']) {
            const start = css.indexOf(`${selector} {`);
            const end = css.indexOf('\n}', start);
            const rule = css.slice(start, end);
            expect(rule).toContain('background: transparent;');
            expect(rule).toContain('border-top: 1px solid var(--hb-hair-soft);');
        }
    });

    it('keeps every BeaconField loop spatially continuous at its cycle boundary', () => {
        const css = readFileSync('src/app/globals.css', 'utf8');
        expect(css).toContain(
            'from { transform: translate(-50%, -50%) rotate(0deg); }',
        );
        expect(css).toContain(
            'to { transform: translate(-50%, -50%) rotate(360deg); }',
        );
        expect(css).toContain(
            '0%, 100% { opacity: 0.58; transform: translate(-50%, -50%) scale(0.96); }',
        );
        expect(css).toContain('animation: listener-core-breathe 5.5s ease-in-out infinite;');
    });

    it('keeps the field decorative, inert and inexpensive to composite', () => {
        const css = readFileSync('src/app/globals.css', 'utf8');
        const start = css.indexOf('\n.listener-field {\n') + 1;
        const end = css.indexOf('\n}', start);
        const rule = css.slice(start, end);

        expect(rule).toContain('contain: layout paint;');
        expect(rule).toContain('pointer-events: none;');
        expect(rule).toContain('user-select: none;');
    });

    it('restores the warm pre-brand spark without a central Lissajous logo', () => {
        const { container } = renderLanding();
        const field = container.querySelector('.listener-field');

        expect(screen.queryByRole('link', { name: 'Harmonic Beacon' })).not.toBeInTheDocument();
        expect(field).toHaveAttribute('aria-hidden', 'true');
        expect(field?.querySelector('.listener-field__aurora')).toBeInTheDocument();
        expect(field?.querySelectorAll('.listener-field__orbit')).toHaveLength(2);
        expect(field?.querySelector('.listener-field__core .listener-field__spark'))
            .toHaveTextContent('✦');
        expect(field?.querySelector('.listener-field__horizon')).toBeInTheDocument();
        expect(field?.querySelectorAll('.listener-field__point')).toHaveLength(12);
        expect(field?.querySelector('svg, canvas, audio, video')).not.toBeInTheDocument();
        expect(field?.querySelector('.hb-brand__mark')).not.toBeInTheDocument();
    });

    it('fully disables field motion when reduced motion is requested', () => {
        const css = readFileSync('src/app/globals.css', 'utf8');
        const reducedMotion = css.slice(css.lastIndexOf('@media (prefers-reduced-motion: reduce)'));

        expect(reducedMotion).toContain('.listener-field__aurora');
        expect(reducedMotion).toContain('.listener-field__orbit');
        expect(reducedMotion).toContain('.listener-field__core');
        expect(reducedMotion).toContain('.listener-field__point { animation: none; }');
    });

    it('bounds the altar at 320/390 mobile and 768–1440 desktop widths', () => {
        const css = readFileSync('src/app/globals.css', 'utf8');
        const mobile = css.slice(
            css.indexOf('@media (max-width: 760px)'),
            css.indexOf('@media (max-width: 360px)'),
        );
        const narrowStart = css.indexOf('@media (max-width: 360px)');
        const narrow = css.slice(
            narrowStart,
            css.indexOf('@media (prefers-reduced-motion: reduce)', narrowStart),
        );

        expect(css).toContain('width: min(100%, 90rem);');
        expect(css).toContain('width: min(100%, 46rem);');
        expect(css).toContain('width: min(100%, 42rem);');
        expect(mobile).toContain('min-height: 48px;');
        expect(mobile).not.toContain('position: sticky;');
        expect(narrow).toContain('padding-inline: 0.65rem;');
        expect(css).not.toContain('.listener-account__menu');
        expect(css).not.toContain('.listener-account > summary');
        expect(css).toMatch(/\.listener-details input\[type='range'\][\s\S]*?min-height: 2\.75rem;/);
        expect(css).toMatch(/\.listener-quota a[\s\S]*?min-height: 2\.75rem;/);
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

    it('weekly quota uses only listener-scoped presentation classes', () => {
        render(
            <LocaleProvider initialLocale="en">
                <FreeQuotaStatus
                    serverNow="2026-08-07T15:00:00.000Z"
                    snapshot={{
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
        expect(screen.getByText('You have 3h left this week').parentElement)
            .toHaveClass('listener-quota');
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
        expect(screen.getByRole('link', { name: 'Sign in or create an account' }))
            .toHaveClass('listener-button', 'listener-button--secondary');
        expect(anonymous.container.innerHTML).not.toMatch(EVENT_VISUAL_CLASS);
        // Identity providers remain equivalent and do not compete with a product action.
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
