// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResetPasswordClient } from '../ResetPasswordClient';

describe('Account reset-password policy', () => {
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        window.history.replaceState(null, '', '/');
    });

    it.each([
        ['en' as const, 'New password', 'Use 8 to 128 characters. No special format is required.'],
        ['es' as const, 'Contraseña nueva', 'Usá entre 8 y 128 caracteres. No se exige ningún formato especial.'],
    ])('renders the %s policy from the shared bounds', async (locale, label, hint) => {
        window.history.replaceState(null, '', '/reset-password?token=opaque-test-token');
        render(<ResetPasswordClient locale={locale} />);
        const password = await waitFor(() => screen.getByLabelText(label));
        expect(password).toHaveAttribute('minlength', '8');
        expect(password).toHaveAttribute('maxlength', '128');
        expect(password).toHaveAccessibleDescription(hint);
        expect(window.location.search).toBe('');
    });

    it('blocks a repeated-password mismatch before the reset endpoint', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        window.history.replaceState(null, '', '/reset-password?token=opaque-test-token');
        render(<ResetPasswordClient locale="en" />);
        const password = await waitFor(() => screen.getByLabelText('New password'));
        fireEvent.change(password, { target: { value: '12345678' } });
        fireEvent.change(screen.getByLabelText('Repeat new password'), {
            target: { value: '87654321' },
        });
        fireEvent.submit(password.closest('form')!);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(screen.getByRole('status')).toHaveTextContent('Passwords do not match.');
    });

    it('keeps the token form retryable after a network failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network unavailable')));
        window.history.replaceState(null, '', '/reset-password?token=opaque-test-token');
        render(<ResetPasswordClient locale="en" />);
        const password = await waitFor(() => screen.getByLabelText('New password'));
        fireEvent.change(password, { target: { value: '12345678' } });
        fireEvent.change(screen.getByLabelText('Repeat new password'), {
            target: { value: '12345678' },
        });
        fireEvent.submit(password.closest('form')!);
        expect(await screen.findByRole('status')).toHaveTextContent(
            'The request could not be completed. Try again.',
        );
        expect(screen.getByLabelText('New password')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Change password' })).toBeEnabled();
    });
});
