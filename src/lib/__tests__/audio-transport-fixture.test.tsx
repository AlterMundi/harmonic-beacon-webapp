// @vitest-environment jsdom
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JoinRequest, WrappedJoinRequest } from '@livekit/protocol';
import type { Page, TestInfo } from '@playwright/test';
import ThumbnailSender from '@/components/session/ThumbnailSender';
import { LocaleProvider } from '@/context/LocaleContext';
import { assertDeniedThumbnailCapture } from '../../../e2e/helpers/denied-capture';

// Execute the actual registered transport test, not a duplicate of its flow.
// Only browser/transport seams are doubles. ThumbnailSender and the capture,
// readiness and native-source assertions are real; synthetic clocks/streams
// here are NOT browser, RTP, SDK-resume or acoustic qualification.
const harness = vi.hoisted(() => ({
    tests: new Map<string, (args: { page: Page }, info: TestInfo) => Promise<void>>(),
    snapshot: {} as Record<string, unknown>,
    join: async () => {},
    sever: async () => ({ closed: 2, codes: [4000, 4000] }),
}));
vi.mock('@playwright/test', () => {
    const register = Object.assign((name: string, run: (args: { page: Page }, info: TestInfo) => Promise<void>) => {
        harness.tests.set(name, run);
    }, {
        extend: () => register,
        describe: (_name: string, run: () => void) => run(),
        afterEach: () => {}, slow: () => {}, info: () => ({ annotations: [] }),
    });
    const assertion = Object.assign((value: unknown) => {
        if (value && typeof value === 'object' && 'attribute' in value) {
            const locator = value as { attribute: (name: string) => string; count: () => number };
            return {
                toHaveAttribute: async (name: string, expected: string | RegExp) => {
                    if (expected instanceof RegExp) expect(locator.attribute(name)).toMatch(expected);
                    else expect(locator.attribute(name)).toBe(expected);
                },
                toHaveCount: async (count: number) => expect(locator.count()).toBe(count),
                not: { toHaveAttribute: async (name: string, expected: string) => expect(locator.attribute(name)).not.toBe(expected) },
            };
        }
        return expect(value);
    }, {
        poll: (read: () => unknown | Promise<unknown>) => ({
            toBe: async (expected: unknown) => expect(await read()).toBe(expected),
        }),
    });
    return { test: register, expect: assertion };
});
vi.mock('../../../e2e/fixtures/stack', () => ({ probeStack: vi.fn() }));
vi.mock('../../../e2e/fixtures/database-url', () => ({ assertSafeFixtureDatabaseUrl: vi.fn() }));
vi.mock('../../../e2e/fixtures/db', () => ({ withSessionStatus: vi.fn() }));
vi.mock('../../../e2e/fixtures/auth', () => ({ loginViaDashboard: () => harness.join() }));
vi.mock('../../../e2e/fixtures/audio-publishers', () => ({ startAudioPublishers: vi.fn() }));
vi.mock('../../../e2e/helpers/media-probe', () => ({
    installMediaProbe: vi.fn(),
    mediaProbeSnapshot: async () => structuredClone(harness.snapshot),
    expectMediaContinuity: vi.fn(),
}));
vi.mock('../../../e2e/helpers/signaling-loss', () => ({
    retainSignalingSockets: () => { window.fixtureSeverSignaling = () => harness.sever(); },
}));
import '../../../e2e/tests/audio-activation.spec';

afterEach(() => { cleanup(); document.body.replaceChildren(); vi.restoreAllMocks(); });

