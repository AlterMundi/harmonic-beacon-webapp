declare global {
    interface Window {
        fixtureSeverSignaling: () => Promise<{ closed: number; codes: number[] }>;
    }
}

/** Browser init-script. Keep real native WebSockets, including any passive
 * probe wrapper. A one-shot abnormal close severs BOTH actual signaling
 * connections; it does not change network flags, RTP, peers or SDK state.
 * SDK resume handshakes are allowed immediately (the fault self-releases).
 * Match only this fixture's LiveKit origin and public signaling paths. */
export function retainSignalingSockets(livekitOrigin: string): void {
    const origin = new URL(livekitOrigin).origin;
    const sockets = new Set<WebSocket>();
    const NativeWebSocket = window.WebSocket;
    const FaultWebSocket = function (url: string | URL, protocols?: string | string[]) {
        const socket = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);
        const target = new URL(String(url), location.href);
        if (target.origin === origin && /^\/rtc(?:\/v1)?$/.test(target.pathname)) {
            sockets.add(socket);
            socket.addEventListener('close', () => sockets.delete(socket), { once: true });
        }
        return socket;
    } as unknown as typeof WebSocket;
    FaultWebSocket.prototype = NativeWebSocket.prototype;
    Object.setPrototypeOf(FaultWebSocket, NativeWebSocket);
    window.WebSocket = FaultWebSocket;
    window.fixtureSeverSignaling = async () => {
        const open = [...sockets].filter(socket => socket.readyState === NativeWebSocket.OPEN);
        if (open.length !== 2) throw new Error('signaling fault requires exactly two open native sockets');
        // Register before closing: only actual browser close events are proof.
        const observed = open.map(socket => new Promise<number>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('native signaling close not observed')), 5000);
            socket.addEventListener('close', event => {
                clearTimeout(timeout);
                resolve(event.code);
            }, { once: true });
        }));
        for (const socket of open) socket.close(4000, 'E2E signaling loss');
        const codes = await Promise.all(observed);
        return { closed: codes.length, codes };
    };
}
