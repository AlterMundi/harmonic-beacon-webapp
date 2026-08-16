// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { LocaleProvider } from '@/context/LocaleContext';

import FreeInvitationRedeemer from '../FreeInvitationRedeemer';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('EarlyBird free invitation redeemer', () => {
    it('presents invitation access without claiming a paid membership', () => {
        render(
            <LocaleProvider initialLocale="en">
                <FreeInvitationRedeemer />
            </LocaleProvider>,
        );

        expect(screen.getByRole('heading', { name: 'Activate your Listener invitation.' })).toBeInTheDocument();
        expect(screen.getByText(/does not create a purchase or paid membership/)).toBeInTheDocument();
        expect(screen.queryByText(/same Listener access as a paid membership/)).not.toBeInTheDocument();
    });

    it('reports a network failure and re-enables redemption', async () => {
        const request = vi.fn().mockRejectedValue(new Error('network unavailable'));
        vi.stubGlobal('fetch', request);
        render(
            <LocaleProvider initialLocale="en">
                <FreeInvitationRedeemer />
            </LocaleProvider>,
        );

        await userEvent.click(screen.getByRole('button', { name: 'Activate invitation' }));

        expect(await screen.findByRole('alert')).toHaveTextContent('This invitation is unavailable.');
        expect(screen.getByRole('button', { name: 'Activate invitation' })).toBeEnabled();
        expect(request).toHaveBeenCalledWith('/api/listener/free/redeem', { method: 'POST' });
        expect(screen.getByRole('link', { name: 'Harmonic Beacon' })).toHaveAttribute('href', 'https://harmonicbeacon.com/');
        expect(JSON.stringify(request.mock.calls)).not.toContain('invitation-token');
    });
});
