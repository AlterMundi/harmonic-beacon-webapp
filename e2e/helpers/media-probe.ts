import type { Frame, Page } from '@playwright/test';

/**
 * Browser media-continuity probe (issue #69 — media invariants).
 *
 * Injected before any app script runs (`addInitScript`), it observes the
 * platform surfaces that a room teardown, media duplication, or repeated
 * audio-activation gesture would necessarily touch — without modifying a
 * single line of the frozen audio code:
 *
 * - `Room.disconnect()` becomes observable as a LiveKit signaling WebSocket
 *   closing and/or an RTCPeerConnection closing.
 * - Duplicate media becomes observable as extra <audio>/<video> elements or
 *   the same track `src` attached twice concurrently.
 * - A repeated audio-activation gesture becomes observable as new
 *   `HTMLMediaElement.play()` bursts or AudioContext resume calls after the
 *   initial unlock.
 *
 * The probe is panel-agnostic: any flow (today's in-room controls, the #70
 * cockpit panels when they land) is exercised between two snapshots and the
 * diff is asserted. See `media-continuity.spec.ts` for the assertions and
 * e2e/README.md for the live-stack requirements.
 */

export interface MediaProbeSnapshot {
    /** <audio>/<video> elements currently in the document. */
    audioElements: number;
    videoElements: number;
    /** Cumulative counts since probe installation. */
    mediaElementsAttached: number;
    mediaElementsRemoved: number;
    maxConcurrentMediaElements: number;
    /** Track `src` values attached to more than one live element at once. */
    duplicateMediaSources: string[];
    /** User-gesture audio unlock evidence. */
    playCalls: number;
    audioContextsCreated: number;
    audioContextResumes: number;
    /** Room lifecycle evidence. */
    peerConnectionsCreated: number;
    peerConnectionsClosed: number;
    livekitSocketsOpened: number;
    livekitSocketsClosed: number;
    /** Cross-origin socket URLs observed (for diagnosis). */
    livekitSocketUrls: string[];
}

declare global {
    interface Window {
        __hbMediaProbe?: { snapshot: () => MediaProbeSnapshot };
    }
}

/** Install before navigation so every app script is observed. */
export async function installMediaProbe(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const state = {
            audioElements: 0,
            videoElements: 0,
            mediaElementsAttached: 0,
            mediaElementsRemoved: 0,
            maxConcurrentMediaElements: 0,
            playCalls: 0,
            audioContextsCreated: 0,
            audioContextResumes: 0,
            peerConnectionsCreated: 0,
            peerConnectionsClosed: 0,
            livekitSocketsOpened: 0,
            livekitSocketsClosed: 0,
            livekitSocketUrls: [] as string[],
        };
        const liveSources = new Map<string, number>();

        const currentTotal = () =>
            document.querySelectorAll('audio, video').length;

        const trackSource = (el: HTMLMediaElement, delta: number) => {
            const src = el.src || el.currentSrc;
            if (!src) return;
            const next = (liveSources.get(src) ?? 0) + delta;
            if (next <= 0) {
                liveSources.delete(src);
            } else {
                liveSources.set(src, next);
            }
        };

        const countSubtree = (root: Node, delta: number) => {
            if (root instanceof HTMLMediaElement) {
                const isAudio = root instanceof HTMLAudioElement;
                state.mediaElementsAttached += delta > 0 ? 1 : 0;
                state.mediaElementsRemoved += delta < 0 ? 1 : 0;
                if (isAudio) state.audioElements += delta;
                else state.videoElements += delta;
                trackSource(root, delta);
            }
            if (root instanceof Element) {
                root.querySelectorAll('audio, video').forEach((el) => countSubtree(el, delta));
            }
            state.maxConcurrentMediaElements = Math.max(
                state.maxConcurrentMediaElements,
                currentTotal(),
            );
        };

        const observer = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                mutation.addedNodes.forEach((node) => countSubtree(node, 1));
                mutation.removedNodes.forEach((node) => countSubtree(node, -1));
            }
        });
        // Init scripts run before the document element exists; media
        // elements only appear once app code mounts, so waiting for
        // DOMContentLoaded loses nothing.
        const attachObserver = () => {
            if (document.documentElement) {
                observer.observe(document.documentElement, { childList: true, subtree: true });
            } else {
                document.addEventListener('DOMContentLoaded', attachObserver, { once: true });
            }
        };
        attachObserver();

        const originalPlay = HTMLMediaElement.prototype.play;
        HTMLMediaElement.prototype.play = function play(...args) {
            state.playCalls += 1;
            return originalPlay.apply(this, args);
        };

        const NativeAudioContext =
            window.AudioContext ??
            (window as unknown as { webkitAudioContext?: typeof AudioContext })
                .webkitAudioContext;
        if (NativeAudioContext) {
            const originalResume = NativeAudioContext.prototype.resume;
            NativeAudioContext.prototype.resume = function resume(...args) {
                state.audioContextResumes += 1;
                return originalResume.apply(this, args);
            };
            const ProbeAudioContext = function (this: AudioContext, ...args: unknown[]) {
                state.audioContextsCreated += 1;
                return new NativeAudioContext(...(args as []));
            } as unknown as typeof AudioContext;
            ProbeAudioContext.prototype = NativeAudioContext.prototype;
            window.AudioContext = ProbeAudioContext;
        }

        if (window.RTCPeerConnection) {
            const NativeRTCPeerConnection = window.RTCPeerConnection;
            const originalClose = NativeRTCPeerConnection.prototype.close;
            NativeRTCPeerConnection.prototype.close = function close(...args) {
                state.peerConnectionsClosed += 1;
                return originalClose.apply(this, args);
            };
            const ProbeRTCPeerConnection = function (this: RTCPeerConnection, ...args: unknown[]) {
                state.peerConnectionsCreated += 1;
                return new NativeRTCPeerConnection(...(args as []));
            } as unknown as typeof RTCPeerConnection;
            ProbeRTCPeerConnection.prototype = NativeRTCPeerConnection.prototype;
            window.RTCPeerConnection = ProbeRTCPeerConnection;
        }

        const NativeWebSocket = window.WebSocket;
        const ProbeWebSocket = function (this: WebSocket, url: string | URL, ...rest: unknown[]) {
            const socket = new NativeWebSocket(url, ...(rest as []));
            // Count only cross-origin sockets: the app reaches LiveKit on a
            // different origin, while same-origin sockets (Next.js HMR in
            // dev) are not room signaling and must not pollute the count.
            // URL.origin is "null" for ws: schemes, so normalize to http
            // first.
            const origin = new URL(
                String(url).replace(/^ws/i, 'http'),
                location.href,
            ).origin;
            if (origin !== location.origin) {
                state.livekitSocketsOpened += 1;
                if (state.livekitSocketUrls.length < 20) {
                    state.livekitSocketUrls.push(String(url));
                }
                socket.addEventListener('close', () => {
                    state.livekitSocketsClosed += 1;
                });
            }
            return socket;
        } as unknown as typeof WebSocket;
        ProbeWebSocket.prototype = NativeWebSocket.prototype;
        for (const key of ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'] as const) {
            Object.defineProperty(ProbeWebSocket, key, { value: NativeWebSocket[key] });
        }
        window.WebSocket = ProbeWebSocket;

        window.__hbMediaProbe = {
            snapshot: () => ({
                ...state,
                audioElements: document.querySelectorAll('audio').length,
                videoElements: document.querySelectorAll('video').length,
                duplicateMediaSources: [...liveSources.entries()]
                    .filter(([, count]) => count > 1)
                    .map(([src]) => src),
            }),
        };
    });
}

