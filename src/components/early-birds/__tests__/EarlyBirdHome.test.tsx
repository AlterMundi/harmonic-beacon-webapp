// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

vi.mock('../ListenerPlayer', () => ({
    default: () => <section aria-label="listener-player" />,
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
                    membershipSource="FREE"
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByLabelText('Account')).toBeInTheDocument();
        expect(screen.getByText('Sign out')).toBeInTheDocument();
    });

    it('does not imply an account or expose sign-out in public mode', () => {
        render(
            <LocaleProvider initialLocale="en">
                <EarlyBirdHome
                    publicAccess
                    displayName=""
                    membershipSource={null}
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
                    membershipSource="FREE"
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
                    membershipSource="FREE"
                    dropIns={{ es: null, en: null }}
                />
            </LocaleProvider>,
        );

        expect(screen.getByTestId('listener-campfire')).toHaveAttribute('data-fixture', 'far');
        expect(screen.getByTestId('listener-campfire')).toHaveAttribute('aria-hidden', 'true');
    });
});
