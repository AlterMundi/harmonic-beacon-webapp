// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '@/context/LocaleContext';

/**
 * Staff sign-in. Two things are worth asserting: the page resolves an existing
 * session authoritatively rather than trusting the cookie's presence, and the
 * form never reports which half of a credential was wrong.
 */

vi.mock('next/link', () => ({
    default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

// Hoisted: the page under test imports this module at module-evaluation time,
// which is before a plain `const` in this file would be initialized.
const { currentPrincipal } = vi.hoisted(() => ({ currentPrincipal: vi.fn() }));
vi.mock('@/lib/auth', () => ({ currentPrincipal }));
vi.mock('@/lib/i18n-server', () => ({ requestLocale: vi.fn().mockResolvedValue('en') }));
vi.mock('@/components/brand/LanguageControl', () => ({ default: () => <div data-testid="language-control" /> }));

import StaffLoginPage from '../page';
import StaffLoginClient from '../StaffLoginClient';

function mockFetch(status: number, body: unknown = {}) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

async function renderPage() {
    render(
        <LocaleProvider initialLocale="en">
            {await StaffLoginPage()}
        </LocaleProvider>,
    );
}

function renderClient() {
    window.localStorage.setItem('hb-locale', 'en');
    return render(
        <LocaleProvider initialLocale="en">
            <StaffLoginClient />
        </LocaleProvider>,
    );
}

describe('staff login page', () => {
    beforeEach(() => {
        currentPrincipal.mockReset();
        mockPush.mockClear();
        mockRefresh.mockClear();
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('shows the credential form to a visitor with no session', async () => {
        currentPrincipal.mockResolvedValue(null);
        await renderPage();

        expect(screen.getByLabelText('Staff email')).toBeInTheDocument();
        expect(screen.getByLabelText('Password')).toBeInTheDocument();
    });

    it('shows the form again to an attendee who reaches the staff page', async () => {
        currentPrincipal.mockResolvedValue({ kind: 'attendee', entitlementId: 'ticket-1' });
        await renderPage();

        expect(screen.getByLabelText('Staff email')).toBeInTheDocument();
        expect(screen.queryByText(/Signed in as/)).toBeNull();
    });

    it('names the resolved role for a signed-in operator', async () => {
        currentPrincipal.mockResolvedValue({ kind: 'staff', role: 'OPERATOR', userId: 'user-2' });
        await renderPage();

        expect(screen.getByText(/Signed in as/)).toBeInTheDocument();
        expect(screen.getByText('OPERATOR')).toBeInTheDocument();
        expect(screen.getByRole('link', { name: /event controls/ })).toHaveAttribute('href', '/ops/health');
        expect(screen.queryByLabelText('Password')).toBeNull();
    });

    it('falls back to the form rather than erroring when the session cannot be resolved', async () => {
        currentPrincipal.mockRejectedValue(new Error('connection refused'));
        await renderPage();

        expect(screen.getByLabelText('Staff email')).toBeInTheDocument();
    });
});

describe('StaffLoginClient', () => {
    beforeEach(() => {
        mockPush.mockClear();
        mockRefresh.mockClear();
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    async function signIn() {
        const user = userEvent.setup();
        await user.type(screen.getByLabelText('Staff email'), 'admin@example.invalid');
        await user.type(screen.getByLabelText('Password'), 'weekend-passphrase');
        await user.click(screen.getByRole('button', { name: 'Sign in' }));
    }

    it('posts the credential and goes to the operator controls', async () => {
        const fetchMock = mockFetch(200, { ok: true, role: 'ADMIN' });
        renderClient();

        await signIn();

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/auth/staff');
        expect(JSON.parse(init.body)).toEqual({
            email: 'admin@example.invalid',
            password: 'weekend-passphrase',
        });

        await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/ops/health'));
        expect(mockRefresh).toHaveBeenCalled();
        // The password does not stay in the DOM after it has been used.
        expect(screen.getByLabelText('Password')).toHaveValue('');
    });

    it('does not say which half of the credential was wrong', async () => {
        mockFetch(401, { error: 'Those credentials are not valid.' });
        renderClient();

        await signIn();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent('Those credentials are not valid.');
        expect(alert).not.toHaveTextContent(/password|account|disabled/i);
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('reports rate limiting and outages distinctly', async () => {
        mockFetch(429);
        const { unmount } = renderClient();
        await signIn();
        expect(await screen.findByRole('alert')).toHaveTextContent(/Too many attempts/);
        unmount();

        mockFetch(503);
        renderClient();
        await signIn();
        expect(await screen.findByRole('alert')).toHaveTextContent(/unavailable/);
    });
});
