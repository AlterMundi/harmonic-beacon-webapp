// @vitest-environment jsdom
import { cleanup, render as rtlRender, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import HandRaiseButton from '../HandRaiseButton';
import { LocaleProvider } from '@/context/LocaleContext';

function render(ui: ReactNode) {
    return rtlRender(ui, { wrapper: ({ children }) => <LocaleProvider initialLocale="en">{children}</LocaleProvider> });
}

type HandState = Record<string, unknown>;

function state(overrides: Partial<HandState> = {}): HandState {
    return {
        participantId: 'participant-1',
        raised: false,
        raisedAt: null,
        queuePosition: null,
        canPublish: false,
        grantVersion: 0,
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

    it('informs the naming-consent scope before the first raise', async () => {
        const { fetchMock } = mockFetchSequence([state()]);
        vi.stubGlobal('fetch', fetchMock);
        render(<HandRaiseButton sessionId="event-1" />);

        await waitFor(() => screen.getByRole('button', { name: /Raise hand/i }));
        expect(screen.getByText(/While your hand is raised, your name appears/)).toBeInTheDocument();
    });

    it('raises the hand with POST and reports the queue position', async () => {
        const { fetchMock, calls } = mockFetchSequence([
            state(),
            state({ raised: true, raisedAt: '2026-08-01T15:10:00.000Z', queuePosition: 2 }),
        ]);
        vi.stubGlobal('fetch', fetchMock);
        render(<HandRaiseButton sessionId="event-1" />);

        await waitFor(() => screen.getByRole('button', { name: /Raise hand/i }));
        await userEvent.click(screen.getByRole('button', { name: /Raise hand/i }));

        await waitFor(() => {
            expect(screen.getByRole('status')).toHaveTextContent('you are number #2 in the queue');
        });
        expect(calls).toContainEqual({
            url: '/api/scheduled-sessions/event-1/hand',
            method: 'POST',
        });
        expect(screen.getByRole('button', { name: /Lower hand/i })).toBeInTheDocument();
    });

    it('lowers a raised hand with DELETE', async () => {
        const { fetchMock, calls } = mockFetchSequence([
            state({ raised: true, raisedAt: '2026-08-01T15:10:00.000Z', queuePosition: 1 }),
            state(),
        ]);
        vi.stubGlobal('fetch', fetchMock);
        render(<HandRaiseButton sessionId="event-1" />);

        await waitFor(() => screen.getByRole('button', { name: /Lower hand/i }));
        await userEvent.click(screen.getByRole('button', { name: /Lower hand/i }));

        await waitFor(() => {
            expect(calls).toContainEqual({
                url: '/api/scheduled-sessions/event-1/hand',
                method: 'DELETE',
            });
        });
        await waitFor(() => screen.getByRole('button', { name: /Raise hand/i }));
    });

    it('notifies the room page when polling observes a promotion, without a reconnect', async () => {
        const { fetchMock } = mockFetchSequence([
            state({ raised: true, queuePosition: 1 }),
            state({ canPublish: true, grantVersion: 1 }),
        ]);
        vi.stubGlobal('fetch', fetchMock);
        const onGrant = vi.fn();
        const view = render(<HandRaiseButton sessionId="event-1" onPublishGrantChange={onGrant} />);

        // First poll: no grant, callback fires once with false.
        await waitFor(() => expect(onGrant).toHaveBeenCalledWith(false, 0));
        // Second poll (2s interval): the durable grant flipped — the room page
        // can now offer mic/camera. No token refetch, no reconnect.
        await waitFor(() => expect(onGrant).toHaveBeenCalledWith(true, 1), { timeout: 4000 });
        expect(screen.queryByText(/You are on stage — enable microphone and camera/)).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /hand/i })).not.toBeInTheDocument();

        view.rerender(
            <HandRaiseButton
                sessionId="event-1"
                onPublishGrantChange={onGrant}
                stageInvitationAccepted
            />,
        );
        expect(screen.getByText(/You are on stage — enable microphone and camera/)).toBeInTheDocument();
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
            expect(screen.getByRole('status')).toHaveTextContent('you are number #1 in the queue');
        });
        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent('Hand status unavailable');
        }, { timeout: 4000 });
        expect(screen.getByRole('status')).toHaveTextContent('you are number #1 in the queue');
    });

    it('explains a staff-cookie collision and stops attendee actions', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: false,
            status: 403,
            json: async () => ({ error: 'Insufficient permissions' }),
        });
        vi.stubGlobal('fetch', fetchMock);
        render(<HandRaiseButton sessionId="event-1" />);

        expect(await screen.findByRole('alert')).toHaveTextContent(
            'signed in as staff',
        );
        const button = screen.getByRole('button', { name: /Raise hand/i });
        expect(button).toBeDisabled();
        await userEvent.click(button);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
