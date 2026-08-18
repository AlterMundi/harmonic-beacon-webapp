// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AccountClient, { completeFrontchannelLogout } from '../AccountClient';

describe('Account cross-product logout completion', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
        cleanup();
        document.body.replaceChildren();
    });

    it('waits for every RP load/error and removes the isolated frames', async () => {
        const completion = completeFrontchannelLogout([
            'https://listen.harmonicbeacon.com/api/account/frontchannel-logout',
            'https://live.harmonicbeacon.com/api/account/frontchannel-logout',
        ], document, 5_000);
        const frames = [...document.querySelectorAll('iframe')];
        expect(frames).toHaveLength(2);
        expect(frames.every((frame) => frame.referrerPolicy === 'no-referrer')).toBe(true);
        expect(frames.every((frame) => frame.hasAttribute('sandbox'))).toBe(true);
        frames[0].dispatchEvent(new Event('load'));
        let settled = false;
        void completion.then(() => { settled = true; });
        await Promise.resolve();
        expect(settled).toBe(false);
        frames[1].dispatchEvent(new Event('error'));
        await completion;
        expect(document.querySelectorAll('iframe')).toHaveLength(0);
    });

    it('uses a bounded timeout if an RP never completes', async () => {
        vi.useFakeTimers();
        const completion = completeFrontchannelLogout([
            'https://listen.harmonicbeacon.com/api/account/frontchannel-logout',
        ], document, 5_000);
        await vi.advanceTimersByTimeAsync(5_000);
        await completion;
        expect(document.querySelectorAll('iframe')).toHaveLength(0);
    });

    it('sends the rendered explicit locale instead of inferring document language', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
        vi.stubGlobal('fetch', fetchMock);
        document.documentElement.lang = 'es';
        render(createElement(AccountClient, {
            initialSession: null,
            providers: { google: false, apple: false },
            locale: 'en',
            returnTo: null,
        }));
        fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
        fireEvent.change(screen.getByRole('textbox', { name: 'Email' }), {
            target: { value: 'listener@example.invalid' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Send reset email' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'X-HB-Locale': 'en' });
    });

    it.each([
        ['en' as const, 'Use 8 to 128 characters. No special format is required.'],
        ['es' as const, 'Usá entre 8 y 128 caracteres. No se exige ningún formato especial.'],
    ])('renders the provider-independent %s signup policy without complexity rules', (locale, hint) => {
        render(createElement(AccountClient, {
            initialSession: null,
            providers: { google: false, apple: false },
            locale,
            returnTo: null,
        }));
        fireEvent.click(screen.getAllByRole('button', {
            name: locale === 'es' ? 'Crear cuenta' : 'Create account',
        })[0]);
        const password = screen.getByLabelText(locale === 'es' ? 'Contraseña' : 'Password');
        expect(password).toHaveAttribute('minlength', '8');
        expect(password).toHaveAttribute('maxlength', '128');
        expect(password).toHaveAccessibleDescription(hint);
    });

    it('rejects a seven-character signup visibly before fetch and focuses the password', () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        render(createElement(AccountClient, {
            initialSession: null,
            providers: { google: false, apple: false },
            locale: 'en',
            returnTo: null,
        }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Create account' })[0]);
        const password = screen.getByLabelText('Password');
        fireEvent.change(password, { target: { value: '1234567' } });
        fireEvent.submit(password.closest('form')!);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Password must be 8 to 128 characters.');
        expect(password).toHaveFocus();
    });

    it('blocks mismatched repeated passwords and exposes an accessible reveal control', () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        render(createElement(AccountClient, {
            initialSession: null,
            providers: { google: false, apple: false },
            locale: 'en',
            returnTo: null,
        }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Create account' })[0]);
        const password = screen.getByLabelText('Password');
        const repeated = screen.getByLabelText('Repeat password');
        fireEvent.change(password, { target: { value: '12345678' } });
        fireEvent.change(repeated, { target: { value: '87654321' } });
        const reveal = screen.getAllByRole('button', { name: 'Show password' })[0];
        expect(reveal).toHaveTextContent('');
        expect(reveal.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
        fireEvent.click(reveal);
        expect(password).toHaveAttribute('type', 'text');
        const conceal = screen.getByRole('button', { name: 'Hide password' });
        expect(conceal).toHaveAttribute('aria-pressed', 'true');
        expect(conceal).toHaveTextContent('');
        fireEvent.submit(password.closest('form')!);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Passwords do not match.');
        expect(repeated).toHaveFocus();
    });

    it.each([
        ['en' as const, 'Confirm your email', 'We sent you an email. Confirm your address to activate the account, then sign in.', 'Go to sign in'],
        ['es' as const, 'Confirmá tu correo', 'Te enviamos un correo. Confirmá tu dirección para activar la cuenta y después ingresá.', 'Ir al ingreso'],
    ])('submits an eight-character %s signup and replaces the form with focused confirmation', async (
        locale, heading, copy, returnLabel,
    ) => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('{"status":"accepted"}', {
            status: 202, headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        render(createElement(AccountClient, {
            initialSession: null,
            providers: { google: false, apple: false },
            locale,
            returnTo: null,
        }));
        const createLabel = locale === 'es' ? 'Crear cuenta' : 'Create account';
        fireEvent.click(screen.getAllByRole('button', { name: createLabel })[0]);
        fireEvent.change(screen.getByLabelText(locale === 'es' ? 'Nombre visible' : 'Display name'), { target: { value: 'Test Listener' } });
        fireEvent.change(screen.getByLabelText(locale === 'es' ? 'Correo' : 'Email'), { target: { value: 'listener@example.invalid' } });
        const password = screen.getByLabelText(locale === 'es' ? 'Contraseña' : 'Password');
        fireEvent.change(password, { target: { value: '12345678' } });
        fireEvent.change(screen.getByLabelText(locale === 'es' ? 'Repetir contraseña' : 'Repeat password'), { target: { value: '12345678' } });
        fireEvent.submit(password.closest('form')!);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        const feedback = screen.getByRole('status');
        expect(feedback).toHaveTextContent(heading);
        expect(feedback).toHaveTextContent(copy);
        await waitFor(() => expect(feedback).toHaveFocus());
        expect(screen.queryByRole('button', { name: createLabel })).toBeNull();
        expect(screen.getByRole('button', { name: returnLabel })).toBeVisible();
        expect(document.body).not.toHaveTextContent('listener@example.invalid');
    });

    it('shows an enumeration-neutral server failure and always restores the submit button', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
            status: 400, headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        render(createElement(AccountClient, {
            initialSession: null,
            providers: { google: false, apple: false },
            locale: 'en',
            returnTo: null,
        }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Create account' })[0]);
        fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Test Listener' } });
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'listener@example.invalid' } });
        const password = screen.getByLabelText('Password');
        fireEvent.change(password, { target: { value: '12345678' } });
        fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: '12345678' } });
        fireEvent.submit(password.closest('form')!);
        const feedback = await screen.findByRole('status');
        await waitFor(() => expect(feedback).toHaveTextContent(
            'The request could not be completed. Check the details and try again.',
        ));
        expect(feedback).toHaveFocus();
        expect(screen.getAllByRole('button', { name: 'Create account' }).at(-1)).toBeEnabled();
        expect(screen.queryByText(/We sent you an email/)).toBeNull();
    });

    it.each([
        [200, '{"status":"accepted"}'],
        [202, '{"status":"unexpected"}'],
    ])('rejects malformed signup success status/body (%s) instead of showing a false confirmation', async (status, body) => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(body, {
            status, headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);
        render(createElement(AccountClient, {
            initialSession: null,
            providers: { google: false, apple: false },
            locale: 'en',
            returnTo: null,
        }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Create account' })[0]);
        fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Test Listener' } });
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'listener@example.invalid' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: '12345678' } });
        fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: '12345678' } });
        fireEvent.submit(screen.getByLabelText('Password').closest('form')!);
        const feedback = await screen.findByRole('status');
        await waitFor(() => expect(feedback).toHaveTextContent('The request could not be completed.'));
        expect(screen.queryByRole('heading', { name: 'Confirm your email' })).toBeNull();
    });

    it('coalesces duplicate credential submits while the first request is pending', async () => {
        let resolveFetch!: (response: Response) => void;
        const fetchMock = vi.fn().mockReturnValue(new Promise<Response>((resolve) => {
            resolveFetch = resolve;
        }));
        vi.stubGlobal('fetch', fetchMock);
        render(createElement(AccountClient, {
            initialSession: null,
            providers: { google: false, apple: false },
            locale: 'en',
            returnTo: null,
        }));
        fireEvent.click(screen.getAllByRole('button', { name: 'Create account' })[0]);
        fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Test Listener' } });
        fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'listener@example.invalid' } });
        const password = screen.getByLabelText('Password');
        fireEvent.change(password, { target: { value: '12345678' } });
        fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: '12345678' } });
        const form = password.closest('form')!;
        fireEvent.submit(form);
        fireEvent.submit(form);
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(screen.getByRole('status')).toHaveTextContent('Creating your account…');
        expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
        resolveFetch(new Response('{"status":"accepted"}', {
            status: 202, headers: { 'Content-Type': 'application/json' },
        }));
        await screen.findByRole('heading', { name: 'Confirm your email' });
        expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
        expect(fetchMock).toHaveBeenCalledOnce();
        fireEvent.click(screen.getByRole('button', { name: 'Go to sign in' }));
        expect(screen.getAllByRole('button', { name: 'Sign in' })).toHaveLength(2);
    });

    it('blocks a signed-in password change when the repeated value differs', () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        render(createElement(AccountClient, {
            initialSession: {
                user: { email: 'listener@example.invalid', emailVerified: true, accessMethod: 'email' },
                profile: { displayName: 'Test Listener', revision: 1 },
            },
            providers: { google: false, apple: false },
            locale: 'en',
            returnTo: null,
        }));
        fireEvent.change(screen.getAllByLabelText('Current password')[0], {
            target: { value: 'old-password' },
        });
        const password = screen.getByLabelText('New password');
        fireEvent.change(password, { target: { value: '12345678' } });
        fireEvent.change(screen.getByLabelText('Repeat new password'), {
            target: { value: '87654321' },
        });
        fireEvent.submit(password.closest('form')!);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Passwords do not match.');
    });
});
