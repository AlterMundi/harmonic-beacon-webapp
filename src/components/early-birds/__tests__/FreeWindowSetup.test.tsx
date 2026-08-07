// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';
import type { SerializedEarlyBirdFreeWindowState } from '@/lib/early-birds/free-window';

import FreeWindowSetup from '../FreeWindowSetup';

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
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 400 })));
    });
    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it('offers immediate or chosen daily Free hours after registration', async () => {
        renderSetup();
        expect(screen.getByRole('heading', { name: 'Two hours of Beacon every day' })).toBeInTheDocument();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Listen free now' })).toBeEnabled());
        expect(screen.getByRole('button', { name: 'Choose another time' })).toBeEnabled();
    });

    it('submits a chosen wall-clock minute with the browser IANA zone', async () => {
        renderSetup();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Choose another time' })).toBeEnabled());
        await userEvent.click(screen.getByRole('button', { name: 'Choose another time' }));
        await userEvent.clear(screen.getByLabelText('Start time'));
        await userEvent.type(screen.getByLabelText('Start time'), '09:45');
        await userEvent.click(screen.getByRole('button', { name: 'Save my listening time' }));

        expect(fetch).toHaveBeenCalledOnce();
        const init = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
        expect(JSON.parse(init.body as string)).toMatchObject({
            mode: 'custom',
            localStartMinute: 9 * 60 + 45,
        });
        expect(JSON.parse(init.body as string).timeZone).toBeTruthy();
        expect(JSON.parse(init.body as string).selectionRequestId).toMatch(/^[0-9a-f-]{36}$/i);
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
        expect(screen.getByText('You can change this schedule')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Listen free now' })).not.toBeInTheDocument();
    });
});
