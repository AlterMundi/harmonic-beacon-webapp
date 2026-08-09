// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import FreeQuotaStatus from '../FreeQuotaStatus';

const snapshot = {
    policy: 'personal-7-day-v1' as const,
    status: 'listening' as const,
    cycleStartedAt: '2026-08-07T15:00:00.000Z',
    cycleEndsAt: '2026-08-14T15:00:00.000Z',
    baseAllowanceMs: 10_800_000,
    bonusAllowanceMs: 1_800_000,
    consumedMs: 0,
    remainingMs: 10_800_000,
    activelyConsuming: true,
    exhaustsAt: '2026-08-07T18:00:00.000Z',
    nextCycleAt: '2026-08-14T15:00:00.000Z',
};

describe('Listener weekly quota presentation', () => {
    beforeEach(() => {
        cleanup();
        vi.useFakeTimers();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            serverNow: '2026-08-07T15:00:30.000Z',
            access: { kind: 'free-quota', quota: { ...snapshot, remainingMs: 10_770_000 } },
        }), { status: 200 })));
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.unstubAllGlobals();
        refresh.mockReset();
    });

    it('renders remaining weekly time, credits, and renewal from a canonical server snapshot', () => {
        render(
            <LocaleProvider initialLocale="en">
                <FreeQuotaStatus snapshot={snapshot} serverNow="2026-08-07T15:00:00.000Z" />
            </LocaleProvider>,
        );

        expect(screen.getByText('You have 3h left this week')).toBeInTheDocument();
        expect(screen.getByText('Includes 30m of extra credit.')).toBeInTheDocument();
        expect(screen.getByText('Renews in 168h')).toBeInTheDocument();
    });

    it('never fabricates an allowance from an incomplete snapshot', () => {
        render(
            <LocaleProvider initialLocale="en">
                <FreeQuotaStatus snapshot={{ policy: 'personal-7-day-v1' } as never} serverNow="2026-08-07T15:00:00.000Z" />
            </LocaleProvider>,
        );

        expect(screen.queryByText(/left this week/i)).toBeNull();
        expect(screen.queryByText(/starts when you listen/i)).toBeNull();
    });

    it('revalidates on explicit playback presence without treating it as local authority', async () => {
        render(
            <LocaleProvider initialLocale="en">
                <FreeQuotaStatus snapshot={snapshot} serverNow="2026-08-07T15:00:00.000Z" />
            </LocaleProvider>,
        );

        window.dispatchEvent(new Event('listener:playback-presence'));
        await act(async () => {});
        expect(fetch).toHaveBeenCalledWith('/api/listener/access-state', {
            cache: 'no-store',
            headers: { Accept: 'application/json' },
        });
    });

    it('refreshes the server component tree when the canonical quota state changes', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
            serverNow: '2026-08-14T15:00:01.000Z',
            access: {
                kind: 'free-quota',
                quota: {
                    ...snapshot,
                    status: 'available',
                    activelyConsuming: false,
                    remainingMs: 10_800_000,
                    nextCycleAt: '2026-08-21T15:00:00.000Z',
                },
            },
        }), { status: 200 })));
        render(
            <LocaleProvider initialLocale="en">
                <FreeQuotaStatus snapshot={{
                    ...snapshot,
                    status: 'exhausted',
                    activelyConsuming: false,
                    remainingMs: 0,
                    nextCycleAt: '2026-08-14T15:01:00.000Z',
                }} serverNow="2026-08-14T15:00:00.000Z" />
            </LocaleProvider>,
        );

        window.dispatchEvent(new Event('listener:playback-presence'));
        await act(async () => {});
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(screen.getByText('You have 3h left this week')).toBeInTheDocument();
    });

    it('uses a monotonic elapsed clock only while the server says consumption is active', async () => {
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
        render(
            <LocaleProvider initialLocale="en">
                <FreeQuotaStatus snapshot={{ ...snapshot, remainingMs: 90_000 }} serverNow="2026-08-07T15:00:00.000Z" />
            </LocaleProvider>,
        );

        expect(screen.getByText('You have 2m left this week')).toBeInTheDocument();
        await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
        expect(screen.getByText('You have 1m left this week')).toBeInTheDocument();
    });
});
