// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';
import type { SerializedEarlyBirdFreeWindowState } from '@/lib/early-birds/free-window';

import FreeWindowSetup from '../FreeWindowSetup';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const emptyState: SerializedEarlyBirdFreeWindowState = {
    configured: false,
    active: false,
    timeZone: null,
    localStartMinute: null,
    selectedAt: null,
    changeAllowedAt: null,
    canChange: true,
    activeStart: null,
    activeEnd: null,
    nextStart: null,
    nextEnd: null,
};

function renderSetup(state = emptyState) {
    return render(
        <LocaleProvider initialLocale="en">
            <FreeWindowSetup state={state} />
        </LocaleProvider>,
    );
}

describe('Free listening schedule UI', () => {
    beforeEach(() => {
        refresh.mockReset();
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('offers immediate or chosen daily Free hours after registration', async () => {
        renderSetup();
        expect(screen.getByRole('heading', { name: 'Your daily time · 2 hours' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Listen free now' })).toBeEnabled());
        expect(screen.getByRole('button', { name: 'Choose another time' })).toBeEnabled();
    });

    it('submits a chosen wall-clock minute with the browser IANA zone', async () => {
        renderSetup();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Choose another time' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Choose another time' }));
        expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
        await userEvent.clear(screen.getByLabelText('Start time'));
        await userEvent.type(screen.getByLabelText('Start time'), '09:45');
        await userEvent.click(screen.getByRole('button', { name: 'Save my listening time' }));

        expect(fetch).toHaveBeenCalledOnce();
        expect(vi.mocked(fetch).mock.calls[0][0]).toBe('/api/listener/free-window');
        const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
        expect(JSON.parse(init.body as string)).toMatchObject({
            mode: 'custom',
            localStartMinute: 9 * 60 + 45,
        });
        expect(JSON.parse(init.body as string).timeZone).toBeTruthy();
        expect(JSON.parse(init.body as string).selectionRequestId).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('can leave the custom chooser without changing the saved schedule', async () => {
        renderSetup();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Choose another time' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Choose another time' }));
        await userEvent.click(screen.getByRole('button', { name: 'Back' }));

        expect(screen.getByRole('button', { name: 'Listen free now' })).toBeEnabled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it('refreshes authoritative state without leaving the chooser busy after save', async () => {
        vi.mocked(fetch).mockResolvedValueOnce(new Response('{}', { status: 200 }));
        renderSetup();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Choose another time' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Choose another time' }));
        await userEvent.click(screen.getByRole('button', { name: 'Save my listening time' }));

        expect(refresh).toHaveBeenCalledOnce();
        expect(screen.getByRole('button', { name: 'Listen free now' })).toBeEnabled();
        expect(screen.queryByRole('button', { name: 'Back' })).not.toBeInTheDocument();
    });

    it('shows the next window and cooldown without offering a forbidden change', () => {
        renderSetup({
            ...emptyState,
            configured: true,
            timeZone: 'UTC',
            localStartMinute: 600,
            selectedAt: '2026-08-07T10:00:00.000Z',
            changeAllowedAt: '2026-08-14T10:00:00.000Z',
            canChange: false,
            nextStart: '2026-08-08T10:00:00.000Z',
            nextEnd: '2026-08-08T12:00:00.000Z',
        });

        expect(screen.getByText('Your next listening window begins')).toBeInTheDocument();
        expect(screen.getByText('Your daily time')).toBeInTheDocument();
        expect(screen.getByText(/10:00.*UTC/)).toBeInTheDocument();
        expect(screen.getByText('You can change this schedule')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Listen free now' })).not.toBeInTheDocument();
    });
});
