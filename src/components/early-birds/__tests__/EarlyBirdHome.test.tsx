// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

vi.mock('../ListenerPlayer', () => ({
    default: () => <section aria-label="listener-player" />,
}));
vi.mock('next/navigation', () => ({
    useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock('../CosmicCampfire', () => ({
    default: ({ fixture }: { fixture: string }) => (
        <div data-testid="listener-campfire" data-fixture={fixture} aria-hidden="true" />
    ),
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

    it('keeps the campfire prototype absent unless its exact server flag is passed', () => {
        const view = render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    displayName="Nico"
                    membership={{ kind: 'invitation', state: 'active' }}
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        expect(screen.queryByTestId('listener-campfire')).not.toBeInTheDocument();
        view.rerender(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    campfirePrototype
                    campfireFixture="far"
                    displayName="Nico"
                    membership={{ kind: 'invitation', state: 'active' }}
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByTestId('listener-campfire')).toHaveAttribute('data-fixture', 'far');
        expect(screen.getByTestId('listener-campfire')).toHaveAttribute('aria-hidden', 'true');
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
});
