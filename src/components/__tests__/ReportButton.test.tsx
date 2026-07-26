// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ReportButton from '../ReportButton';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function renderButton(props: Partial<React.ComponentProps<typeof ReportButton>> = {}) {
    return render(
        <ReportButton
            targetType="MEDITATION"
            targetId="med-1"
            targetLabel="Ocean Breathing"
            {...props}
        />
    );
}

async function openDialog(props: Partial<React.ComponentProps<typeof ReportButton>> = {}) {
    renderButton(props);
    await userEvent.click(screen.getByRole('button', { name: /^Report/ }));
    return screen.getByRole('dialog');
}

describe('ReportButton trigger', () => {
    it('names what it reports, so several on a page stay distinguishable', () => {
        renderButton();
        expect(
            screen.getByRole('button', { name: 'Report meditation: Ocean Breathing' })
        ).toBeInTheDocument();
    });

    it('uses the target-type noun in the accessible name', () => {
        renderButton({ targetType: 'USER', targetId: 'user-9', targetLabel: 'Ana' });
        expect(screen.getByRole('button', { name: 'Report person: Ana' })).toBeInTheDocument();
    });

    it('does not render the dialog until the trigger is used', () => {
        renderButton();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
});

describe('ReportDialog', () => {
    it('is a labelled modal dialog', async () => {
        const dialog = await openDialog();
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAttribute('aria-labelledby', 'report-dialog-title');
        expect(screen.getByText('Report this meditation')).toBeInTheDocument();
    });

    it('autofocuses the first reason', async () => {
        await openDialog();
        expect(document.activeElement).toBe(screen.getByLabelText(/Safety/));
    });

    it('closes on Escape', async () => {
        await openDialog();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes on Cancel', async () => {
        await openDialog();
        await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('gates submit until a reason is chosen', async () => {
        await openDialog();
        const submit = screen.getByRole('button', { name: 'Send report' });
        expect(submit).toBeDisabled();

        await userEvent.click(screen.getByLabelText(/Medical or therapeutic claim/));
        expect(submit).not.toBeDisabled();
    });

    it('posts the targetType, targetId, reason and detail the endpoint expects', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 201,
            json: async () => ({ report: { id: 'r-1', status: 'OPEN', createdAt: '2026-07-26T00:00:00.000Z' } }),
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        await openDialog({ targetType: 'SESSION', targetId: 'sess-7', targetLabel: 'Evening Circle' });
        await userEvent.click(screen.getByLabelText(/Safety/));
        await userEvent.type(screen.getByLabelText(/Anything else/), 'Told a listener to stop their medication.');
        await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('/api/reports');
        expect(init.method).toBe('POST');
        expect(JSON.parse(init.body)).toEqual({
            targetType: 'SESSION',
            targetId: 'sess-7',
            reason: 'SAFETY',
            detail: 'Told a listener to stop their medication.',
        });
    });

    it('omits detail entirely when it is left blank', async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            status: 201,
            json: async () => ({ report: { id: 'r-1' } }),
        });
        global.fetch = fetchMock as unknown as typeof fetch;

        await openDialog();
        await userEvent.click(screen.getByLabelText(/Spam/));
        await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
            targetType: 'MEDITATION',
            targetId: 'med-1',
            reason: 'SPAM',
        });
    });

    it('says what happens next after a successful report, without promising a response time', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 201,
            json: async () => ({ report: { id: 'r-1' } }),
        }) as unknown as typeof fetch;

        await openDialog();
        await userEvent.click(screen.getByLabelText(/Safety/));
        await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

        await waitFor(() => expect(screen.getByText('Report received')).toBeInTheDocument());
        expect(screen.getByText(/in the moderation queue/i)).toBeInTheDocument();
        expect(screen.getByText(/A person reads every report/i)).toBeInTheDocument();
        // The 24h / 5 business day targets are unmeasured, so they must not appear.
        expect(screen.queryByText(/24 hours/i)).not.toBeInTheDocument();
        expect(screen.queryByText(/business day/i)).not.toBeInTheDocument();
    });

    it('renders a settled statement, not an error, when the report is a duplicate', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 409,
            json: async () => ({ error: 'You already have an open report against this target', reportId: 'r-0' }),
        }) as unknown as typeof fetch;

        await openDialog();
        await userEvent.click(screen.getByLabelText(/Safety/));
        await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

        await waitFor(() => expect(screen.getByText('Already reported')).toBeInTheDocument());
        expect(screen.getByText(/You have already reported this/i)).toBeInTheDocument();
        expect(screen.getByText(/Nothing more is needed from you/i)).toBeInTheDocument();
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('surfaces a real failure as an error and keeps the form open', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            json: async () => ({ error: 'Failed to file report' }),
        }) as unknown as typeof fetch;
        vi.spyOn(console, 'error').mockImplementation(() => { });

        await openDialog();
        await userEvent.click(screen.getByLabelText(/Safety/));
        await userEvent.click(screen.getByRole('button', { name: 'Send report' }));

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to file report'));
        expect(screen.getByRole('button', { name: 'Send report' })).toBeInTheDocument();
    });
});
