// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AccessBoundarySync from '../AccessBoundarySync';

describe('Listener access boundary synchronization', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('revalidates once at the server boundary and enters an active Free window', async () => {
        const changed = vi.fn();
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            access: { kind: 'free-window', allowedUntil: '2026-08-07T17:00:00.000Z' },
        }), { status: 200 }));
        render(
            <AccessBoundarySync
                expectedKind="denied"
                boundaryAt="2026-08-07T15:01:00.000Z"
                serverNow="2026-08-07T15:00:00.000Z"
                onAccessChanged={changed}
            />,
        );

        await act(async () => { await vi.advanceTimersByTimeAsync(60_750); });

        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(changed).toHaveBeenCalledTimes(1);
    });

    it('revalidates an active welcome at expiry and leaves the player', async () => {
        const changed = vi.fn();
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
            access: { kind: 'denied', allowedUntil: null },
        }), { status: 200 }));
        render(
            <AccessBoundarySync
                expectedKind="welcome"
                boundaryAt="2026-08-07T15:30:00.000Z"
                serverNow="2026-08-07T15:29:59.000Z"
                onAccessChanged={changed}
            />,
        );

        await act(async () => { await vi.advanceTimersByTimeAsync(1_750); });

        expect(changed).toHaveBeenCalledTimes(1);
    });
});
