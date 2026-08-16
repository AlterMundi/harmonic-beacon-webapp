// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

import FoundingListenerLiveWorkbench from '../FoundingListenerLiveWorkbench';

const attemptId = '123e4567-e89b-42d3-a456-426614174000';

beforeEach(() => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(attemptId);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('Founding Listener private Live workbench', () => {
    it('renders nothing unless the server supplied an allowlisted configuration', () => {
        const { container } = render(
            <LocaleProvider initialLocale="en">
                <FoundingListenerLiveWorkbench config={null} />
            </LocaleProvider>,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it('sends only an attempt and CSRF proof to the separate endpoint', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response(
            JSON.stringify({ error: 'Checkout unavailable.' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } },
        ));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <FoundingListenerLiveWorkbench config={{
                    provider: 'mercado_pago',
                    csrfToken: 'browser-csrf-proof',
                }} />
            </LocaleProvider>,
        );

        fireEvent.click(screen.getByText('Become a member for full access'));
        fireEvent.click(screen.getByRole('button', { name: 'Continue with Mercado Pago' }));
        await screen.findByRole('alert');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, init] = fetchMock.mock.calls[0];
        expect(fetchMock.mock.calls[0][0]).toBe('/api/listener/checkout/live-workbench');
        expect(JSON.parse(init.body)).toEqual({ attemptId });
        expect(init.headers).toEqual(expect.objectContaining({
            'x-hb-listener-live-csrf': 'browser-csrf-proof',
        }));
        expect(JSON.stringify({ url: fetchMock.mock.calls[0][0], init })).not.toMatch(
            /opaque-account|listener@example|provider.*mercado_pago/i,
        );
    });
});
