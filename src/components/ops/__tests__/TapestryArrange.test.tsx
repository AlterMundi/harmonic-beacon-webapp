// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { messages } from '@/lib/i18n';
import TapestryArrange from '../TapestryArrange';

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

describe('TapestryArrange', () => {
    it('renders and saves an arrangement in Spanish', async () => {
        const fetchMock = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => ({
            ok: true,
            status: 200,
            json: async () => init?.method === 'PUT' ? {} : { participants: ['one', 'two'] },
        }));
        vi.stubGlobal('fetch', fetchMock);

        render(
            <TapestryArrange
                sessionId="event-1"
                copy={messages.es.ops.tapestryArrange}
            />,
        );

        expect(await screen.findByAltText('Tesela 1 del tapiz')).toBeInTheDocument();
        await userEvent.click(screen.getByRole('button', { name: 'Mover tesela 1 a la derecha' }));
        await userEvent.click(screen.getByRole('button', { name: 'Guardar orden' }));

        await waitFor(() => {
            expect(fetchMock).toHaveBeenCalledWith(
                '/api/ops/sessions/event-1/tapestry',
                expect.objectContaining({ method: 'PUT' }),
            );
        });
        expect(screen.getAllByText('Guardado')).toHaveLength(2);
    });
});
