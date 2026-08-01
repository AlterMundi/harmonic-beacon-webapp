// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import SessionLifecycleControl from '../SessionLifecycleControl';

describe('SessionLifecycleControl', () => {
    beforeEach(() => {
        vi.setSystemTime(new Date('2026-08-01T18:00:00Z'));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ changed: true, status: 'LIVE' }),
        }));
    });

    afterEach(() => {
        cleanup();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('opens doors with one glanceable action', async () => {
        render(<SessionLifecycleControl
            sessionId="event-1"
            initialStatus="SCHEDULED"
            scheduledAt="2026-08-01T18:00:00Z"
            role="FACILITATOR"
        />);
        fireEvent.click(screen.getByRole('button', { name: 'Open doors' }));
        await screen.findByText('Doors are open. Attendees are entering now.');
        expect(fetch).toHaveBeenCalledWith(
            '/api/ops/sessions/event-1/lifecycle',
            expect.objectContaining({ method: 'POST' }),
        );
    });

    it('requires explicit confirmation before closing', async () => {
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: async () => ({
                changed: true,
                status: 'ENDED',
                termination: { complete: true, stageDisconnected: 3, bedDisconnected: 2 },
            }),
        } as Response);
        render(<SessionLifecycleControl
            sessionId="event-1"
            initialStatus="LIVE"
            scheduledAt="2026-08-01T18:00:00Z"
            role="FACILITATOR"
        />);
        fireEvent.click(screen.getByRole('button', { name: 'Close event' }));
        expect(fetch).not.toHaveBeenCalled();
        expect(screen.getByText(/every Stage connection/)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'End & disconnect everyone' }));
        await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        expect(await screen.findByText('Event ended now. Disconnected 3 Stage and 2 Beacon connections.')).toBeInTheDocument();
    });

    it('offers an idempotent disconnect retry after the event is closed', async () => {
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: async () => ({
                changed: false,
                status: 'ENDED',
                termination: { complete: true, stageDisconnected: 1, bedDisconnected: 1 },
            }),
        } as Response);
        render(<SessionLifecycleControl
            sessionId="event-1"
            initialStatus="ENDED"
            scheduledAt="2026-08-01T18:00:00Z"
            role="OPERATOR"
        />);

        fireEvent.click(screen.getByRole('button', { name: 'Disconnect remaining clients' }));
        fireEvent.click(screen.getByRole('button', { name: 'End & disconnect everyone' }));

        await screen.findByText('Event ended now. Disconnected 1 Stage and 1 Beacon connections.');
        expect(fetch).toHaveBeenCalledWith(
            '/api/ops/sessions/event-1/lifecycle',
            expect.objectContaining({ body: JSON.stringify({ status: 'ENDED' }) }),
        );
    });

    it('retries a cancelled event without attempting an invalid ENDED transition', async () => {
        vi.mocked(fetch).mockResolvedValue({
            ok: true,
            json: async () => ({
                changed: false,
                status: 'CANCELLED',
                termination: { complete: true, stageDisconnected: 0, bedDisconnected: 2 },
            }),
        } as Response);
        render(<SessionLifecycleControl
            sessionId="event-1"
            initialStatus="CANCELLED"
            scheduledAt="2026-08-01T18:00:00Z"
            role="FACILITATOR_OP"
        />);

        fireEvent.click(screen.getByRole('button', { name: 'Disconnect remaining clients' }));
        fireEvent.click(screen.getByRole('button', { name: 'End & disconnect everyone' }));

        await screen.findByText('Event cancelled now. Disconnected 0 Stage and 2 Beacon connections.');
        expect(fetch).toHaveBeenCalledWith(
            '/api/ops/sessions/event-1/lifecycle',
            expect.objectContaining({ body: JSON.stringify({ status: 'CANCELLED' }) }),
        );
    });

    it('does not offer an unauthorized cancellation retry to an operator', () => {
        render(<SessionLifecycleControl
            sessionId="event-1"
            initialStatus="CANCELLED"
            scheduledAt="2026-08-01T18:00:00Z"
            role="OPERATOR"
        />);

        expect(screen.queryByRole('button', { name: 'Disconnect remaining clients' })).not.toBeInTheDocument();
    });

    it('blocks non-admin staff outside the opening window', () => {
        render(<SessionLifecycleControl
            sessionId="event-1"
            initialStatus="SCHEDULED"
            scheduledAt="2026-08-02T18:00:00Z"
            role="OPERATOR"
        />);
        expect(screen.getByRole('button', { name: 'Open doors' })).toBeDisabled();
        expect(screen.getByText(/Doors can open from 10 minutes before/)).toBeInTheDocument();
    });

    it('lets an admin provide an audited override reason', () => {
        render(<SessionLifecycleControl
            sessionId="event-1"
            initialStatus="SCHEDULED"
            scheduledAt="2026-08-02T18:00:00Z"
            role="ADMIN"
        />);
        expect(screen.getByRole('button', { name: 'Open doors' })).toBeDisabled();
        expect(screen.getByLabelText(/Operational reason/)).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText(/Operational reason/), {
            target: { value: 'Approved rehearsal' },
        });
        expect(screen.getByRole('button', { name: 'Open doors' })).toBeEnabled();
    });

    it('lets FACILITATOR_OP provide the same audited override reason', () => {
        render(<SessionLifecycleControl
            sessionId="event-1"
            initialStatus="SCHEDULED"
            scheduledAt="2026-08-02T18:00:00Z"
            role="FACILITATOR_OP"
        />);
        fireEvent.change(screen.getByLabelText(/Operational reason/), {
            target: { value: 'Approved rehearsal' },
        });
        expect(screen.getByRole('button', { name: 'Open doors' })).toBeEnabled();
    });

    it('adopts status observed by another operator without a reload', async () => {
        const { rerender } = render(<SessionLifecycleControl
            sessionId="event-1"
            initialStatus="SCHEDULED"
            observedStatus="SCHEDULED"
            scheduledAt="2026-08-01T18:00:00Z"
            role="OPERATOR"
        />);
        expect(screen.getByRole('button', { name: 'Open doors' })).toBeInTheDocument();

        rerender(<SessionLifecycleControl
            sessionId="event-1"
            initialStatus="SCHEDULED"
            observedStatus="LIVE"
            scheduledAt="2026-08-01T18:00:00Z"
            role="OPERATOR"
        />);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Close event' })).toBeInTheDocument());
    });
});
