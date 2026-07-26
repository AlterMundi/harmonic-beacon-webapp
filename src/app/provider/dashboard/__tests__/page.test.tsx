// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import ProviderDashboard from '../page';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

interface MeditationOverrides {
    id?: string;
    title?: string;
    status?: string;
    isPublished?: boolean;
    isHidden?: boolean;
    takenDownAt?: string | null;
}

function meditation(overrides: MeditationOverrides = {}) {
    return {
        id: 'med-1',
        title: 'Ocean Breathing',
        description: null,
        durationSeconds: 600,
        status: 'APPROVED',
        isPublished: true,
        isFeatured: false,
        isHidden: false,
        takenDownAt: null,
        rejectionReason: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        playCount: 0,
        tags: [],
        ...overrides,
    };
}

/** The dashboard loads meditations and sessions in parallel on mount. */
function mockLoad(meditations: ReturnType<typeof meditation>[]) {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
        if (url === '/api/provider/meditations') {
            return Promise.resolve({ ok: true, json: async () => ({ meditations }) });
        }
        if (url === '/api/provider/sessions') {
            return Promise.resolve({ ok: true, json: async () => ({ sessions: [] }) });
        }
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
}

describe('ProviderDashboard takedown control', () => {
    it('offers a takedown on published content, named for the meditation', async () => {
        mockLoad([meditation()]);
        render(<ProviderDashboard />);

        await waitFor(() => {
            expect(
                screen.getByRole('button', { name: 'Take down: Ocean Breathing' })
            ).toBeInTheDocument();
        });
    });

    it('calls an unpublished submission a withdrawal', async () => {
        mockLoad([meditation({ status: 'PENDING', isPublished: false })]);
        render(<ProviderDashboard />);

        await waitFor(() => {
            expect(
                screen.getByRole('button', { name: 'Withdraw from review: Ocean Breathing' })
            ).toBeInTheDocument();
        });
    });

    it('offers nothing on content the Provider already took down', async () => {
        mockLoad([meditation({ isHidden: true, takenDownAt: '2026-07-20T00:00:00.000Z' })]);
        render(<ProviderDashboard />);

        await waitFor(() => expect(screen.getByText('Ocean Breathing')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /Take down:/ })).not.toBeInTheDocument();
    });

    it('offers nothing on content moderation hid — it is not the Provider’s to pull', async () => {
        mockLoad([meditation({ isHidden: true, takenDownAt: null })]);
        render(<ProviderDashboard />);

        await waitFor(() => expect(screen.getByText('Ocean Breathing')).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: /Take down:/ })).not.toBeInTheDocument();
    });
});

describe('ProviderDashboard visibility state', () => {
    it('shows nothing extra on visible content', async () => {
        mockLoad([meditation()]);
        render(<ProviderDashboard />);

        await waitFor(() => expect(screen.getByText('Ocean Breathing')).toBeInTheDocument());
        expect(screen.queryByText('Taken down by you')).not.toBeInTheDocument();
        expect(screen.queryByText('Hidden by moderation')).not.toBeInTheDocument();
    });

    it('attributes the Provider’s own takedown to them', async () => {
        mockLoad([meditation({ isHidden: true, takenDownAt: '2026-07-20T00:00:00.000Z' })]);
        render(<ProviderDashboard />);

        await waitFor(() => expect(screen.getByText('Taken down by you')).toBeInTheDocument());
    });

    it('calls their own withdrawal a withdrawal', async () => {
        mockLoad([
            meditation({
                status: 'PENDING',
                isPublished: false,
                isHidden: true,
                takenDownAt: '2026-07-20T00:00:00.000Z',
            }),
        ]);
        render(<ProviderDashboard />);

        await waitFor(() => expect(screen.getByText('Withdrawn by you')).toBeInTheDocument());
    });

    it('does not tell a Provider a moderation hide was their doing', async () => {
        mockLoad([meditation({ isHidden: true, takenDownAt: null })]);
        render(<ProviderDashboard />);

        await waitFor(() => expect(screen.getByText('Hidden by moderation')).toBeInTheDocument());
        expect(screen.queryByText('Taken down by you')).not.toBeInTheDocument();
    });
});

describe('ProviderDashboard after a takedown', () => {
    it('reflects the new state in the list without a reload', async () => {
        const fetchMock = mockLoad([meditation()]);
        render(<ProviderDashboard />);

        await waitFor(() =>
            expect(screen.getByRole('button', { name: 'Take down: Ocean Breathing' })).toBeInTheDocument()
        );

        fetchMock.mockImplementationOnce(() =>
            Promise.resolve({
                ok: true,
                json: async () => ({
                    takenDown: true,
                    withdrawnFromReview: false,
                    meditation: { id: 'med-1', status: 'APPROVED', isPublished: true, isHidden: true },
                    retained: ['The meditation record is kept, not deleted.'],
                }),
            })
        );

        await userEvent.click(screen.getByRole('button', { name: 'Take down: Ocean Breathing' }));
        await userEvent.type(screen.getByLabelText('Type TAKE DOWN to confirm'), 'TAKE DOWN');
        await userEvent.click(screen.getByRole('button', { name: 'Take Down: Ocean Breathing' }));

        await waitFor(() => expect(screen.getByText('Taken down by you')).toBeInTheDocument());

        await userEvent.click(screen.getByRole('button', { name: 'Done' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Take down: Ocean Breathing' })).not.toBeInTheDocument();
    });
});
