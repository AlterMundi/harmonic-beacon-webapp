// @vitest-environment jsdom
import { cleanup, render as rtlRender, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import ThumbnailTapestry from '../ThumbnailTapestry';
import { LocaleProvider } from '@/context/LocaleContext';

function render(ui: ReactNode, initialLocale: 'es' | 'en' = 'en') {
    return rtlRender(ui, { wrapper: ({ children }) => <LocaleProvider initialLocale={initialLocale}>{children}</LocaleProvider> });
}

afterEach(() => cleanup());

describe('ThumbnailTapestry', () => {
    it('omits cookies when loading the public composite', async () => {
        URL.createObjectURL = vi.fn(() => 'blob:tapestry');
        URL.revokeObjectURL = vi.fn();
        global.fetch = vi.fn().mockResolvedValue(new Response(new Blob(['jpeg']), { status: 200 }));
        render(<ThumbnailTapestry sessionId="session-1" />);
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(vi.mocked(fetch).mock.calls[0][1]?.credentials).toBe('omit');
    });

    it('uses the selected staff locale while preserving authenticated loading', async () => {
        global.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 404 }));

        const view = render(<ThumbnailTapestry sessionId="session-1" staffOnly />, 'es');

        expect(view.getByRole('region', { name: 'Tapiz' })).toBeInTheDocument();
        expect(view.getByText('Esperando imágenes.')).toBeInTheDocument();
        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(vi.mocked(fetch).mock.calls[0][1]?.credentials).toBe('same-origin');
        // Staff tools keep their original fetch contract: no hand sidecar.
        expect(vi.mocked(fetch).mock.calls.some(([input]) =>
            String(input).includes('/tapestry/hands'),
        )).toBe(false);
    });

    it('names raised hands from the authorized sidecar, never from the JPEG', async () => {
        URL.createObjectURL = vi.fn(() => 'blob:tapestry');
        URL.revokeObjectURL = vi.fn();
        global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tapestry/hands')) {
                return new Response(JSON.stringify({
                    hands: [{ name: 'Ana' }, { name: 'Beto' }],
                    liveStateAvailable: true,
                }), { status: 200 });
            }
            return new Response(new Blob(['jpeg']), { status: 200 });
        });

        const view = render(<ThumbnailTapestry sessionId="session-1" />);

        expect(await view.findByText('Raised hands: Ana, Beto')).toBeInTheDocument();
        const handsCall = vi.mocked(fetch).mock.calls.find(([input]) =>
            String(input).includes('/tapestry/hands'),
        );
        // The sidecar is cookie-authorized even on the public surface.
        expect(handsCall?.[1]?.credentials).toBe('same-origin');
    });

    it('stays silent when the hand list is rejected or empty', async () => {
        global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tapestry/hands')) {
                return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403 });
            }
            return new Response(new Blob(['jpeg']), { status: 200 });
        });

        const view = render(<ThumbnailTapestry sessionId="session-1" />);

        await waitFor(() => expect(fetch).toHaveBeenCalled());
        expect(view.queryByText(/Raised hands:/)).not.toBeInTheDocument();
    });
});
