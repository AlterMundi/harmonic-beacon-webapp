// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

vi.mock('../ListenerPlayer', () => ({
    default: ({
        reactiveVisualizationAvailable,
        reactiveVisualizationInitiallyEnabled,
        reactiveFieldLabAvailable,
    }: {
        reactiveVisualizationAvailable?: boolean;
        reactiveVisualizationInitiallyEnabled?: boolean;
        reactiveFieldLabAvailable?: boolean;
    }) => (
        <section
            aria-label="listener-player"
            data-reactive-available={String(Boolean(reactiveVisualizationAvailable))}
            data-reactive-initially-enabled={String(Boolean(reactiveVisualizationInitiallyEnabled))}
            data-reactive-lab={String(Boolean(reactiveFieldLabAvailable))}
        />
    ),
}));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: vi.fn() }),
}));
import EarlyBirdHome from '../EarlyBirdHome';

afterEach(cleanup);

describe('EarlyBird Listener home access chrome', () => {
    it('tolerates browser-restored profile disclosure state during hydration', async () => {
        const tree = (
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    displayName="Nico"
                    membership={{ kind: 'invitation', state: 'active' }}
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>
        );
        const container = document.createElement('div');
        container.innerHTML = renderToString(tree);
        document.body.append(container);
        const disclosure = container.querySelector('details.listener-account');
        expect(disclosure).toBeInstanceOf(HTMLDetailsElement);
        (disclosure as HTMLDetailsElement).open = true;
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        let root!: ReturnType<typeof hydrateRoot>;
        await act(async () => {
            root = hydrateRoot(container, tree);
        });

        expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/hydration|didn't match/i);
        await act(async () => root.unmount());
        consoleError.mockRestore();
        container.remove();
    });

    it('uses the canonical public brand link without exposing the Reactive Lab', () => {
        render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    displayName="Nico"
                    membership={{ kind: 'invitation', state: 'active' }}
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByRole('link', { name: 'Harmonic Beacon' }))
            .toHaveAttribute('href', 'https://harmonicbeacon.com/');
        expect(document.querySelector('.hb-brand__mark path')).toBeInTheDocument();
        expect(screen.getByLabelText('listener-player'))
            .toHaveAttribute('data-reactive-initially-enabled', 'false');
    });

    it('labels a canonically active paid membership as Founding Listener', () => {
        render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    displayName="Nico"
                    membership={{ kind: 'founder', provider: 'paypal', state: 'active' }}
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByText('Founding Listener · USD 5/month')).toBeInTheDocument();
        expect(screen.queryByText('Preview access')).not.toBeInTheDocument();
    });

    it('keeps account controls for a membership-backed Listener', () => {
        render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    displayName="Nico"
                    membership={{ kind: 'invitation', state: 'active' }}
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByLabelText('Account')).toBeInTheDocument();
        expect(screen.getByText('Sign out')).toBeInTheDocument();
        expect(screen.getByText('Invitation access')).toBeInTheDocument();
        expect(screen.queryByText('FREE')).not.toBeInTheDocument();
    });

    it('does not imply an account or expose sign-out in public mode', () => {
        render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    publicAccess
                    displayName=""
                    membership={{ kind: 'none', state: 'none' }}
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        expect(screen.queryByLabelText('Account')).not.toBeInTheDocument();
        expect(screen.queryByText('Sign out')).not.toBeInTheDocument();
        expect(screen.queryByRole('group', { name: /language|idioma/i })).not.toBeInTheDocument();
        expect(screen.getByLabelText('listener-player')).toBeInTheDocument();
        expect(screen.getByTestId('listener-static-field')).toBeInTheDocument();
    });

    it('passes the reactive experiment capability only to the isolated player', () => {
        const view = render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    displayName="Nico"
                    membership={{ kind: 'invitation', state: 'active' }}
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByLabelText('listener-player')).toHaveAttribute('data-reactive-available', 'false');
        expect(screen.getByLabelText('listener-player')).toHaveAttribute('data-reactive-initially-enabled', 'false');
        view.rerender(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    reactiveVisualizationAvailable
                    reactiveFieldLabAvailable
                    displayName="Nico"
                    membership={{ kind: 'invitation', state: 'active' }}
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByLabelText('listener-player')).toHaveAttribute('data-reactive-available', 'true');
        expect(screen.getByLabelText('listener-player')).toHaveAttribute('data-reactive-initially-enabled', 'false');
        expect(screen.getByLabelText('listener-player')).toHaveAttribute('data-reactive-lab', 'true');
    });

    it('presents a normalized Founder status and provider without raw membership source', () => {
        render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    displayName="Nico"
                    membership={{ kind: 'founder', provider: 'mercado-pago', state: 'ending' }}
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByText('Founding Listener · USD 5/month · active through period end')).toBeInTheDocument();
        expect(screen.getByText('Mercado Pago')).toBeInTheDocument();
        expect(screen.queryByText('MERCADO_PAGO')).not.toBeInTheDocument();
    });

    it('shows a terminal paid status while keeping the account on Free access', () => {
        render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    displayName="Nico"
                    membership={{ kind: 'paid-status', provider: 'paypal', state: 'refunded' }}
                    accessKind="free-quota"
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByText('The payment was refunded and Founder access has ended.')).toBeInTheDocument();
        expect(screen.getByText('You can continue with the Free listening available to your account.')).toBeInTheDocument();
        expect(screen.queryByText('Founder access')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Cancel membership' })).not.toBeInTheDocument();
    });

    it('places Free allowance and membership action below the listening surface', () => {
        render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    displayName="Nico"
                    membership={{ kind: 'none', state: 'none' }}
                    accessKind="free-quota"
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
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        const footer = screen.getByText('You have 3h left this week').closest('footer');
        expect(footer).toHaveClass('listener-listening-status');
        expect(footer).toContainElement(screen.getByRole('link', { name: 'Become a member for full access' }));
        expect(screen.getByLabelText('Account').closest('header')).not.toContainElement(footer);
    });

    it('replaces the mail contact fallback with the private checkout action', () => {
        render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    displayName="Nico"
                    membership={{ kind: 'none', state: 'none' }}
                    accessKind="free-quota"
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
                    dropIns={{ es: null, en: null }}
                    liveWorkbench={{ provider: 'mercado_pago', csrfToken: 'csrf-proof' }}
                />
            </LocaleProvider>,
        );

        expect(screen.queryByRole('link', { name: 'Become a member for full access' })).toBeNull();
        expect(document.querySelector('details[data-listener-live-workbench="private"]'))
            .toHaveTextContent('Become a member for full access');
        expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    });
});
