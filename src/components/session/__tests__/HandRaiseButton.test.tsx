// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HandRaiseButton from '../HandRaiseButton';

type HandState = Record<string, unknown>;

function state(overrides: Partial<HandState> = {}): HandState {
    return {
        participantId: 'participant-1',
        raised: false,
        raisedAt: null,
        queuePosition: null,
        canPublish: false,
        ...overrides,
    };
}

function mockFetchSequence(getStates: HandState[]) {
    let index = 0;
    const calls: Array<{ url: string; method: string }> = [];
    const fetchMock = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        calls.push({ url, method });
        if (method === 'GET') {
            const body = getStates[Math.min(index, getStates.length - 1)];
            index += 1;
            return { ok: true, status: 200, json: async () => body };
        }
        return {
            ok: true,
            status: 200,
            json: async () => state({
                raised: method === 'POST',
                raisedAt: method === 'POST' ? '2026-08-01T15:10:00.000Z' : null,
                queuePosition: method === 'POST' ? 2 : null,
            }),
        };
    });
    return { fetchMock, calls };
}

describe('HandRaiseButton', () => {
    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
    });

    it('raises the hand with POST and reports the queue position', async () => {
        const { fetchMock, calls } = mockFetchSequence([
            state(),
            state({ raised: true, raisedAt: '2026-08-01T15:10:00.000Z', queuePosition: 2 }),
        ]);
        vi.stubGlobal('fetch', fetchMock);
        render(<HandRaiseButton sessionId="event-1" />);

        await waitFor(() => screen.getByRole('button', { name: 'Raise hand' }));
        await userEvent.click(screen.getByRole('button', { name: 'Raise hand' }));

        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveTextContent('you are #2 in the queue');
        });
        expect(calls).toContainEqual({
            url: '/api/scheduled-sessions/event-1/hand',
            method: 'POST',
        });
        expect(screen.getByRole('button', { name: 'Lower hand' })).toBeInTheDocument();
    });

    it('lowers a raised hand with DELETE', async () => {
        const { fetchMock, calls } = mockFetchSequence([
            state({ raised: true, raisedAt: '2026-08-01T15:10:00.000Z', queuePosition: 1 }),
            state(),
        ]);
        vi.stubGlobal('fetch', fetchMock);
        render(<HandRaiseButton sessionId="event-1" />);

        await waitFor(() => screen.getByRole('button', { name: 'Lower hand' }));
        await userEvent.click(screen.getByRole('button', { name: 'Lower hand' }));

        await waitFor(() => {
            expect(calls).toContainEqual({
                url: '/api/scheduled-sessions/event-1/hand',
                method: 'DELETE',
            });
        });
        await waitFor(() => screen.getByRole('button', { name: 'Raise hand' }));
    });

    it('notifies the room page when polling observes a promotion, without a reconnect', async () => {
        const { fetchMock } = mockFetchSequence([
            state({ raised: true, queuePosition: 1 }),
            state({ canPublish: true }),
        ]);
        vi.stubGlobal('fetch', fetchMock);
        const onGrant = vi.fn();
        render(<HandRaiseButton sessionId="event-1" onPublishGrantChange={onGrant} />);

        // First poll: no grant, callback fires once with false.
        await waitFor(() => expect(onGrant).toHaveBeenCalledWith(false));
        // Second poll (2s interval): the durable grant flipped — the room page
        // can now offer mic/camera. No token refetch, no reconnect.
        await waitFor(() => expect(onGrant).toHaveBeenCalledWith(true), { timeout: 4000 });
        await waitFor(() => {
            expect(screen.getByText(/Your turn — enable mic and camera/)).toBeInTheDocument();
        });
    });

    it('surfaces a polling failure without clearing the current state', async () => {
        let calls = 0;
        vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
            calls += 1;
            if (calls === 1) {
                return { ok: true, status: 200, json: async () => state({ raised: true, queuePosition: 1 }) };
            }
            throw new Error('network down');
        }));
        render(<HandRaiseButton sessionId="event-1" />);

        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveTextContent('you are #1 in the queue');
        });
        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Hand status unavailable');
        }, { timeout: 4000 });
        expect(screen.getByRole('status')).toHaveTextContent('you are #1 in the queue');
    });
});
