// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { retainSignalingSockets } from '../../../e2e/helpers/signaling-loss';

const NativeWebSocket = window.WebSocket;
class Socket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    readyState = 1;
    close = vi.fn((code: number) => {
        this.readyState = 2;
        queueMicrotask(() => {
            this.readyState = 3;
            this.dispatchEvent(new CloseEvent('close', { code }));
        });
    });
    constructor(readonly url: string | URL) { super(); }
}
afterEach(() => { window.WebSocket = NativeWebSocket; vi.restoreAllMocks(); });
function setup() {
    window.WebSocket = Socket as unknown as typeof WebSocket;
    retainSignalingSockets('ws://localhost:7880');
    return (window as unknown as { fixtureSeverSignaling?: () => Promise<{ closed: number; codes: number[] }> });
}

describe('one-shot native signaling loss, never SDK state simulation', () => {
    it('closes exactly both existing native signaling sockets with a non-normal code and observes their actual close events', async () => {
        const control = setup();
        const stage = new window.WebSocket('ws://localhost:7880/rtc/v1?access_token=not-recorded');
        const beacon = new window.WebSocket('ws://localhost:7880/rtc?access_token=not-recorded');
        const other = new window.WebSocket('ws://localhost:3100/unrelated');
        const wrongPath = new window.WebSocket('ws://localhost:7880/unrelated');
        expect(stage).toBeInstanceOf(Socket);
        expect(window.WebSocket.OPEN).toBe(1);
        expect(control.fixtureSeverSignaling).toBeTypeOf('function');
        expect(await control.fixtureSeverSignaling!()).toEqual({ closed: 2, codes: [4000, 4000] });
        expect(stage.close).toHaveBeenCalledWith(4000, 'E2E signaling loss');
        expect(beacon.close).toHaveBeenCalledWith(4000, 'E2E signaling loss');
        expect(other.close).not.toHaveBeenCalled();
        expect(wrongPath.close).not.toHaveBeenCalled();
        // The one-shot fault is released: new genuine sockets remain open.
        const resumed = new window.WebSocket('ws://localhost:7880/rtc/v1?join_request=not-recorded');
        expect(resumed.readyState).toBe(1);
        expect(resumed.close).not.toHaveBeenCalled();
    });
    it.each([0, 1, 3])('refuses %s eligible sockets before touching any transport', async count => {
        const control = setup();
        const sockets = Array.from({ length: count }, () => new window.WebSocket('ws://localhost:7880/rtc'));
        expect(control.fixtureSeverSignaling).toBeTypeOf('function');
        await expect(control.fixtureSeverSignaling!()).rejects.toThrow('exactly two');
        for (const socket of sockets) expect(socket.close).not.toHaveBeenCalled();
    });
});
