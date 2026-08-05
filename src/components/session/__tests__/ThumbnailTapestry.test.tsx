// @vitest-environment jsdom
import { act, cleanup, render as rtlRender, waitFor } from '@testing-library/react';
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
                    hands: [{ name: 'Ana', column: null, row: null }, { name: 'Beto', column: null, row: null }],
                    liveStateAvailable: true,
                    layout: null,
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

    it('draws each name over its own tile when composite and layout revisions match', async () => {
        URL.createObjectURL = vi.fn(() => 'blob:tapestry');
        URL.revokeObjectURL = vi.fn();
        global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tapestry/hands')) {
                return new Response(JSON.stringify({
                    hands: [{ name: 'Ana', column: 1, row: 0 }],
                    liveStateAvailable: true,
                    layout: { revision: 7, columns: 2, rows: 1, tileSizePx: 100 },
                }), { status: 200 });
            }
            return new Response(new Blob(['jpeg']), {
                status: 200,
                headers: { 'x-tapestry-revision': '7' },
            });
        });

        const view = render(<ThumbnailTapestry sessionId="session-1" />);

        const tag = await view.findByText('Ana', { selector: 'span' });
        expect(tag).toHaveStyle({ left: '50%', top: '100%' });
        // The visual overlay never double-announces: the names line carries
        // the accessible form.
        expect(tag.closest('[aria-hidden="true"]')).not.toBeNull();
    });

    it('omits the overlay when the revisions disagree rather than misplacing a name', async () => {
        URL.createObjectURL = vi.fn(() => 'blob:tapestry');
        URL.revokeObjectURL = vi.fn();
        global.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tapestry/hands')) {
                return new Response(JSON.stringify({
                    hands: [{ name: 'Ana', column: 1, row: 0 }],
                    liveStateAvailable: true,
                    layout: { revision: 8, columns: 2, rows: 1, tileSizePx: 100 },
                }), { status: 200 });
            }
            return new Response(new Blob(['jpeg']), {
                status: 200,
                headers: { 'x-tapestry-revision': '7' },
            });
        });

        const view = render(<ThumbnailTapestry sessionId="session-1" />);

        // The accessible line still names the hand…
        expect(await view.findByText('Raised hands: Ana')).toBeInTheDocument();
        // …but no tag is drawn over a possibly-shifted grid.
        expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull();
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

    it('never lets a slower earlier composite poll overwrite a newer one', async () => {
        vi.useFakeTimers();
        let counter = 0;
        URL.createObjectURL = vi.fn(() => `blob:frame-${++counter}`);
        URL.revokeObjectURL = vi.fn();
        const deferred: Array<{ url: string; resolve: (r: Response) => void }> = [];
        global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tapestry/hands')) {
                return Promise.resolve(new Response(JSON.stringify({ hands: [] }), { status: 200 }));
            }
            return new Promise<Response>((resolve) => deferred.push({ url, resolve }));
        });
        const view = render(<ThumbnailTapestry sessionId="session-1" />);

        // Poll A starts; poll B starts after the interval while A is pending.
        await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
        expect(deferred).toHaveLength(2);

        // B resolves first and wins.
        await act(async () => {
            deferred[1].resolve(new Response(new Blob(['jpeg-b']), {
                status: 200,
                headers: { 'x-tapestry-revision': '9' },
            }));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:frame-1');

        // A resolves late: ignored, its blob revoked, image stays B's.
        await act(async () => {
            deferred[0].resolve(new Response(new Blob(['jpeg-a']), {
                status: 200,
                headers: { 'x-tapestry-revision': '7' },
            }));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(view.container.querySelector('img')).toHaveAttribute('src', 'blob:frame-1');
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame-2');
        vi.useRealTimers();
    });

    it('aborts and leaks nothing when unmounted with a poll in flight', async () => {
        URL.createObjectURL = vi.fn(() => 'blob:frame-x');
        URL.revokeObjectURL = vi.fn();
        const deferred: Array<(r: Response) => void> = [];
        global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tapestry/hands')) {
                return Promise.resolve(new Response(JSON.stringify({ hands: [] }), { status: 200 }));
            }
            return new Promise<Response>((resolve) => deferred.push(resolve));
        });
        const view = render(<ThumbnailTapestry sessionId="session-1" />);

        view.unmount();
        await act(async () => {
            deferred[0](new Response(new Blob(['jpeg']), { status: 200 }));
            await Promise.resolve();
        });

        // The late blob was created by the in-flight request but must be
        // revoked immediately, never displayed.
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:frame-x');
        expect(view.container.querySelector('img')).toBeNull();
    });
});
