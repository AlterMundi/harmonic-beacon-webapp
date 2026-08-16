// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';
import ConsumerWithdrawalForm from '../ConsumerWithdrawalForm';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('Listener withdrawal form', () => {
    it.each([
        ['es', 'Puedes solicitar la revocación', 'Enviar solicitud'],
        ['en', 'You may request cancellation', 'Send request'],
    ] as const)('is public, bounded and accessible in %s', (locale, intro, submit) => {
        const { container } = render(<LocaleProvider initialLocale={locale}><ConsumerWithdrawalForm /></LocaleProvider>);
        expect(screen.getByRole('heading', { name: 'BOTÓN DE ARREPENTIMIENTO' })).toBeInTheDocument();
        expect(screen.getByText(new RegExp(intro))).toBeInTheDocument();
        expect(screen.getByLabelText(/Correo usado|Email used/)).toHaveAttribute('maxlength', '254');
        expect(screen.getByRole('button', { name: submit })).toHaveClass('listener-button--primary');
        expect(screen.queryByRole('button', { name: /Google|Apple|sign in|iniciar sesión/i })).not.toBeInTheDocument();
        expect(container.querySelector('input[type="password"]')).toBeNull();
        expect(container.querySelector('textarea')).toBeNull();
    });

    it('shows the immediate receipt and sends no login or provider identifier', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            receiptCode: 'HBW-1234567890ABCDEF1234567890ABCD',
            receivedAt: '2026-08-13T19:00:00.000Z',
        }), { status: 201, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        render(<LocaleProvider initialLocale="en"><ConsumerWithdrawalForm /></LocaleProvider>);

        await userEvent.type(screen.getByLabelText('Email used for the purchase'), 'buyer@example.com');
        await userEvent.click(screen.getByRole('button', { name: 'Send request' }));

        expect(await screen.findByRole('status')).toHaveTextContent('HBW-1234567890ABCDEF1234567890ABCD');
        const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(init.headers).toMatchObject({ 'X-Listener-Withdrawal-Intent': '1' });
        expect(String(init.body)).not.toContain('providerId');
        expect(String(init.body)).not.toContain('accountId');
        expect(String(init.body)).toContain('"requestKind":"WITHDRAWAL"');
    });

    it('shares the bounded queue while fixing service cancellation kind', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            receiptCode: 'HBW-1234567890ABCDEF1234567890ABCD',
            receivedAt: '2026-08-13T19:00:00.000Z',
        }), { status: 201, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        render(<LocaleProvider initialLocale="es"><ConsumerWithdrawalForm requestKind="SERVICE_CANCELLATION" /></LocaleProvider>);
        expect(screen.getByRole('heading', { name: 'BOTÓN DE BAJA DE SERVICIO' })).toBeInTheDocument();
        await userEvent.type(screen.getByLabelText('Correo usado para la compra'), 'buyer@example.com');
        await userEvent.click(screen.getByRole('button', { name: 'Enviar solicitud' }));
        expect(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))
            .toContain('"requestKind":"SERVICE_CANCELLATION"');
    });
});
