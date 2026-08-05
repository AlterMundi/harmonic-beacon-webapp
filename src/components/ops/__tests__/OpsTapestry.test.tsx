// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { messages } from '@/lib/i18n';
import type { TapestryManifest } from '@/lib/tapestry-manifest';

import OpsTapestry from '../OpsTapestry';

const copy = messages.en.ops.opsTapestry;
const copyEs = messages.es.ops.opsTapestry;

function manifest(overrides: Partial<TapestryManifest> = {}): TapestryManifest {
    return {
        sessionId: 'session-1',
        revision: 'rev-a',
        liveStateAvailable: true,
        layout: { revision: 7, columns: 2, rows: 1, tileSizePx: 100 },
        tileFreshForSeconds: 10,
        entries: [
            {
                tileId: 'tp-ana',
                displayName: 'Ana',
                handRaised: true,
                queuePosition: 1,
                presence: 'connected',
                camera: 'off',
                column: 1,
                row: 0,
            },
            {
                tileId: 'tp-beto',
                displayName: 'Beto',
                handRaised: false,
                queuePosition: null,
                presence: 'reconnecting',
                camera: 'unknown',
                column: 0,
                row: 0,
            },
        ],
        waitingHands: [{ displayName: 'Ana', queuePosition: 1, tileId: 'tp-ana' }],
        ...overrides,
    };
}

function manifestResponse(body: TapestryManifest, status = 200) {
    return new Response(JSON.stringify(body), { status });
}

function compositeResponse(revision: string | null = '7', bytes = 'jpeg') {
    return new Response(new Blob([bytes]), {
        status: 200,
        headers: revision ? { 'x-tapestry-revision': revision } : {},
    });
}

let blobCounter = 0;

function stubFetch(handler: (url: string) => Promise<Response> | Response) {
    return vi.fn().mockImplementation((input: RequestInfo | URL) => handler(String(input)));
}

