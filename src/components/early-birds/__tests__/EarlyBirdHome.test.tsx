// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

vi.mock('../ListenerPlayer', () => ({
    default: ({ reactiveVisualizationAvailable }: { reactiveVisualizationAvailable?: boolean }) => (
        <section
            aria-label="listener-player"
            data-reactive-available={String(Boolean(reactiveVisualizationAvailable))}
        />
    ),
}));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: vi.fn() }),
}));
import EarlyBirdHome from '../EarlyBirdHome';

afterEach(cleanup);

describe('EarlyBird Listener home access chrome', () => {
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
        view.rerender(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    reactiveVisualizationAvailable
                    displayName="Nico"
                    membership={{ kind: 'invitation', state: 'active' }}
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByLabelText('listener-player')).toHaveAttribute('data-reactive-available', 'true');
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

        expect(screen.getByText('Founder · active until the end of the period')).toBeInTheDocument();
        expect(screen.getByText('Mercado Pago')).toBeInTheDocument();
        expect(screen.queryByText('MERCADO_PAGO')).not.toBeInTheDocument();
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
});
