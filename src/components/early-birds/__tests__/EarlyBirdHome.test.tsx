// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

vi.mock('@/lib/early-birds/auth-client', () => ({
    clearListenerOAuthAttempt: vi.fn(),
}));

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

const quota = {
    policy: 'personal-7-day-v1' as const,
    status: 'available' as const,
    cycleStartedAt: '2026-08-07T15:00:00.000Z',
    cycleEndsAt: '2026-08-14T15:00:00.000Z',
    baseAllowanceMs: 10_800_000,
    bonusAllowanceMs: 0,
    consumedMs: 0,
    remainingMs: 10_800_000,
    activelyConsuming: false,
    exhaustsAt: null,
    nextCycleAt: '2026-08-14T15:00:00.000Z',
};

afterEach(() => cleanup());

describe('EarlyBird Listener home access chrome', () => {
    it('keeps membership, payment, provider and identity controls out of the player', () => {
        const { container } = render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        expect(screen.getByLabelText('listener-player')).toBeInTheDocument();
        expect(container.querySelector('.listener-home-membership-status')).toBeNull();
        expect(container.querySelector('.listener-membership-actions')).toBeNull();
        expect(container.querySelector('.listener-checkout')).toBeNull();
        expect(screen.queryByText(/Founding Listener|PayPal|Mercado Pago|USD 5/i)).toBeNull();
        expect(screen.queryByRole('button', { name: /cancel membership/i })).toBeNull();
        expect(document.querySelector('a[href^="mailto:"]')).toBeNull();
    });

    it('keeps only the compact Free listening allowance below the player', () => {
        render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    accessKind="free-quota"
                    serverNow="2026-08-07T15:00:00.000Z"
                    quota={quota}
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        const footer = screen.getByText('You have 3h left this week').closest('footer');
        expect(footer).toHaveClass('listener-listening-status');
        expect(footer?.querySelector('.listener-quota--compact')).not.toBeNull();
        expect(footer?.querySelector('a, button, details')).toBeNull();
        expect(footer).not.toHaveTextContent('Membership is not available');
    });

    it('hydrates without adding a membership disclosure to the listening surface', async () => {
        const tree = (
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome dropIns={{ es: null, en: null }} />
            </LocaleProvider>
        );
        const container = document.createElement('div');
        container.innerHTML = renderToString(tree);
        document.body.append(container);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

        let root!: ReturnType<typeof hydrateRoot>;
        await act(async () => { root = hydrateRoot(container, tree); });

        expect(consoleError.mock.calls.flat().join(' ')).not.toMatch(/hydration|didn't match/i);
        expect(container.querySelector('.listener-checkout, .listener-membership-actions')).toBeNull();
        await act(async () => root.unmount());
        consoleError.mockRestore();
        container.remove();
    });

    it('leaves the global brand and user menu to the shared layout', () => {
        const { container } = render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        expect(screen.queryByRole('link', { name: 'Harmonic Beacon' })).toBeNull();
        expect(screen.queryByText('Sign out')).toBeNull();
        expect(screen.queryByLabelText('Account')).toBeNull();
        expect(container.querySelector('.listener-altar')).toContainElement(
            screen.getByLabelText('listener-player'),
        );
    });

    it('does not imply an account in public mode', () => {
        render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome publicAccess dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        expect(screen.getByText('Open access')).toBeInTheDocument();
        expect(screen.queryByText('Sign out')).toBeNull();
        expect(screen.getByLabelText('listener-player')).toBeInTheDocument();
    });

    it('passes the reactive experiment capability only to the isolated player', () => {
        const view = render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );
        expect(screen.getByLabelText('listener-player')).toHaveAttribute('data-reactive-available', 'false');
        expect(screen.getByLabelText('listener-player')).toHaveAttribute('data-reactive-initially-enabled', 'false');

        view.rerender(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    reactiveVisualizationAvailable
                    reactiveFieldLabAvailable
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );
        expect(screen.getByLabelText('listener-player')).toHaveAttribute('data-reactive-available', 'true');
        expect(screen.getByLabelText('listener-player')).toHaveAttribute('data-reactive-lab', 'true');
    });
});
