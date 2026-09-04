// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LocaleProvider } from '@/context/LocaleContext';
import SessionIdentityGate from '@/components/session/SessionIdentityGate';

describe('SessionIdentityGate', () => {
    beforeEach(() => {
        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({ displayName: 'Anahí 李', confirmed: true }),
        }) as unknown as typeof fetch;
    });

    afterEach(() => {
        cleanup();
        vi.restoreAllMocks();
    });

    it('explains why the name is needed and confirms international characters', async () => {
        const onConfirmed = vi.fn();
        render(
            <LocaleProvider initialLocale="es">
                <SessionIdentityGate
                    sessionId="session-1"
                    sessionTitle="El Umbral"
                    initialDisplayName="Participante"
                    onConfirmed={onConfirmed}
                />
            </LocaleProvider>,
        );

        expect(screen.getByText('El Umbral')).toBeInTheDocument();
        expect(screen.getByText(/reconocerte cuando levantes la mano/i)).toBeInTheDocument();
        const input = screen.getByRole('textbox', { name: 'Tu nombre visible' });
        fireEvent.change(input, { target: { value: '  Anahí   李  ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirmar y continuar' }));

        await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith('Anahí 李'));
        expect(global.fetch).toHaveBeenCalledWith(
            '/api/scheduled-sessions/session-1/entry',
            expect.objectContaining({
                method: 'PATCH',
                body: JSON.stringify({ displayName: '  Anahí   李  ' }),
            }),
        );
    });

    it('keeps the attendee outside LiveKit and focuses an empty required name', () => {
        render(
            <LocaleProvider initialLocale="en">
                <SessionIdentityGate
                    sessionId="session-1"
                    sessionTitle="The Threshold"
                    initialDisplayName=""
                    onConfirmed={vi.fn()}
                />
            </LocaleProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }));
        const input = screen.getByRole('textbox', { name: 'Your visible name' });
        expect(input).toHaveFocus();
        expect(screen.getByRole('alert')).toHaveTextContent(/Enter a visible name/i);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('announces a server failure and allows retry without losing the draft', async () => {
        vi.mocked(global.fetch).mockResolvedValue({
            ok: false,
            status: 503,
            json: async () => ({ error: 'entry_unavailable' }),
        } as Response);
        render(
            <LocaleProvider initialLocale="en">
                <SessionIdentityGate
                    sessionId="session-1"
                    sessionTitle="The Threshold"
                    initialDisplayName="Annie"
                    onConfirmed={vi.fn()}
                />
            </LocaleProvider>,
        );

        fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Annie ✿' } });
        fireEvent.click(screen.getByRole('button', { name: 'Confirm and continue' }));

        expect(await screen.findByRole('alert')).toHaveTextContent(/could not save your name/i);
        expect(screen.getByRole('textbox')).toHaveValue('Annie ✿');
        expect(screen.getByRole('button', { name: 'Confirm and continue' })).toBeEnabled();
    });
});
