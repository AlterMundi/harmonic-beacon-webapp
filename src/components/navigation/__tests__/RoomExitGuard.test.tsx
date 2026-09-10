// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LocaleProvider } from '@/context/LocaleContext';
import { RoomExitProvider, useRoomExit, useStaffRoomExitBridge } from '../RoomExitGuard';
import { useRef } from 'react';
function Host() {
    const frame = useRef<HTMLIFrameElement>(null);
    useStaffRoomExitBridge(frame, 'event-1', true);
    return <iframe ref={frame} title="Room frame" />;
}
it('does not transfer an approved root departure bypass to a replacement document', async () => {
    render(<LocaleProvider initialLocale="en"><RoomExitProvider><Room leave={vi.fn()} /><Host /></RoomExitProvider></LocaleProvider>);
    const frame = screen.getByTitle('Room frame') as HTMLIFrameElement;
    const post = vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(() => {});
    const register = (doc: Document, generation: string) => {
        act(() => window.dispatchEvent(new CustomEvent('hb-room-exit-register', { detail: { source: frame.contentWindow, document: doc, sessionId: 'event-1', generation } })));
        const message = post.mock.calls.at(-1)![0];
        act(() => window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: frame.contentWindow, data: { ...message, event: 'state', active: true } })));
        return message;
    };
    const old = register(frame.contentDocument!, 'old');
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Leave the room' })); });
    const doc = document.implementation.createHTMLDocument('Replacement');
    Object.defineProperty(frame, 'contentDocument', { configurable: true, value: doc });
    fireEvent.load(frame);
    const fresh = register(doc, 'new');
    for (const data of [old, fresh]) {
        const query = new CustomEvent('hb-room-exit-unload-query', { cancelable: true, detail: { ...data, source: frame.contentWindow, document: doc } });
        window.dispatchEvent(query);
        expect(query.defaultPrevented).toBe(false);
    }
    const rootUnload = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(rootUnload);
    expect(rootUnload.defaultPrevented).toBe(true);
});

function Room({ leave, active = true }: { leave: () => void; active?: boolean }) {
    const requestExit = useRoomExit(active);
    return <button onClick={() => requestExit(leave)}>Exit</button>;
}
it('restores a clicked link even on browsers that do not focus links on pointer activation', () => {
    render(<LocaleProvider initialLocale="en"><RoomExitProvider><Room leave={vi.fn()} /><a href="/away">Away</a></RoomExitProvider></LocaleProvider>);
    const link = screen.getByRole('link', { name: 'Away' });
    fireEvent.click(link);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(link).toHaveFocus();
});
it('does not trap terminal or involuntarily disconnected rooms behind a pending choice', () => {
    const leave = vi.fn();
    const ui = (active: boolean) => <LocaleProvider initialLocale="en"><RoomExitProvider><Room leave={leave} active={active} /></RoomExitProvider></LocaleProvider>;
    const view = render(ui(true));
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(screen.getByRole('alertdialog')).toBeVisible();
    view.rerender(ui(false));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(leave).toHaveBeenCalledOnce();
});
it('coalesces pending and running exit requests into one confirmed action', async () => {
    let finish: () => void = () => {};
    const leave = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    render(<LocaleProvider initialLocale="en"><RoomExitProvider><Room leave={leave} /></RoomExitProvider></LocaleProvider>);
    const trigger = screen.getByRole('button', { name: 'Exit' });
    fireEvent.click(trigger); fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Leave the room' }));
    fireEvent.click(trigger);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(leave).toHaveBeenCalledOnce();
    await act(async () => { finish(); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it('requires deliberate localized confirmation; Escape keeps state and restores focus', async () => {
    const leave = vi.fn();
    render(<LocaleProvider initialLocale="en"><RoomExitProvider><Room leave={leave} /></RoomExitProvider></LocaleProvider>);
    const trigger = screen.getByRole('button', { name: 'Exit' });
    trigger.focus(); fireEvent.click(trigger);
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave the room?' });
    expect(leave).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Stay in the room' })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(trigger).toHaveFocus();
    expect(leave).not.toHaveBeenCalled();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'Leave the room' }));
    expect(leave).toHaveBeenCalledOnce();
});
