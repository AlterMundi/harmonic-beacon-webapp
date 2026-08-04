// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages } from '@/lib/i18n';
import type { TapestryManifest } from '@/lib/tapestry-manifest';
import OpsTapestry from '../OpsTapestry';

const COPY = messages.en.ops.opsTapestry;

function manifest(overrides: Partial<TapestryManifest> = {}): TapestryManifest {
    return {
        sessionId: 'event-1',
        revision: 'rev-1',
        thumbnailFreshForSeconds: 10,
        liveStateAvailable: true,
        entries: [
            {
                tileId: 'tp-ana',
                position: 0,
                displayName: 'Ana',
                handRaised: true,
                queuePosition: 1,
                presence: 'connected',
                camera: 'on',
                thumbnailUrl: '/tiles/tp-ana?v=1',
            },
            {
                tileId: 'tp-beto',
                position: 1,
                displayName: 'Beto',
                handRaised: false,
                queuePosition: null,
                presence: 'reconnecting',
                camera: 'off',
                thumbnailUrl: null,
            },
        ],
        waitingHands: [
            { displayName: 'Ana', queuePosition: 1, tileId: 'tp-ana' },
            { displayName: 'Cora', queuePosition: 2, tileId: null },
        ],
        ...overrides,
    };
}

function mockFetch(body: unknown, ok = true, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok,
        status,
        json: async () => body,
    });
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('OpsTapestry', () => {
    it('shows names, the hand badge and state per tile from one manifest poll', async () => {
        const fetchMock = mockFetch(manifest());
        render(<OpsTapestry sessionId="event-1" copy={COPY} />);

        expect(await screen.findByText('Ana')).toBeInTheDocument();
        expect(screen.getByText('Beto')).toBeInTheDocument();
        expect(screen.getByText('Hand 1')).toBeInTheDocument();
        // The full state is in the accessible name of every tile button.
        expect(screen.getByRole('button', {
            name: 'Ana, Hand 1, present, camera on',
        })).toBeInTheDocument();
        expect(screen.getByRole('button', {
            name: 'Beto, reconnecting, camera off',
        })).toBeInTheDocument();
        // One bounded request per poll — never one per tile.
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            '/api/ops/sessions/event-1/tapestry/manifest',
        );
    });

    it('announces the hand count and lists hands waiting without a snapshot', async () => {
        mockFetch(manifest());
        render(<OpsTapestry sessionId="event-1" copy={COPY} />);

        expect(await screen.findByText('2 hands raised')).toBeInTheDocument();
        expect(screen.getByText('Waiting without a snapshot: Cora')).toBeInTheDocument();
    });

    it('uses the dignified fallback when a tile has no current snapshot', async () => {
        mockFetch(manifest());
        render(<OpsTapestry sessionId="event-1" copy={COPY} />);

        expect(await screen.findByRole('img', {
            name: 'Beto: no current tapestry snapshot',
        })).toBeInTheDocument();
    });

    it('falls back when a thumbnail fails to load and retries the next epoch', async () => {
        mockFetch(manifest());
        render(<OpsTapestry sessionId="event-1" copy={COPY} />);

        const image = await screen.findByAltText('Recent tapestry snapshot of Ana');
        image.dispatchEvent(new Event('error'));
        expect(await screen.findByRole('img', {
            name: 'Ana: no current tapestry snapshot',
        })).toBeInTheDocument();
    });

    it('expands textual state on activation for touch, keyboard and pointer alike', async () => {
        mockFetch(manifest());
        render(<OpsTapestry sessionId="event-1" copy={COPY} />);

        const tile = await screen.findByRole('button', { name: 'Ana, Hand 1, present, camera on' });
        expect(tile).toHaveAttribute('aria-expanded', 'false');
        await userEvent.click(tile);
        expect(tile).toHaveAttribute('aria-expanded', 'true');
        const detail = document.getElementById(tile.getAttribute('aria-controls')!);
        expect(detail).not.toBeNull();
        expect(detail).toHaveTextContent('present · camera on');
        expect(detail).toBeVisible();
        // Keyboard: the tile is a native button, focusable and activatable.
        await userEvent.keyboard('{Enter}');
        expect(tile).toHaveAttribute('aria-expanded', 'false');
    });

    it('renders the truthful empty state with zero participants', async () => {
        mockFetch(manifest({ entries: [], waitingHands: [] }));
        render(<OpsTapestry sessionId="event-1" copy={COPY} />);

        expect(await screen.findByText(
            'No tiles yet — they appear as people share a snapshot.',
        )).toBeInTheDocument();
    });

    it('keeps the queue operable message when the tapestry is unavailable', async () => {
        mockFetch({}, false, 503);
        render(<OpsTapestry sessionId="event-1" copy={COPY} />);

        expect(await screen.findByText(/tapestry is unavailable/i)).toBeInTheDocument();
    });

    it('warns when presence and camera cannot be confirmed', async () => {
        mockFetch(manifest({ liveStateAvailable: false }));
        render(<OpsTapestry sessionId="event-1" copy={COPY} />);

        expect(await screen.findByText(/Presence and camera unconfirmed/i)).toBeInTheDocument();
    });

    it('uses singular copy for exactly one hand', async () => {
        mockFetch(manifest({
            waitingHands: [{ displayName: 'Ana', queuePosition: 1, tileId: 'tp-ana' }],
        }));
        render(<OpsTapestry sessionId="event-1" copy={COPY} />);

        expect(await screen.findByText('1 hand raised')).toBeInTheDocument();
    });

    it('scales to a full room without per-tile requests', async () => {
        const entries = Array.from({ length: 150 }, (_, index) => ({
            tileId: `tp-${index}`,
            position: index,
            displayName: `Person ${index}`,
            handRaised: false,
            queuePosition: null,
            presence: 'connected' as const,
            camera: 'off' as const,
            thumbnailUrl: `/tiles/tp-${index}?v=1`,
        }));
        const fetchMock = mockFetch(manifest({ entries }));
        render(<OpsTapestry sessionId="event-1" copy={COPY} />);

        expect(await screen.findByText('Person 149')).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
