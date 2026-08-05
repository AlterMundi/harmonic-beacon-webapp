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

    it('shows the unavailable state when both reads fail', async () => {
        global.fetch = stubFetch(() => new Response('down', { status: 503 }));
        const view = render(<OpsTapestry sessionId="session-1" copy={copyEs} />);

        expect(await view.findByText(copyEs.unavailable)).toBeInTheDocument();
        // One composite attempt + one semantic attempt, then it stops.
        expect(fetch).toHaveBeenCalledTimes(2);
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

        // Cycle A starts (composite pending). Cycle B starts after the interval.
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        expect(deferred).toHaveLength(2); // A composite + B composite

        // B completes first: its state must win.
        const manifestB = manifest({ revision: 'rev-b' });
        await act(async () => {
            deferred[1].resolve(compositeResponse('7', 'jpeg-b'));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(deferred).toHaveLength(3); // B manifest
        await act(async () => {
            deferred[2].resolve(manifestResponse(manifestB));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(view.getByRole('img', { name: copy.compositeAlt })).toHaveAttribute('src', 'blob:composite-1');

        // A resolves late: its generation is stale, so it stops right after
        // the composite read — no manifest fetch, no blob, no state change.
        await act(async () => {
            deferred[0].resolve(compositeResponse('7', 'jpeg-a'));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(deferred).toHaveLength(3);
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        expect(view.getByRole('img', { name: copy.compositeAlt })).toHaveAttribute('src', 'blob:composite-1');
        expect(screen.getByText('Ana', { selector: 'li span' })).toBeInTheDocument();
    });

    it('aborts and leaks nothing when unmounted mid-cycle', async () => {
        const deferred: Array<(r: Response) => void> = [];
        global.fetch = vi.fn().mockImplementation(() =>
            new Promise<Response>((resolve) => deferred.push(resolve)));
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        view.unmount();
        // A late composite response must stop before the manifest fetch and
        // before any object URL: no state update, nothing to leak.
        deferred[0](compositeResponse());
        await act(async () => { await Promise.resolve(); });

        expect(deferred).toHaveLength(1);
        expect(URL.createObjectURL).not.toHaveBeenCalled();
    });

    it('reconverges R→R+1 within one cycle and stores layout R+1 despite an identical semantic hash', async () => {
        vi.useFakeTimers();
        let compositeCalls = 0;
        let manifestCalls = 0;
        global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tapestry/manifest')) {
                manifestCalls += 1;
                // Cycle 2, attempt 1: a frame landed between the reads, the
                // layout read is still R=7. Attempt 2 sees the build R+1=8.
                // The semantic revision string NEVER changes.
                const layoutRevision = manifestCalls >= 3 ? 8 : 7;
                return Promise.resolve(manifestResponse(manifest({
                    layout: { revision: layoutRevision, columns: 2, rows: 1, tileSizePx: 100 },
                })));
            }
            compositeCalls += 1;
            return Promise.resolve(compositeResponse(compositeCalls === 1 ? '7' : '8'));
        });
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        // Cycle 1: correlated at R=7, overlay draws.
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(view.container.querySelector('[aria-hidden="true"]')).not.toBeNull();

        // Cycle 2: first pair mismatches (8 vs 7), the bounded retry pairs
        // 8 with 8 and the overlay survives the build advance.
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        expect(manifestCalls).toBe(3); // 1 (cycle 1) + 2 (mismatch + retry)
        expect(compositeCalls).toBe(3);
        // The name still sits over Ana's cell: layout 8 was stored even
        // though names, order, hands, camera and presence are identical.
        const overlayTag = view.container.querySelector('[aria-hidden="true"] span.absolute.bottom-0');
        expect(overlayTag).toHaveTextContent('Ana');
        expect(view.getByRole('img', { name: copy.compositeAlt })).toBeInTheDocument();
        vi.useRealTimers();
    });

    it('stays bounded under continuous ingest mismatch and converges when a pair aligns', async () => {
        vi.useFakeTimers();
        let aligned = false;
        global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tapestry/manifest')) {
                return Promise.resolve(manifestResponse(manifest({
                    layout: { revision: aligned ? 9 : 7, columns: 2, rows: 1, tileSizePx: 100 },
                })));
            }
            return Promise.resolve(compositeResponse('9'));
        });
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        // Cycle 1 under permanent mismatch: exactly MAX attempts, overlay
        // suppressed, the truthful list still renders.
        await act(async () => { await vi.advanceTimersByTimeAsync(0); });
        expect(fetch).toHaveBeenCalledTimes(6); // 3 attempts × 2 reads
        expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull();
        expect(screen.getByText('Ana', { selector: 'li span' })).toBeInTheDocument();

        // Cycle 2: same bounded cost — no storm, no growth, no overlay.
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        expect(fetch).toHaveBeenCalledTimes(12);
        expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull();

        // When a correlated pair appears, the overlay reconverges.
        aligned = true;
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        expect(view.container.querySelector('[aria-hidden="true"]')).not.toBeNull();
        expect(fetch).toHaveBeenCalledTimes(14); // back to 2 reads per cycle
        vi.useRealTimers();
    });

    it('mismatch→match: revokes the fallback URL exactly once and keeps the chosen one until unmount', async () => {
        let manifestCalls = 0;
        global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tapestry/manifest')) {
                manifestCalls += 1;
                // Attempt 1: layout still at R=7 while the composite built
                // R=8 (mismatch, fallback candidate A). Attempt 2: R=8
                // (correlated candidate B).
                return Promise.resolve(manifestResponse(manifest({
                    layout: { revision: manifestCalls === 1 ? 7 : 8, columns: 2, rows: 1, tileSizePx: 100 },
                })));
            }
            return Promise.resolve(compositeResponse('8'));
        });
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        await act(async () => { await Promise.resolve(); });
        // B (blob:composite-2) is the visible state; A was discarded.
        expect(view.getByRole('img', { name: copy.compositeAlt })).toHaveAttribute('src', 'blob:composite-2');
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:composite-1');
        expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:composite-2');

        // B lives until unmount, then is revoked exactly once.
        view.unmount();
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:composite-2');
    });

    it('mismatch→error: revokes the failed attempt and the published fallback at unmount — no orphan blobs', async () => {
        let manifestCalls = 0;
        global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tapestry/manifest')) {
                manifestCalls += 1;
                if (manifestCalls === 2) return Promise.reject(new Error('network down'));
                return Promise.resolve(manifestResponse(manifest({
                    layout: { revision: 7, columns: 2, rows: 1, tileSizePx: 100 },
                })));
            }
            return Promise.resolve(compositeResponse('8'));
        });
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        await act(async () => { await Promise.resolve(); });
        // Attempt 2's blob (composite-2) failed before becoming a candidate:
        // revoked immediately. Candidate A (composite-1) became the safe
        // fallback and was published.
        expect(view.getByRole('img', { name: copy.compositeAlt })).toHaveAttribute('src', 'blob:composite-1');
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:composite-2');
        // The list is still truthful; overlays stay hidden (layout 7 ≠ build 8).
        expect(screen.getByText('Ana', { selector: 'li span' })).toBeInTheDocument();
        expect(view.container.querySelector('[aria-hidden="true"]')).toBeNull();

        // The published fallback is revoked at unmount: nothing orphaned.
        view.unmount();
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:composite-1');
    });

    it('session A→B with identical revisions shows only B and revokes A', async () => {
        global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            if (url.includes('/tapestry/manifest')) {
                // Both sessions report the SAME semantic revision and layout
                // revision; only the session scopes the content.
                if (url.includes('session-2')) {
                    return Promise.resolve(manifestResponse(manifest({
                        sessionId: 'session-2',
                        entries: [{ ...manifest().entries[0], displayName: 'Caro' }],
                    })));
                }
                return Promise.resolve(manifestResponse(manifest()));
            }
            return Promise.resolve(compositeResponse('7'));
        });
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);
        expect(await screen.findByText('Ana', { selector: 'li span' })).toBeInTheDocument();
        expect(view.getByRole('img', { name: copy.compositeAlt })).toHaveAttribute('src', 'blob:composite-1');

        view.rerender(<OpsTapestry sessionId="session-2" copy={copy} />);
        // The reset is immediate: A's names, list and image are gone before
        // B's first fetch even resolves.
        expect(screen.queryByText('Ana', { selector: 'li span' })).not.toBeInTheDocument();
        expect(view.container.querySelector('img')).toBeNull();
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:composite-1');

        // B answers with identical revisions: the session-scoped cache lets
        // B's manifest in, and only B's data shows.
        expect(await screen.findByText('Caro', { selector: 'li span' })).toBeInTheDocument();
        expect(screen.queryByText('Ana', { selector: 'li span' })).not.toBeInTheDocument();
        expect(view.getByRole('img', { name: copy.compositeAlt })).toHaveAttribute('src', 'blob:composite-2');
    });

    it('session A→B with identical revisions and B failing never resurrects A', async () => {
        vi.useFakeTimers();
        const deferred: Array<{ url: string; resolve: (r: Response) => void }> = [];
        global.fetch = vi.fn().mockImplementation((input: RequestInfo | URL) => {
            const url = String(input);
            return new Promise<Response>((resolve) => deferred.push({ url, resolve }));
        });
        const view = render(<OpsTapestry sessionId="session-1" copy={copy} />);

        // A's first cycle completes: Ana published with blob:composite-1.
        expect(deferred).toHaveLength(1); // A composite
        await act(async () => {
            deferred[0].resolve(compositeResponse('7'));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(deferred).toHaveLength(2); // A manifest
        await act(async () => {
            deferred[1].resolve(manifestResponse(manifest()));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(screen.getByText('Ana', { selector: 'li span' })).toBeInTheDocument();

        // A's next cycle starts (composite in flight) when the switch happens.
        await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
        expect(deferred).toHaveLength(3);
        view.rerender(<OpsTapestry sessionId="session-2" copy={copy} />);
        // Immediate reset: no A data, A's published URL revoked, loading state.
        expect(screen.queryByText('Ana', { selector: 'li span' })).not.toBeInTheDocument();
        expect(view.container.querySelector('img')).toBeNull();
        expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:composite-1');

        // A's late response lands after the switch: ignored before creating
        // any blob, cleaning up after itself.
        await act(async () => {
            deferred[2].resolve(compositeResponse('7', 'jpeg-a-late'));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1); // still only A's first blob
        expect(screen.queryByText('Ana', { selector: 'li span' })).not.toBeInTheDocument();

        // B fails on both reads: B's unavailable state, never A's data.
        expect(deferred).toHaveLength(4); // B composite
        await act(async () => {
            deferred[3].resolve(new Response('down', { status: 503 }));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(deferred).toHaveLength(5); // B manifest (semantic path)
        await act(async () => {
            deferred[4].resolve(new Response('down', { status: 503 }));
            await vi.advanceTimersByTimeAsync(0);
        });
        expect(screen.getByText(copy.unavailable)).toBeInTheDocument();
        expect(screen.queryByText('Ana', { selector: 'li span' })).not.toBeInTheDocument();
        vi.useRealTimers();
    });
});