type Recovery = 'v1-resume' | 'resume' | 'full-rejoin' | 'no-resume' | 'one-room' | 'extra-capture' | 'duplicate-source' | 'replaced-peers' | 'truncated-history';
async function exercise(recovery: Recovery = 'resume', lostState = 'reconnecting') {
    let state = 'connected';
    const nativeCapture = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: nativeCapture } });
    const thumbnail = (connected: boolean) => <LocaleProvider initialLocale="en">
        <ThumbnailSender sessionId="fixture-session" connected={connected} isPublishing={false} />
    </LocaleProvider>;
    let view: ReturnType<typeof render>;
    harness.join = async () => {
        view = render(thumbnail(true));
        await waitFor(() => assertDeniedThumbnailCapture(window.fixtureDeniedCapture(), 1));
        for (const id of ['beacon-track', 'stage-track']) {
            const audio = document.createElement('audio');
            let clock = 0;
            Object.defineProperties(audio, {
                paused: { get: () => false },
                currentTime: { get: () => ++clock },
                srcObject: { value: { getAudioTracks: () => [{ id }] }, configurable: true },
            });
            document.body.append(audio);
        }
    };
    harness.snapshot = {
        peerConnectionsCreated: 4, peerConnectionsClosed: 0,
        livekitSocketsOpened: 2, livekitSocketsClosed: 0,
        livekitSocketUrls: ['ws://fixture/rtc?access_token=redacted-a', 'ws://fixture/rtc?access_token=redacted-b'],
        duplicateMediaSources: [], audioElements: 2,
    };
    const offline = vi.fn(async (value: boolean) => {
        state = value ? lostState : 'connected';
        if (value) { view.rerender(thumbnail(true)); return; }
        if (recovery === 'full-rejoin') {
            view.rerender(thumbnail(false));
            view.rerender(thumbnail(true));
            harness.snapshot.peerConnectionsClosed = 2;
            harness.snapshot.peerConnectionsCreated = 6;
        } else {
            // SDK Reconnecting/Resumed never changes the app's connected prop.
            view.rerender(thumbnail(true));
        }
        const urls = harness.snapshot.livekitSocketUrls as string[];
        if (recovery !== 'no-resume') {
            urls.push(`ws://fixture/rtc?${recovery === 'full-rejoin' ? '' : 'reconnect=1&sid=PA_stage'}`);
            if (recovery !== 'one-room') urls.push('ws://fixture/rtc?reconnect=1&sid=PA_beacon');
            harness.snapshot.livekitSocketsOpened = urls.length;
        }
        if (recovery === 'v1-resume') {
            urls.splice(2);
            for (const participantSid of ['PA_stage', 'PA_beacon']) {
                const wrapped = new WrappedJoinRequest({ joinRequest: new JoinRequest({ reconnect: true, participantSid }).toBinary() });
                urls.push(`ws://fixture/rtc/v1?join_request=${encodeURIComponent(Buffer.from(wrapped.toBinary()).toString('base64'))}`);
            }
        }
        if (recovery === 'replaced-peers') harness.snapshot.peerConnectionsCreated = 6;
        if (recovery === 'truncated-history') harness.snapshot.livekitSocketsOpened = 21;
        if (recovery === 'extra-capture') {
            await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 320, facingMode: { ideal: 'user' } }, audio: false }).catch(() => {});
        }
        if (recovery === 'duplicate-source') {
            Object.defineProperty(document.querySelectorAll('audio')[1], 'srcObject', {
                value: { getAudioTracks: () => [{ id: 'beacon-track' }] },
            });
        }
    });
    harness.sever = async () => {
        await offline(true);
        return { closed: 2, codes: [4000, 4000] };
    };
    const audioLocator = {
        attribute: () => '', count: () => document.querySelectorAll('audio').length,
        evaluateAll: async (run: (elements: Element[], arg?: unknown) => unknown, arg?: unknown) => run([...document.querySelectorAll('audio')], arg),
    };
    const page = {
        addInitScript: async (run: () => void) => run(),
        context: () => ({ setOffline: () => { throw new Error('setOffline cannot establish this fault'); } }),
        evaluate: async (run: () => unknown) => run(),
        getByTestId: () => ({ attribute: (name: string) => {
            const observed = state;
            if (state !== 'connected') void offline(false);
            return name === 'data-state' ? observed : 'ready';
        }, count: () => 1 }),
        getByRole: () => ({ attribute: () => '', count: () => 0, isVisible: async () => false }),
        getByText: () => ({ attribute: () => '', count: () => 0 }),
        locator: () => audioLocator,
    } as unknown as Page;
    const attach = vi.fn();
    const run = [...harness.tests].find(([name]) => name.startsWith('transport recovery'))?.[1];
    expect(run).toBeDefined();
    try {
        await run!({ page }, { attach } as unknown as TestInfo);
        assertDeniedThumbnailCapture(window.fixtureDeniedCapture(), 1);
        expect(nativeCapture).not.toHaveBeenCalled();
        expect(offline.mock.calls).toEqual([[true], [false]]);
        // Receipts must never disclose signaling URLs/tokens.
        for (const [, receipt] of attach.mock.calls) {
            const parsed = JSON.parse(receipt.body);
            if ('livekitSocketUrls' in parsed) expect(parsed.livekitSocketUrls).toEqual([]);
            expect(receipt.body).not.toContain('access_token');
        }
    } finally {
        expect(offline.mock.calls.at(-1)).toEqual([false]);
    }
}

describe('transport recovery fixture chooses SDK resume, not a new thumbnail lifecycle', () => {
    it('recognizes SDK 2.17 rtc/v1 wire resume with two distinct SIDs, not just legacy query parameters', async () => {
        await exercise('v1-resume');
    });
    it.each(['reconnecting', 'signalReconnecting'])('accepts both-room SDK resume from %s with exactly the original denied capture', async (state) => {
        await exercise('resume', state);
    });
    it.each<Recovery>(['full-rejoin', 'no-resume', 'one-room', 'truncated-history'])('rejects %s instead of treating it as qualified SDK resume', async (recovery) => {
        await expect(exercise(recovery)).rejects.toThrow('expected false to be true');
    });
    it('rejects peer replacement even if the socket URLs claim resume', async () => {
        await expect(exercise('replaced-peers')).rejects.toThrow('expected 6 to be 4');
    });
    it('rejects a second capture during SDK resume', async () => {
        await expect(exercise('extra-capture')).rejects.toThrow('expected 2 to be 1');
    });
    it('still requires two distinct native tracks after recovery', async () => {
        await expect(exercise('duplicate-source')).rejects.toThrow('expected 1 to be 2');
    });
    it('rejects disconnected rather than accepting any non-connected state, restoring networking in finally', async () => {
        await expect(exercise('resume', 'disconnected')).rejects.toThrow('to match');
    });
});
