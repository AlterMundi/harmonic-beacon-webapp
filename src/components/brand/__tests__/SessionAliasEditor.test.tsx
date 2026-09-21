// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocaleProvider } from '@/context/LocaleContext';
import SessionAliasEditor from '../SessionAliasEditor';

function attendeeEntry(sessionId: string, displayName = 'Ana') {
    return {
        identity: { kind: 'attendee', displayName, confirmed: true },
        session: { id: sessionId },
    };
}

function response(body: unknown, ok = true, status = 200) {
    return { ok, status, json: async () => body };
}

function editor(sessionId = 'event-1', locale: 'es' | 'en' = 'en') {
    return <LocaleProvider initialLocale={locale}>
        <SessionAliasEditor sessionId={sessionId} />
    </LocaleProvider>;
}

describe('SessionAliasEditor', () => {
    afterEach(() => {
        cleanup();
        localStorage.clear();
        document.cookie = 'hb_locale=; Path=/; Max-Age=0';
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('does not read entry identity until editing is explicitly requested', async () => {
        const fetchMock = vi.fn().mockResolvedValue(response(attendeeEntry('event-1')));
        vi.stubGlobal('fetch', fetchMock);
        render(editor());

        expect(fetchMock).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('menuitem', { name: 'Edit your name in this room' }));
        expect(await screen.findByRole('textbox', { name: 'Name in this room' })).toHaveValue('Ana');
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(fetchMock).toHaveBeenCalledWith('/api/scheduled-sessions/event-1/entry',
            expect.objectContaining({ method: 'GET', headers: { Accept: 'application/json' } }));
    });

    it('rejects staff, mismatched-session, and malformed entry responses', async () => {
        for (const body of [
            { identity: { kind: 'staff' }, session: { id: 'event-1' } },
            attendeeEntry('another-event'),
            { identity: { kind: 'attendee', displayName: 7, confirmed: true }, session: { id: 'event-1' } },
        ]) {
            const fetchMock = vi.fn().mockResolvedValue(response(body));
            vi.stubGlobal('fetch', fetchMock);
            const view = render(editor());
            fireEvent.click(screen.getByRole('menuitem', { name: 'Edit your name in this room' }));
            expect(await screen.findByRole('alert')).toHaveTextContent('We could not update your name');
            expect(screen.queryByRole('textbox')).toBeNull();
            view.unmount();
            vi.unstubAllGlobals();
        }
    });

    it('disables unchanged, empty, and in-flight submissions and supports cancel', async () => {
        let resolvePatch!: (value: ReturnType<typeof response>) => void;
        const patch = new Promise<ReturnType<typeof response>>((resolve) => { resolvePatch = resolve; });
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response(attendeeEntry('event-1')))
            .mockReturnValueOnce(patch);
        vi.stubGlobal('fetch', fetchMock);
        render(editor());
        fireEvent.click(screen.getByRole('menuitem', { name: 'Edit your name in this room' }));
        const input = await screen.findByRole('textbox', { name: 'Name in this room' });
        const save = screen.getByRole('button', { name: 'Save' });

        expect(save).toBeDisabled();
        fireEvent.change(input, { target: { value: '   ' } });
        expect(save).toBeDisabled();
        fireEvent.change(input, { target: { value: 'New alias' } });
        expect(save).toBeEnabled();
        fireEvent.click(save);
        expect(screen.getByRole('button', { name: 'Saving…' })).toBeDisabled();
        expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
        resolvePatch(response({ displayName: 'New alias', confirmed: true }));
        expect(await screen.findByRole('status')).toHaveTextContent('Name updated.');

        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(screen.getByRole('menuitem', { name: 'Edit your name in this room' })).toBeVisible();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('keeps concise localized errors for invalid and failed updates', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(response(attendeeEntry('event-1')))
            .mockResolvedValueOnce(response({ error: 'invalid_display_name' }, false, 400))
            .mockResolvedValueOnce(response({ displayName: 'not-confirmed', confirmed: false }));
        vi.stubGlobal('fetch', fetchMock);
        render(editor('event-1', 'es'));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Editar nombre en la sala' }));
        const input = await screen.findByRole('textbox', { name: 'Nombre en esta sala' });

        fireEvent.change(input, { target: { value: 'Otro nombre' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('Escribí un nombre');

        fireEvent.change(input, { target: { value: 'Otro nombre 2' } });
        fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
        expect(await screen.findByRole('alert')).toHaveTextContent('No pudimos actualizar tu nombre');
    });

    it('aborts and ignores an old GET when the active session changes', async () => {
        let resolveOld!: (value: ReturnType<typeof response>) => void;
        const oldRequest = new Promise<ReturnType<typeof response>>((resolve) => { resolveOld = resolve; });
        const fetchMock = vi.fn()
            .mockReturnValueOnce(oldRequest)
            .mockResolvedValueOnce(response(attendeeEntry('event-2', 'Current alias')));
        vi.stubGlobal('fetch', fetchMock);
        const view = render(editor('event-1'));
        fireEvent.click(screen.getByRole('menuitem', { name: 'Edit your name in this room' }));
        const oldSignal = fetchMock.mock.calls[0][1].signal as AbortSignal;

        view.rerender(editor('event-2'));
        expect(oldSignal.aborted).toBe(true);
        resolveOld(response(attendeeEntry('event-1', 'Stale alias')));
        await waitFor(() => expect(screen.getByRole('menuitem', { name: 'Edit your name in this room' })).toBeVisible());
        expect(screen.queryByDisplayValue('Stale alias')).toBeNull();

        fireEvent.click(screen.getByRole('menuitem', { name: 'Edit your name in this room' }));
        expect(await screen.findByDisplayValue('Current alias')).toBeVisible();
        expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/scheduled-sessions/event-2/entry',
            expect.objectContaining({ method: 'GET' }));
    });

    it('uses Escape as editor cancel without submitting', async () => {
        const fetchMock = vi.fn().mockResolvedValue(response(attendeeEntry('event-1')));
        vi.stubGlobal('fetch', fetchMock);
        render(editor());
        fireEvent.click(screen.getByRole('menuitem', { name: 'Edit your name in this room' }));
        const form = await screen.findByRole('form', { name: 'Edit your name in this room' });
        fireEvent.keyDown(form, { key: 'Escape' });
        expect(screen.getByRole('menuitem', { name: 'Edit your name in this room' })).toBeVisible();
        expect(fetchMock).toHaveBeenCalledOnce();
    });
});
