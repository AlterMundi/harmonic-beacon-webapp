// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
vi.mock('@/context/LocaleContext', () => ({ useLocale: () => ({ locale: 'es' }) }));
import ParticipantIdentity from '../ParticipantIdentity';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Admin participant identity disclosure', () => {
    it('fetches only on opening and removes private data on closing', async () => {
        const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
            alias: 'Alias', identity: { profile: { realName: 'Nombre privado', preferredName: 'Preferido', email: 'synthetic@example.test', emailVerified: false } },
        }) });
        vi.stubGlobal('fetch', fetcher);
        const { container } = render(<ParticipantIdentity sessionId="event" participantId="participant" />);
        expect(fetcher).not.toHaveBeenCalled();
        const details = container.querySelector('details')!;
        details.open = true;
        fireEvent(details, new Event('toggle'));
        expect(await screen.findByText('Nombre privado')).toBeInTheDocument();
        expect(fetcher).toHaveBeenCalledWith('/api/ops/sessions/event/participants/participant/identity', expect.objectContaining({ cache: 'no-store' }));
        details.open = false;
        fireEvent(details, new Event('toggle'));
        await waitFor(() => expect(screen.queryByText('Nombre privado')).not.toBeInTheDocument());
    });
    it('does not display raw response errors', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 403 }));
        const { container } = render(<ParticipantIdentity sessionId="event" participantId="participant" />);
        const details = container.querySelector('details')!;
        details.open = true;
        fireEvent(details, new Event('toggle'));
        expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo consultar la cuenta.');
        expect(screen.queryByText('Nombre real (privado)')).not.toBeInTheDocument();
    });
});
