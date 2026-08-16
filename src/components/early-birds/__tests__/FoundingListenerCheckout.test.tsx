// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

import FoundingListenerCheckout from '../FoundingListenerCheckout';

const attemptId = '123e4567-e89b-42d3-a456-426614174000';

beforeEach(() => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(attemptId);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Founding Listener sandbox checkout', () => {
    it('renders nothing while every provider is disabled', () => {
        const { container } = render(
            <LocaleProvider initialLocale="en">
                <FoundingListenerCheckout available={{ paypal: false, mercadoPago: false }} />
            </LocaleProvider>,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('sends only provider and a stable retry id without identity or price fields', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(
            JSON.stringify({ error: 'Checkout unavailable.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
        ));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <FoundingListenerCheckout available={{ paypal: true, mercadoPago: false }} />
            </LocaleProvider>,
        );

        fireEvent.click(screen.getByText('Become a member for full access'));
        fireEvent.click(screen.getByRole('button', { name: 'Continue with PayPal' }));
        await screen.findByRole('alert');
        fireEvent.click(screen.getByRole('button', { name: 'Continue with PayPal' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

        const first = JSON.parse(fetchMock.mock.calls[0][1].body) as Record<string, unknown>;
        const second = JSON.parse(fetchMock.mock.calls[1][1].body) as Record<string, unknown>;
        expect(first).toEqual({ provider: 'paypal', attemptId });
        expect(second).toEqual(first);
        expect(JSON.stringify(first)).not.toMatch(/email|account|price|currency/i);
    });
});
