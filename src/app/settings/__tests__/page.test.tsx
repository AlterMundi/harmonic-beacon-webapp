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
