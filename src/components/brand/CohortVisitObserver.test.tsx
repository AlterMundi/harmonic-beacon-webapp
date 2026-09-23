// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const path = vi.hoisted(() => ({ value: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => path.value }));
import { CohortVisitObserver } from './CohortVisitObserver';
describe('visible authenticated visit observer', () => {
    beforeEach(() => {
        vi.useFakeTimers(); path.value = '/';
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 202, arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)) }));
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
    it('observes mount and heartbeat without relying on a new login', async () => {
        render(<CohortVisitObserver />);
        await act(async () => {});
        expect(fetch).toHaveBeenCalledTimes(1);
        await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(fetch).toHaveBeenLastCalledWith('/api/cohort-visits', expect.objectContaining({
            credentials: 'same-origin', body: '{"surface":"landing"}',
        }));
    });
    it('includes waiting/session pages and cancels upon unmount', async () => {
        path.value = '/session/session-id';
        const r = render(<CohortVisitObserver />);
        await act(async () => {});
        expect(fetch).toHaveBeenCalledWith('/api/cohort-visits', expect.objectContaining({ body: '{"surface":"session"}' }));
        r.unmount();
        await act(async () => vi.advanceTimersByTimeAsync(120_000));
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('skips hidden pages and records restored visibility', async () => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        render(<CohortVisitObserver />);
        await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(fetch).not.toHaveBeenCalled();
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        expect(fetch).toHaveBeenCalledTimes(1);
    });
    it('does not observe unrelated admin pages', () => {
        path.value = '/ops'; render(<CohortVisitObserver />); expect(fetch).not.toHaveBeenCalled();
    });
    it('contains network failure and retries only on the regular heartbeat', async () => {
        vi.mocked(fetch).mockRejectedValue(new Error('offline'));
        render(<CohortVisitObserver />);
        await act(async () => vi.advanceTimersByTimeAsync(60_000));
        expect(fetch).toHaveBeenCalledTimes(2);
    });
});
