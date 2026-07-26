// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import AdminReportsPage from '../page';

const HOUR = 60 * 60 * 1000;

function makeReport(overrides: Record<string, unknown> = {}) {
    return {
        id: 'r-1',
        targetType: 'MEDITATION',
        targetId: 'med-1',
        reason: 'SAFETY',
        detail: 'Told a listener to stop their medication.',
        status: 'OPEN',
        resolution: null,
        acknowledgedAt: null,
        resolvedAt: null,
        createdAt: new Date(Date.now() - 3 * HOUR).toISOString(),
        reporter: { id: 'u-1', name: 'Ana', email: 'ana@example.com' },
        handledBy: null,
        ...overrides,
    };
}

function mockList(reports: unknown[], counts: Record<string, number> = {}) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ reports, counts }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
}

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe('AdminReportsPage', () => {
    it('loads the OPEN queue by default and shows per-status counts', async () => {
        const fetchMock = mockList([makeReport()], { OPEN: 1, RESOLVED: 4 });
        render(<AdminReportsPage />);

        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith('/api/admin/reports?status=OPEN')
        );
        expect(await screen.findByText('Safety')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Resolved\s*4/ })).toBeInTheDocument();
    });

    it('drops the status parameter for the All filter', async () => {
        const fetchMock = mockList([]);
        render(<AdminReportsPage />);
        await waitFor(() => expect(fetchMock).toHaveBeenCalled());

        await userEvent.click(screen.getByRole('button', { name: 'All' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/reports'));
    });

    it('shows how long a report has been waiting', async () => {
        mockList([makeReport()]);
        render(<AdminReportsPage />);
        expect(await screen.findByText('Waiting 3h')).toBeInTheDocument();
    });

    it('marks an un-acknowledged report as such', async () => {
        mockList([makeReport()]);
        render(<AdminReportsPage />);
        expect(await screen.findByText('Not acknowledged')).toBeInTheDocument();
    });

    it('reports the acknowledgement latency once acknowledgedAt is stamped', async () => {
        const createdAt = new Date(Date.now() - 10 * HOUR).toISOString();
        mockList([
            makeReport({
                status: 'TRIAGED',
                createdAt,
                acknowledgedAt: new Date(Date.now() - 8 * HOUR).toISOString(),
                handledBy: { id: 'u-2', name: 'Admin', email: 'admin@example.com' },
            }),
        ]);
        render(<AdminReportsPage />);

        expect(await screen.findByText('Acknowledged after 2h')).toBeInTheDocument();
        expect(screen.queryByText('Not acknowledged')).not.toBeInTheDocument();
        expect(screen.getByText(/handled by Admin/)).toBeInTheDocument();
    });

    it('renders the reporter, target and detail an admin needs to act', async () => {
        mockList([makeReport()]);
        render(<AdminReportsPage />);

        expect(await screen.findByText('MEDITATION · med-1')).toBeInTheDocument();
        expect(screen.getByText(/by Ana/)).toBeInTheDocument();
        expect(
            screen.getByText('Told a listener to stop their medication.')
        ).toBeInTheDocument();
    });

    it('labels a report from a deleted reporter rather than showing a blank', async () => {
        mockList([makeReport({ reporter: null })]);
        render(<AdminReportsPage />);
        expect(await screen.findByText(/by Deleted account/)).toBeInTheDocument();
    });

    it('acknowledges an open report through PATCH, carrying the resolution note', async () => {
        const fetchMock = mockList([makeReport()]);
        render(<AdminReportsPage />);
        await screen.findByText('Safety');

        await userEvent.type(
            screen.getByLabelText('Resolution note for this report'),
            'Contacted the provider'
        );
        await userEvent.click(screen.getByRole('button', { name: 'Acknowledge' }));

        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith('/api/admin/reports/r-1', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'TRIAGED', resolution: 'Contacted the provider' }),
            })
        );
    });

    it('offers Resolve and Dismiss, and Reopen once a report has left OPEN', async () => {
        const fetchMock = mockList([makeReport({ status: 'RESOLVED', acknowledgedAt: new Date().toISOString() })]);
        render(<AdminReportsPage />);
        await screen.findByText('Safety');

        expect(screen.queryByRole('button', { name: 'Acknowledge' })).not.toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Reopen' }));

        await waitFor(() =>
            expect(fetchMock).toHaveBeenCalledWith('/api/admin/reports/r-1', {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: 'OPEN' }),
            })
        );
    });

    it('surfaces a failed triage instead of leaving a dead button', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce({ ok: true, json: async () => ({ reports: [makeReport()], counts: {} }) })
            .mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Failed to triage report' }) });
        global.fetch = fetchMock as unknown as typeof fetch;

        render(<AdminReportsPage />);
        await screen.findByText('Safety');
        await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));

        await waitFor(() =>
            expect(screen.getByRole('alert')).toHaveTextContent('Failed to triage report')
        );
    });

    it('shows an empty state when nothing is waiting', async () => {
        mockList([]);
        render(<AdminReportsPage />);
        expect(await screen.findByText('No reports awaiting triage')).toBeInTheDocument();
    });
});