beforeEach(() => {
    blobCounter = 0;
    URL.createObjectURL = vi.fn(() => `blob:composite-${++blobCounter}`);
    URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('OpsTapestry', () => {
    it('shows the loading state before the first response', () => {
        global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);
        expect(view.getByText(copy.loading)).toBeInTheDocument();
    });

    it('spends zero requests while inactive (hidden cockpit drawer)', async () => {
        vi.useFakeTimers();
        global.fetch = vi.fn();
        render(<OpsTapestry sessionId="session-1" copy={copy} active={false} />);
        await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
        expect(fetch).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('renders one composite with overlays and an accessible state list', async () => {
        global.fetch = stubFetch((url) =>
            url.includes('/tapestry/manifest') ? manifestResponse(manifest()) : compositeResponse());
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        const image = await view.findByRole('img', { name: copy.compositeAlt });
        expect(image).toHaveAttribute('src', 'blob:composite-1');
        // Overlay: the name sits over Ana's own cell (column 1 of 2 → 50%).
        const overlayTag = view.container.querySelector('[aria-hidden="true"] span.absolute.bottom-0');
        expect(overlayTag).toHaveTextContent('Ana');
        expect(overlayTag?.parentElement).toHaveStyle({ left: '50%' });
        // Exactly one image element exists — never one per participant.
        expect(view.container.querySelectorAll('img')).toHaveLength(1);
        // The accessible list carries every state as plain text.
        const row = screen.getByText('Ana', { selector: 'li span' }).closest('li')!;
        expect(row).toHaveTextContent('Hand 1');
        expect(row).toHaveTextContent('present');
        expect(row).toHaveTextContent('camera off');
        expect(screen.getByText('Beto', { selector: 'li span' }).closest('li')!).toHaveTextContent('reconnecting');
        // Two bounded requests per cycle: manifest JSON + composite image.
        expect(fetch).toHaveBeenCalledTimes(2);
    });

    it('omits overlays when the composite revision disagrees with the layout', async () => {
        global.fetch = stubFetch((url) =>
            url.includes('/tapestry/manifest') ? manifestResponse(manifest()) : compositeResponse('8'));
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        await view.findByRole('img', { name: copy.compositeAlt });
        expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull();
        // The truthful list remains either way.
        expect(screen.getByText('Ana', { selector: 'li span' })).toBeInTheDocument();
    });

    it('stays O(1) with 150 participants: two requests, one image', async () => {
        const entries = Array.from({ length: 150 }, (_, i) => ({
            tileId: `tp-${i}`,
            displayName: `Person ${i}`,
            handRaised: i === 0,
            queuePosition: i === 0 ? 1 : null,
            presence: 'connected' as const,
            camera: 'on' as const,
            column: i % 15,
            row: Math.floor(i / 15),
        }));
        global.fetch = stubFetch((url) =>
            url.includes('/tapestry/manifest')
                ? manifestResponse(manifest({
                    layout: { revision: 7, columns: 15, rows: 10, tileSizePx: 100 },
                    entries,
                }))
                : compositeResponse());
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        await view.findByRole('img', { name: copy.compositeAlt });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(view.container.querySelectorAll('img')).toHaveLength(1);
        expect(view.container.querySelectorAll('li')).toHaveLength(150);
    });

    it('shows the unavailable state without fetching the composite', async () => {
        global.fetch = stubFetch(() => new Response('down', { status: 503 }));
        const view = render(<OpsTapestry sessionId="session-1" copy={copyEs} />);

        expect(await view.findByText(copyEs.unavailable)).toBeInTheDocument();
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(view.container.querySelectorAll('img')).toHaveLength(0);
    });

    it('shows the empty state when the room has no tiles', async () => {
        global.fetch = stubFetch((url) =>
            url.includes('/tapestry/manifest')
                ? manifestResponse(manifest({ entries: [], waitingHands: [] }))
                : compositeResponse());
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        expect(await view.findByText(copy.empty)).toBeInTheDocument();
    });

    it('lists waiting hands without a tile', async () => {
        global.fetch = stubFetch((url) =>
            url.includes('/tapestry/manifest')
                ? manifestResponse(manifest({
                    waitingHands: [
                        { displayName: 'Ana', queuePosition: 1, tileId: 'tp-ana' },
                        { displayName: 'Cele', queuePosition: 2, tileId: null },
                    ],
                }))
                : compositeResponse());
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        expect(await view.findByText(/Waiting without a snapshot: Cele \(#2\)/)).toBeInTheDocument();
    });

    it('refreshes the composite bytes even when the semantic revision is unchanged', async () => {
        vi.useFakeTimers();
        global.fetch = stubFetch((url) =>
            url.includes('/tapestry/manifest') ? manifestResponse(manifest()) : compositeResponse());
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        const firstSrc = view.getByRole('img', { name: copy.compositeAlt }).getAttribute('src');

        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        const secondSrc = view.getByRole('img', { name: copy.compositeAlt }).getAttribute('src');

        // Same order, names and states — but the image visibly updated and
        // the previous object URL was revoked.
        expect(secondSrc).not.toBe(firstSrc);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstSrc);
    });

    it('ignores a slower earlier cycle that resolves after a newer one', async () => {
        vi.useFakeTimers();
        const deferred: Array<{ url: string; resolve: (r: Response) => void }> = [];
        global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            return new Promise<Response>((resolve) => deferred.push({ url, resolve }));
        });
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        // Cycle A starts (manifest pending). Cycle B starts after the interval.
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        expect(deferred).toHaveLength(2); // A manifest + B manifest

        // B completes first: its state must win.
        const manifestB = manifest({ revision: 'rev-b' });
        await act(async () => {
            deferred[1].resolve(manifestResponse(manifestB));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(deferred).toHaveLength(3); // B composite
        await act(async () => {
            deferred[2].resolve(compositeResponse('7', 'jpeg-b'));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(view.getByRole('img', { name: copy.compositeAlt })).toHaveAttribute('src', 'blob:composite-1');

        // A resolves late: its generation is stale, so it stops before its
        // composite fetch, touches nothing, and the state stays B's.
        await act(async () => {
            deferred[0].resolve(manifestResponse(manifest({ revision: 'rev-old' })));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(deferred).toHaveLength(3); // A never spends its composite fetch
        expect(view.getByRole('img', { name: copy.compositeAlt })).toHaveAttribute('src', 'blob:composite-1');
        expect(screen.getByText('Ana', { selector: 'li span' })).toBeInTheDocument();
    });

    it('aborts and leaks nothing when unmounted mid-cycle', async () => {
        const deferred: Array<(r: Response) => void> = [];
        global.fetch = vi.fn().mockImplementation(() =>
            new Promise<Response>((resolve) => deferred.push(resolve)));
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        view.unmount();
        // A late manifest response must not even trigger the composite
        // fetch: no state update, no blob, nothing to leak.
        deferred[0](manifestResponse(manifest()));
        await act(async () => { await Promise.resolve(); });

        expect(deferred).toHaveLength(1);
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });
});
