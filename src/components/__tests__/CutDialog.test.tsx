// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CutDialog from '../CutDialog';

afterEach(cleanup);

describe('CutDialog', () => {
    const defaultProps = {
        sessionId: 'session-1',
        inSeconds: 10,
        outSeconds: 70,
        mix: 0.8,
        onClose: vi.fn(),
        onSuccess: vi.fn(),
    };

    beforeEach(() => {
        vi.clearAllMocks();
        globalThis.fetch = vi.fn().mockImplementation((url: string) => {
            if (url === '/api/tags') {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        tags: {
                            MOOD: [{ id: 'tag-1', name: 'Calm', slug: 'calm' }],
                            TECHNIQUE: [{ id: 'tag-2', name: 'Breathing', slug: 'breathing' }],
                        },
                    }),
                });
            }
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ meditation: { id: 'med-1', title: 'Test' } }),
            });
        });
    });

    it('renders form with title and description fields', () => {
        render(<CutDialog {...defaultProps} />);
        expect(screen.getByPlaceholderText('Meditation title')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Optional description')).toBeInTheDocument();
    });

    it('displays In/Out/Duration labels', () => {
        render(<CutDialog {...defaultProps} />);
        expect(screen.getByText('In')).toBeInTheDocument();
        expect(screen.getByText('Out')).toBeInTheDocument();
        expect(screen.getByText('Duration')).toBeInTheDocument();
    });

    it('displays formatted time values', () => {
        render(<CutDialog {...defaultProps} />);
        // 10s = 0:10, 70s = 1:10, duration 60s = 1:00
        expect(screen.getByText('0:10')).toBeInTheDocument();
        expect(screen.getByText('1:10')).toBeInTheDocument();
        expect(screen.getByText('1:00')).toBeInTheDocument();
    });

    it('renders mix ratio info text', () => {
        render(<CutDialog {...defaultProps} />);
        expect(screen.getByText(/80% voice/)).toBeInTheDocument();
    });

    it('submit button shows "Create Cut"', () => {
        render(<CutDialog {...defaultProps} />);
        expect(screen.getByRole('button', { name: 'Create Cut' })).toBeInTheDocument();
    });

    it('submit button is disabled when title is empty', () => {
        render(<CutDialog {...defaultProps} />);
        expect(screen.getByRole('button', { name: 'Create Cut' })).toBeDisabled();
    });

    it('submit button is enabled when title has text', async () => {
        const user = userEvent.setup();
        render(<CutDialog {...defaultProps} />);
        await user.type(screen.getByPlaceholderText('Meditation title'), 'My Cut');
        expect(screen.getByRole('button', { name: 'Create Cut' })).not.toBeDisabled();
    });

    it('fetches tags on mount', async () => {
        await act(async () => {
            render(<CutDialog {...defaultProps} />);
        });
        expect(globalThis.fetch).toHaveBeenCalledWith('/api/tags');
    });

    it('renders fetched tags', async () => {
        await act(async () => {
            render(<CutDialog {...defaultProps} />);
        });
        await waitFor(() => {
            expect(screen.getByText('Calm')).toBeInTheDocument();
            expect(screen.getByText('Breathing')).toBeInTheDocument();
        });
    });

    it('submits form and calls onSuccess', async () => {
        const user = userEvent.setup();
        await act(async () => {
            render(<CutDialog {...defaultProps} />);
        });
        await user.type(screen.getByPlaceholderText('Meditation title'), 'My Meditation');
        await user.click(screen.getByRole('button', { name: 'Create Cut' }));

        await waitFor(() => {
            expect(defaultProps.onSuccess).toHaveBeenCalled();
        });
    });
});
