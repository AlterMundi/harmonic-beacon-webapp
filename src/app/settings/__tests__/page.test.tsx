// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

const mockBack = vi.fn();
vi.mock('next/navigation', () => ({
    useRouter: () => ({ back: mockBack }),
}));

import SettingsPage from '../page';

afterEach(() => {
    cleanup();
    mockBack.mockClear();
});

describe('SettingsPage', () => {
    it('renders the page header', () => {
        render(<SettingsPage />);
        expect(screen.getByText('App Settings')).toBeInTheDocument();
        expect(screen.getByText('Preferences & Config')).toBeInTheDocument();
    });

    it('renders General section with Theme and Language', () => {
        render(<SettingsPage />);
        expect(screen.getByText('General')).toBeInTheDocument();
        expect(screen.getByText('Theme')).toBeInTheDocument();
        expect(screen.getByText('Language')).toBeInTheDocument();
    });

    it('renders Notifications section', () => {
        render(<SettingsPage />);
        expect(screen.getByText('Notifications')).toBeInTheDocument();
        expect(screen.getByText('Push Notifications')).toBeInTheDocument();
        expect(screen.getByText('Alerts for new sessions')).toBeInTheDocument();
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

    it('toggles notification switch', () => {
        render(<SettingsPage />);
        const buttons = screen.getAllByRole('button');
        // The notification toggle is one of the buttons
        // Find the one that's in the Notifications section
        const notifToggle = buttons.find(b =>
            b.className.includes('rounded-full') && b.className.includes('w-11')
        );
        expect(notifToggle).toBeDefined();

        // Initially enabled (primary color)
        expect(notifToggle!.className).toContain('primary-600');

        // Click to disable
        fireEvent.click(notifToggle!);
        expect(notifToggle!.className).not.toContain('primary-600');

        // Click to re-enable
        fireEvent.click(notifToggle!);
        expect(notifToggle!.className).toContain('primary-600');
    });
});
