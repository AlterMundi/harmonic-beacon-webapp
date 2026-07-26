// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TakeDownDialog from '../TakeDownDialog';

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

const PUBLISHED_RESPONSE = {
    takenDown: true,
    withdrawnFromReview: false,
    meditation: { id: 'med-1', status: 'APPROVED', isPublished: true, isHidden: true },
    retained: [
        'The meditation record is kept, not deleted.',
        'The audio file is not purged.',
        'Listeners who favourited it keep the entry in their favourites list. It no longer plays.',
    ],
};

const WITHDRAWN_RESPONSE = {
    takenDown: true,
    withdrawnFromReview: true,
    meditation: { id: 'med-1', status: 'PENDING', isPublished: false, isHidden: true },
    retained: [
        'The meditation record is kept, not deleted.',
        'The audio file is not purged.',
        'This meditation was not published, so the takedown is a withdrawal from review.',
    ],
};

function renderDialog(props: Partial<React.ComponentProps<typeof TakeDownDialog>> = {}) {
    const onClose = vi.fn();
    const onTakenDown = vi.fn();
    render(
        <TakeDownDialog
            meditationId="med-1"
            meditationTitle="Ocean Breathing"
            isPublished
            onClose={onClose}
            onTakenDown={onTakenDown}
            {...props}
        />
    );
    return { onClose, onTakenDown };
}

function mockFetch(response: unknown, ok = true) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok,
        json: async () => response,
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
}

async function confirmAndSubmit() {
    await userEvent.type(screen.getByLabelText('Type TAKE DOWN to confirm'), 'TAKE DOWN');
    await userEvent.click(screen.getByRole('button', { name: /^Take Down:/ }));
}

describe('TakeDownDialog accessibility', () => {
    it('is a modal dialog labelled by its heading', () => {
        renderDialog();
        const dialog = screen.getByRole('dialog');
        expect(dialog).toHaveAttribute('aria-modal', 'true');
        expect(dialog).toHaveAttribute('aria-labelledby', 'take-down-title');
    });

    it('autofocuses the confirmation input', () => {
        renderDialog();
        expect(screen.getByLabelText('Type TAKE DOWN to confirm')).toHaveFocus();
    });

    it('closes on Escape', async () => {
        const { onClose } = renderDialog();
        await userEvent.keyboard('{Escape}');
        expect(onClose).toHaveBeenCalled();
    });

    it('names the meditation in the confirm button, so the action is unambiguous', () => {
        renderDialog();
        expect(
            screen.getByRole('button', { name: 'Take Down: Ocean Breathing' })
        ).toBeInTheDocument();
    });
});

describe('TakeDownDialog confirmation gate', () => {
    it('keeps the destructive action disabled until the phrase is typed', async () => {
        renderDialog();
        const submit = screen.getByRole('button', { name: /^Take Down:/ });
        expect(submit).toBeDisabled();

        await userEvent.type(screen.getByLabelText('Type TAKE DOWN to confirm'), 'TAKE');
        expect(submit).toBeDisabled();

        await userEvent.type(screen.getByLabelText('Type TAKE DOWN to confirm'), ' DOWN');
        expect(submit).toBeEnabled();
    });

    it('does not call the endpoint while the gate is closed', async () => {
        const fetchMock = mockFetch(PUBLISHED_RESPONSE);
        renderDialog();
        await userEvent.click(screen.getByRole('button', { name: /^Take Down:/ }));
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('TakeDownDialog consequences', () => {
    it('warns before the request that the file is not deleted and restoring is not theirs', () => {
        renderDialog();
        expect(screen.getByText(/audio file is not deleted/i)).toBeInTheDocument();
        expect(screen.getByText(/cannot put it back yourself/i)).toBeInTheDocument();
    });

    it('tells a published meditation it leaves the catalogue immediately', () => {
        renderDialog();
        expect(screen.getByText(/leaves the catalogue immediately/i)).toBeInTheDocument();
    });

    it('renders the consequences the server reported, not a local paraphrase', async () => {
        mockFetch(PUBLISHED_RESPONSE);
        renderDialog();
        await confirmAndSubmit();

        await waitFor(() => {
            expect(
                screen.getByText('Listeners who favourited it keep the entry in their favourites list. It no longer plays.')
            ).toBeInTheDocument();
        });
    });
});

describe('TakeDownDialog withdrawal vs takedown', () => {
    it('calls an unpublished submission a withdrawal, not a takedown', () => {
        renderDialog({ isPublished: false });
        expect(
            screen.getByRole('heading', { name: 'Withdraw From Review' })
        ).toBeInTheDocument();
        expect(screen.getByText(/cannot be approved while it is down/i)).toBeInTheDocument();
    });

    it('reports the withdrawal outcome using the server flag', async () => {
        mockFetch(WITHDRAWN_RESPONSE);
        renderDialog({ isPublished: false });

        await userEvent.type(screen.getByLabelText('Type TAKE DOWN to confirm'), 'TAKE DOWN');
        await userEvent.click(screen.getByRole('button', { name: /^Withdraw From Review:/ }));

        await waitFor(() => {
            expect(
                screen.getByRole('heading', { name: 'Withdrawn From Review' })
            ).toBeInTheDocument();
        });
    });
});

describe('TakeDownDialog request', () => {
    it('DELETEs the meditation and hands the result back', async () => {
        const fetchMock = mockFetch(PUBLISHED_RESPONSE);
        const { onTakenDown } = renderDialog();

        await confirmAndSubmit();

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith('/api/provider/meditations/med-1', {
                method: 'DELETE',
            });
        });
        expect(onTakenDown).toHaveBeenCalledWith(PUBLISHED_RESPONSE);
    });

    it('surfaces a refusal instead of claiming success', async () => {
        mockFetch({ error: 'This meditation has already been taken down.' }, false);
        const { onTakenDown } = renderDialog();

        await confirmAndSubmit();

        await waitFor(() => {
            expect(screen.getByRole('alert')).toHaveTextContent(
                'This meditation has already been taken down.'
            );
        });
        expect(onTakenDown).not.toHaveBeenCalled();
    });
});
