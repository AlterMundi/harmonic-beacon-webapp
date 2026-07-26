// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockBack = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ back: mockBack }),
}));

const mockSignOut = vi.fn();
vi.mock('next-auth/react', () => ({
    signOut: (...args: unknown[]) => mockSignOut(...args),
}));

const mockToastError = vi.fn();
vi.mock('sonner', () => ({
    toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

import SettingsPage from '../page';

afterEach(() => {
    cleanup();
    mockBack.mockClear();
    mockSignOut.mockClear();
    mockToastError.mockClear();
    vi.restoreAllMocks();
});

describe('SettingsPage', () => {
    it('renders the page header', () => {
        render(<SettingsPage />);
        expect(screen.getByText('App Settings')).toBeInTheDocument();
        expect(screen.getByText('Preferences & Config')).toBeInTheDocument();
    });

    it('renders General section with Language selector', () => {
        render(<SettingsPage />);
        expect(screen.getByText('General')).toBeInTheDocument();
        expect(screen.getByText('Language')).toBeInTheDocument();
    });

    it('renders About section with version', () => {
        render(<SettingsPage />);
        expect(screen.getByText('About')).toBeInTheDocument();
        expect(screen.getByText('Harmonic Beacon')).toBeInTheDocument();
        expect(screen.getByText('Version 1.0.0 (Alpha)')).toBeInTheDocument();
    });

    it('renders Privacy Policy and Terms links', () => {
        render(<SettingsPage />);
        expect(screen.getByText('Privacy Policy')).toBeInTheDocument();
        expect(screen.getByText('Terms of Service')).toBeInTheDocument();
    });

    it('has a language select with English and Español', () => {
        render(<SettingsPage />);
        const select = screen.getByRole('combobox') as HTMLSelectElement;
        expect(select.value).toBe('en');
        const options = Array.from(select.options).map(o => o.textContent);
        expect(options).toContain('English');
        expect(options).toContain('Español');
    });

    it('changes language when select changes', () => {
        render(<SettingsPage />);
        const select = screen.getByRole('combobox') as HTMLSelectElement;
        fireEvent.change(select, { target: { value: 'es' } });
        expect(select.value).toBe('es');
    });

    it('calls router.back() when back button is clicked', () => {
        render(<SettingsPage />);
        const buttons = screen.getAllByRole('button');
        // First button is the back button
        fireEvent.click(buttons[0]);
        expect(mockBack).toHaveBeenCalledOnce();
    });

    it('does not render Theme toggle or Notifications', () => {
        render(<SettingsPage />);
        expect(screen.queryByText('Theme')).not.toBeInTheDocument();
        expect(screen.queryByText('Push Notifications')).not.toBeInTheDocument();
    });
});

describe('SettingsPage - data export', () => {
    beforeEach(() => {
        vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:mock'), revokeObjectURL: vi.fn() });
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    });

    it('exports data via a credentialed fetch and downloads a blob', async () => {
        const blob = new Blob(['{}'], { type: 'application/json' });
        const headers = new Headers({
            'Content-Disposition': 'attachment; filename="harmonic-beacon-export-2026-07-26.json"',
        });
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            headers,
            json: async () => ({}),
            blob: async () => blob,
        }) as unknown as typeof fetch;

        render(<SettingsPage />);
        const exportButton = screen.getByRole('button', { name: 'Export' });
        fireEvent.click(exportButton);

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/users/me/export'));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Export' })).not.toBeDisabled());
        expect(URL.createObjectURL).toHaveBeenCalledWith(blob);
    });

    it('shows an error toast when the export request fails', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            headers: new Headers(),
            json: async () => ({ error: 'Failed to export account data' }),
        }) as unknown as typeof fetch;

        render(<SettingsPage />);
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));

        await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Failed to export account data'));
    });
});

describe('SettingsPage - account deletion', () => {
    async function openDialog() {
        render(<SettingsPage />);
        await userEvent.click(screen.getByRole('button', { name: 'Delete account' }));
        return screen.getByRole('dialog');
    }

    it('does not enable the confirm button until DELETE is typed', async () => {
        await openDialog();
        const confirmButton = screen.getByRole('button', { name: 'Permanently delete my account' });
        expect(confirmButton).toBeDisabled();

        const input = screen.getByLabelText('Type DELETE to confirm');
        await userEvent.type(input, 'delete');
        expect(confirmButton).toBeDisabled();

        await userEvent.clear(input);
        await userEvent.type(input, 'DELETE');
        expect(confirmButton).not.toBeDisabled();
    });

    it('renders the retained-data statements before confirming', async () => {
        await openDialog();
        expect(screen.getByText(/anonymised form/i)).toBeInTheDocument();
        expect(screen.getByText(/other listeners.* references it/i)).toBeInTheDocument();
        expect(screen.getByText(/Stored audio is not purged/i)).toBeInTheDocument();
        expect(screen.getByText(/anonymised provider record/i)).toBeInTheDocument();
    });

    it('closes on Escape', async () => {
        await openDialog();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        await userEvent.keyboard('{Escape}');
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('deletes the account and signs the user out, mirroring the endpoint response', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                deleted: true,
                deletedData: ['profile identifiers (email, name, avatar, identity-provider subject)'],
                retained: [
                    'Your account record is retained as an anonymised row.',
                    'Stored audio is not purged.',
                ],
                authoredContentCount: 0,
            }),
        }) as unknown as typeof fetch;

        await openDialog();
        await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
        await userEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));

        await waitFor(() => expect(global.fetch).toHaveBeenCalledWith('/api/users/me', { method: 'DELETE' }));
        await waitFor(() => expect(screen.getByText('Account Deleted')).toBeInTheDocument());
        expect(screen.queryByText(/You authored/)).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Sign Out' }));
        expect(mockSignOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
    });

    it('surfaces the authored-content warning when authoredContentCount > 0', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                deleted: true,
                deletedData: [],
                retained: [],
                authoredContentCount: 3,
            }),
        }) as unknown as typeof fetch;

        await openDialog();
        await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
        await userEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));

        await waitFor(() => expect(screen.getByText(/You authored 3 items/)).toBeInTheDocument());
    });

    it('shows an error and does not sign out when deletion fails', async () => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: false,
            json: async () => ({ error: 'Failed to delete account' }),
        }) as unknown as typeof fetch;

        await openDialog();
        await userEvent.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
        await userEvent.click(screen.getByRole('button', { name: 'Permanently delete my account' }));

        await waitFor(() => expect(screen.getByText('Failed to delete account')).toBeInTheDocument());
        expect(mockSignOut).not.toHaveBeenCalled();
    });
});
