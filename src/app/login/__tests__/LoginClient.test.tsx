// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '@/context/LocaleContext';

/**
 * The attendee form. What matters here is what an attendee is told and where
 * they land, in both languages: the room they paid for on success, and copy that
 * distinguishes "wrong details" from "we are rate limiting you" from "we are
 * broken" — without ever telling them which half of the pair was wrong.
 */

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

import LoginClient from '../LoginClient';

const CODE = 'HB26-A7NQ-92KM-4XZP';
const EMAIL = 'ana@example.com';
const NAME = 'Ana';

function mockFetch(response: { status: number; body?: unknown }) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => response.body ?? {},
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

async function fillAndSubmit() {
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/Name shown in the room/), NAME);
    await user.type(screen.getByLabelText(/Ticket code/), CODE);
    await user.type(screen.getByLabelText(/Email used to buy the ticket/), EMAIL);
    await user.click(screen.getByRole('button', { name: /Enter the event/ }));
}

function renderLogin(locale: 'es' | 'en' = 'en', next?: string) {
    window.localStorage.setItem('hb-locale', locale);
    return render(
        <LocaleProvider initialLocale={locale}>
            <LoginClient next={next} />
        </LocaleProvider>,
    );
}

describe('LoginClient', () => {
    beforeEach(() => {
        mockPush.mockClear();
        mockRefresh.mockClear();
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('sends the code and email and lands in the ticket’s own room', async () => {
        const fetchMock = mockFetch({ status: 200, body: { ok: true, scheduledSessionId: 'session-saturday' } });
        renderLogin();

        await fillAndSubmit();

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/auth/ticket');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({ name: NAME, code: CODE, email: EMAIL });

        await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/session/session-saturday'));
        // The cookie arrived on the response, so the cached router tree is stale.
        expect(mockRefresh).toHaveBeenCalled();
    });

    it('returns a reconnecting attendee to the room they were sent from', async () => {
        mockFetch({ status: 200, body: { ok: true, scheduledSessionId: 'session-saturday' } });
        renderLogin('en', '/session/session-sunday');

        await fillAndSubmit();

        await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/session/session-sunday'));
    });

    it('shows a localized message for any rejection', async () => {
        mockFetch({ status: 401, body: { error: 'server copy is not shown to the attendee' } });
        renderLogin();

        await fillAndSubmit();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/do not match an active ticket/);
        // Nothing about which of the two was wrong, and nothing from the server.
        expect(alert).not.toHaveTextContent(/server copy/);
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('tells a rate-limited attendee to wait rather than to check their details', async () => {
        mockFetch({ status: 429 });
        renderLogin();

        await fillAndSubmit();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/Too many attempts/);
    });

    it('distinguishes our outage from their mistake', async () => {
        mockFetch({ status: 500 });
        renderLogin();

        await fillAndSubmit();

        const alert = await screen.findByRole('alert');
        expect(alert).toHaveTextContent(/Sign-in is unavailable/);
    });

    it('reports a dropped connection instead of failing silently', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));
        renderLogin();

        await fillAndSubmit();

        expect(await screen.findByRole('alert')).toHaveTextContent(/Sign-in is unavailable/);
    });

    it('does not send a second request while the first is in flight', async () => {
        let release: (value: unknown) => void = () => {};
        const pending = new Promise((resolve) => {
            release = resolve;
        });
        const fetchMock = vi.fn().mockReturnValue(pending);
        vi.stubGlobal('fetch', fetchMock);
        renderLogin();

        await fillAndSubmit();
        const button = screen.getByRole('button');
        expect(button).toBeDisabled();

        release({ ok: true, status: 200, json: async () => ({ scheduledSessionId: 'session-saturday' }) });
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    });

    it('renders the selected language instead of both copies', async () => {
        mockFetch({ status: 200, body: { scheduledSessionId: 'session-saturday' } });
        const { unmount } = renderLogin('es');

        expect(screen.getByText('Código de entrada')).toBeInTheDocument();
        expect(screen.getByText('Nombre visible en la sala')).toBeInTheDocument();
        expect(screen.getByText('Correo con el que compraste la entrada')).toBeInTheDocument();
        expect(screen.getByText(/funcionan de nuevo si recargás/)).toBeInTheDocument();
        expect(screen.queryByText('Ticket code')).toBeNull();

        unmount();
        window.localStorage.setItem('hb-locale', 'en');
        renderLogin('en');
        expect(screen.getByText('Ticket code')).toBeInTheDocument();
        expect(screen.getByText(/work again after a refresh or a dropped/)).toBeInTheDocument();
    });

    it('shows the canonical long HB1 shape and leaves room for pasted separators', () => {
        renderLogin('en');

        expect(screen.getByLabelText('Ticket code')).toHaveAttribute(
            'placeholder',
            'HB1-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX',
        );
        expect(screen.getByLabelText('Ticket code')).toHaveAttribute('maxlength', '80');
    });

    it('keeps the Account profile name as an editable event alias and never asks for email', async () => {
        const fetchMock = mockFetch({
            status: 200,
            body: { ok: true, scheduledSessionId: 'session-saturday' },
        });
        window.localStorage.setItem('hb-locale', 'en');
        render(
            <LocaleProvider initialLocale="en">
                <LoginClient accountEnabled defaultDisplayName="Account profile" />
            </LocaleProvider>,
        );
        const user = userEvent.setup();
        const alias = screen.getByLabelText(/Name shown in the room/);
        expect(alias).toHaveValue('Account profile');
        await user.clear(alias);
        await user.type(alias, 'Event alias');
        await user.type(screen.getByLabelText(/Ticket code/), CODE);
        expect(screen.queryByLabelText(/Email used to buy the ticket/)).toBeNull();
        await user.click(screen.getByRole('button', { name: /Enter the event/ }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
            name: 'Event alias',
            code: CODE,
        });
    });
});
