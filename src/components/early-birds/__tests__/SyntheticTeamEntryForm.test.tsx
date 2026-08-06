// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

import SyntheticTeamEntryForm from '../SyntheticTeamEntryForm';

afterEach(() => {
    cleanup();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.unstubAllGlobals();
});

describe('EarlyBird staging team entry form', () => {
    it('renders the small synthetic-account form in both supported languages', () => {
        const { unmount } = render(
            <LocaleProvider initialLocale="es"><SyntheticTeamEntryForm /></LocaleProvider>,
        );
        expect(screen.getByText('Acceso de equipo · staging')).toBeInTheDocument();
        expect(screen.getByLabelText('Cuenta sintética')).toHaveAttribute('placeholder', 'name@e2e.invalid');
        unmount();

        render(<LocaleProvider initialLocale="en"><SyntheticTeamEntryForm /></LocaleProvider>);
        expect(screen.getByText('Team access · staging')).toBeInTheDocument();
        expect(screen.getByLabelText('Temporary access code')).toHaveAttribute('type', 'password');
    });

    it('sends the tester-entered bearer once and clears it without persistence', async () => {
        const accessCode = 'team-staging-access-code-0000000000000001';
        const request = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
        vi.stubGlobal('fetch', request);
        render(<LocaleProvider initialLocale="en"><SyntheticTeamEntryForm /></LocaleProvider>);

        await userEvent.type(screen.getByLabelText('Test name'), 'Team Listener');
        await userEvent.type(screen.getByLabelText('Synthetic account'), 'team.listener@e2e.invalid');
        await userEvent.type(screen.getByLabelText('Temporary access code'), accessCode);
        await userEvent.click(screen.getByRole('button', { name: 'Enter staging' }));

        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
        expect(request).toHaveBeenCalledOnce();
        const [url, init] = request.mock.calls[0] as [string, RequestInit];
        expect(url).toBe('/api/early-birds/test-login');
        expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
        expect(init.headers).toMatchObject({ authorization: `Bearer ${accessCode}` });
        expect(JSON.parse(String(init.body))).toEqual({
            name: 'Team Listener',
            email: 'team.listener@e2e.invalid',
            authOnly: false,
        });
        expect(screen.getByLabelText('Temporary access code')).toHaveValue('');
        expect(JSON.stringify(window.localStorage)).not.toContain(accessCode);
        expect(JSON.stringify(window.sessionStorage)).not.toContain(accessCode);
    });

    it('requests identity only when entering through a canonical Free invitation', async () => {
        const request = vi.fn().mockResolvedValue(new Response('{}', { status: 404 }));
        vi.stubGlobal('fetch', request);
        render(
            <LocaleProvider initialLocale="en">
                <SyntheticTeamEntryForm
                    authOnly
                    postLoginPath="/early-birds/redeem"
                />
            </LocaleProvider>,
        );

        await userEvent.type(screen.getByLabelText('Test name'), 'Free Listener');
        await userEvent.type(screen.getByLabelText('Synthetic account'), 'free.listener@e2e.invalid');
        await userEvent.type(screen.getByLabelText('Temporary access code'), 'team-staging-access-code-0000000000000001');
        await userEvent.click(screen.getByRole('button', { name: 'Enter staging' }));

        await waitFor(() => expect(request).toHaveBeenCalledOnce());
        const [, init] = request.mock.calls[0] as [string, RequestInit];
        expect(JSON.parse(String(init.body))).toMatchObject({ authOnly: true });
    });
});
