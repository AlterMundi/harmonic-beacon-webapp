// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

import FoundingListenerMembershipActions from '../FoundingListenerMembershipActions';

beforeEach(() => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
        .mockReturnValue('123e4567-e89b-42d3-a456-426614174000');
});

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    refresh.mockReset();
});

describe('Founding Listener membership actions', () => {
    it('renders the service boundary in an explicit server-stable timezone', () => {
        render(
            <LocaleProvider initialLocale="en">
                <FoundingListenerMembershipActions membership={{
                    kind: 'founder',
                    provider: 'paypal',
                    state: 'active',
                    serviceThrough: '2026-09-07T12:00:00.000Z',
                }} />
            </LocaleProvider>,
        );

        expect(screen.getByText('Current period through Sep 7, 2026, 12:00 PM UTC.'))
            .toBeInTheDocument();
    });

    it('requires explicit confirmation and sends no provider identity', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'queued' }, { status: 202 }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <FoundingListenerMembershipActions membership={{
                    kind: 'founder',
                    provider: 'paypal',
                    state: 'active',
                    serviceThrough: '2026-09-07T12:00:00.000Z',
                }} />
            </LocaleProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Cancel membership' }));
        expect(screen.getByText(/Founder pricing ends/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel at period end' }));
        await screen.findByText(/We received the request/);
        const sent = JSON.parse(fetchMock.mock.calls[0][1].body) as Record<string, unknown>;
        expect(fetchMock).toHaveBeenCalledWith('/api/listener/membership/action', expect.any(Object));
        expect(sent).toEqual({
            action: 'cancel',
            attemptId: '123e4567-e89b-42d3-a456-426614174000',
        });
        expect(JSON.stringify(sent)).not.toMatch(/paypal|subscription|account/i);
    });

    it('reveals reactivation without a manual reload after cancellation converges', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'queued' }, { status: 202 }));
        vi.stubGlobal('fetch', fetchMock);
        const view = render(
            <LocaleProvider initialLocale="en">
                <FoundingListenerMembershipActions membership={{
                    kind: 'founder', provider: 'paypal', state: 'active',
                }} />
            </LocaleProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Cancel membership' }));
        fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel at period end' }));
        await screen.findByText(/We received the request/);

        view.rerender(
            <LocaleProvider initialLocale="en">
                <FoundingListenerMembershipActions membership={{
                    kind: 'founder', provider: 'paypal', state: 'ending',
                }} />
            </LocaleProvider>,
        );

        expect(await screen.findByRole('button', { name: 'Reactivate membership' }))
            .toBeInTheDocument();
        expect(screen.queryByText(/We received the request/)).not.toBeInTheDocument();
    });

    it('polls silently and refreshes only after canonical cancellation is visible', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(Response.json({ status: 'queued' }, { status: 202 }))
            .mockResolvedValueOnce(Response.json({ membershipState: 'ending' }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <FoundingListenerMembershipActions membership={{
                    kind: 'founder', provider: 'paypal', state: 'active',
                }} />
            </LocaleProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Cancel membership' }));
        fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel at period end' }));
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
        });
        expect(screen.getByText(/We received the request/)).toBeInTheDocument();
        expect(refresh).not.toHaveBeenCalled();

        await act(async () => vi.advanceTimersByTimeAsync(2_000));

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls[1][0]).toBe('/api/listener/access-state');
        expect(refresh).toHaveBeenCalledTimes(1);
    });

    it('offers provider-neutral reactivation while canonical state is ending', async () => {
        const fetchMock = vi.fn().mockResolvedValue(Response.json({ status: 'queued' }, { status: 202 }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <FoundingListenerMembershipActions membership={{
                    kind: 'founder', provider: 'mercado-pago', state: 'ending',
                }} />
            </LocaleProvider>,
        );
        expect(screen.queryByRole('button', { name: 'Cancel membership' })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Reactivate membership' }));
        await screen.findByText(/provider confirms reactivation/);
        const sent = JSON.parse(fetchMock.mock.calls[0][1].body) as Record<string, unknown>;
        expect(sent).toEqual({
            action: 'reactivate',
            attemptId: '123e4567-e89b-42d3-a456-426614174000',
        });
        expect(JSON.stringify(sent)).not.toMatch(/paypal|mercado|subscription|account/i);
    });

    it('keeps the action retryable after a generic failure', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({}, { status: 503 })));
        render(
            <LocaleProvider initialLocale="en">
                <FoundingListenerMembershipActions membership={{
                    kind: 'founder', provider: 'paypal', state: 'active',
                }} />
            </LocaleProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Cancel membership' }));
        fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel at period end' }));
        await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    });
});