export async function mediaProbeSnapshot(surface: Page | Frame): Promise<MediaProbeSnapshot> {
    return surface.evaluate(() => {
        const probe = window.__hbMediaProbe;
        if (!probe) {
            throw new Error('media probe not installed — call installMediaProbe before goto()');
        }
        return probe.snapshot();
    });
}

/**
 * The four issue #69 media invariants as a before/after assertion over a
 * flow (open panels, toggle controls) that must not disturb mounted media.
 * Fails with a diff of exactly which invariant broke.
 */
export function expectMediaContinuity(
    before: MediaProbeSnapshot,
    after: MediaProbeSnapshot,
): void {
    const problems: string[] = [];
    if (after.livekitSocketsClosed > before.livekitSocketsClosed) {
        problems.push(
            `signaling socket closed ${after.livekitSocketsClosed - before.livekitSocketsClosed} time(s) — equivalent to Room.disconnect()`,
        );
    }
    if (after.peerConnectionsClosed > before.peerConnectionsClosed) {
        problems.push(
            `RTCPeerConnection closed ${after.peerConnectionsClosed - before.peerConnectionsClosed} time(s)`,
        );
    }
    if (after.mediaElementsRemoved > before.mediaElementsRemoved) {
        problems.push(
            `${after.mediaElementsRemoved - before.mediaElementsRemoved} media element(s) detached`,
        );
    }
    if (after.duplicateMediaSources.length > 0) {
        problems.push(`duplicate media sources: ${after.duplicateMediaSources.join(', ')}`);
    }
    if (after.audioElements + after.videoElements !== before.audioElements + before.videoElements) {
        problems.push(
            `media element count changed from ${before.audioElements + before.videoElements} to ${after.audioElements + after.videoElements}`,
        );
    }
    if (after.playCalls > before.playCalls) {
        problems.push(
            `${after.playCalls - before.playCalls} extra play() call(s) — repeated audio activation`,
        );
    }
    if (after.audioContextResumes > before.audioContextResumes) {
        problems.push(
            `${after.audioContextResumes - before.audioContextResumes} extra AudioContext.resume() call(s)`,
        );
    }
    if (after.audioContextsCreated > before.audioContextsCreated) {
        problems.push(
            `${after.audioContextsCreated - before.audioContextsCreated} extra AudioContext(s) created`,
        );
    }
    if (problems.length > 0) {
        throw new Error(`media continuity violated:\n- ${problems.join('\n- ')}`);
    }
}
