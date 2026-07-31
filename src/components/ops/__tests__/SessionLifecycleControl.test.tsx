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
            json: async () => ({ changed: true, status: 'ENDED' }),
        } as Response);
        render(<SessionLifecycleControl
            sessionId="event-1"
            initialStatus="LIVE"
            scheduledAt="2026-08-01T18:00:00Z"
            role="FACILITATOR"
        />);
        fireEvent.click(screen.getByRole('button', { name: 'Close event' }));
        expect(fetch).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: 'Confirm close' }));
        await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
        expect(await screen.findByText('Event closed. Connected attendees will see the closing state.')).toBeInTheDocument();
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
});
