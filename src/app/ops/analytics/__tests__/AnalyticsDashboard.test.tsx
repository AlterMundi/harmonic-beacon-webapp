// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AnalyticsDashboard from '../AnalyticsDashboard';

const emptyDashboard = {
    generated_at: '2026-09-03T12:00:00Z',
    summary: {}, definitions: {},
    commerce: [], acquisition: [], geography: [], devices: [], pages: [], events: [],
    memberships: [], campaigns: [], health: [], quality: [], storage: [], series: [], cohorts: [],
    listener_activity: [], funnel: [], lifecycle: [],
};

describe('analytics dashboard calendar filters', () => {
    beforeEach(() => {
        vi.useFakeTimers({ shouldAdvanceTime: true });
        vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ current: emptyDashboard, previous: emptyDashboard }),
        }));
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.useRealTimers();
    });

    it('selects 30 inclusive local calendar days and exposes the timezone filter', async () => {
        render(<AnalyticsDashboard canExport={false} />);

        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
        expect(screen.getByLabelText('Timezone')).toHaveValue(timezone);
        expect(screen.getByLabelText('From')).toHaveValue('2026-08-05');
        expect(screen.getByLabelText('Through')).toHaveValue('2026-09-03');

        await waitFor(() => expect(fetch).toHaveBeenCalled());
        const requestUrl = String(vi.mocked(fetch).mock.calls.at(-1)?.[0]);
        const params = new URL(requestUrl, 'https://live.harmonicbeacon.com').searchParams;
        expect(params.get('start')).toBe('2026-08-05');
        expect(params.get('end')).toBe('2026-09-03');
        expect(params.get('timezone')).toBe(timezone);
        expect(params.get('compare')).toBe('previous');

        const callsBeforeEditing = vi.mocked(fetch).mock.calls.length;
        fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'America/New_York' } });
        expect(vi.mocked(fetch).mock.calls).toHaveLength(callsBeforeEditing);
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(callsBeforeEditing));
        const updated = new URL(String(vi.mocked(fetch).mock.calls.at(-1)?.[0]), 'https://live.harmonicbeacon.com');
        expect(updated.searchParams.get('timezone')).toBe('America/New_York');

        vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status: 400 } as Response);
        fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Mars/Olympus' } });
        fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Check the date range and IANA timezone');
    });
});
