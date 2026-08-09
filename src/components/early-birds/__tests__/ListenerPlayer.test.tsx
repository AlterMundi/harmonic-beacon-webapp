// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { LocaleProvider } from '@/context/LocaleContext';

type HlsTestInstance = {
    destroy: ReturnType<typeof vi.fn>;
    loadedSources: string[];
    emitFatal(): void;
};

const hlsHarness = vi.hoisted(() => ({ instances: [] as HlsTestInstance[] }));
vi.mock('hls.js', () => {
    class TestHls {
        static Events = { ERROR: 'error' };
        static isSupported = () => true;
        liveSyncPosition: number | null = null;
        destroy = vi.fn();
        loadedSources: string[] = [];
        private errorHandler: ((_event: string, data: { fatal: boolean }) => void) | null = null;

        constructor() {
            hlsHarness.instances.push(this);
        }

        on(event: string, handler: (_event: string, data: { fatal: boolean }) => void) {
            if (event === TestHls.Events.ERROR) this.errorHandler = handler;
        }

        loadSource(url: string) {
            this.loadedSources.push(url);
        }

        attachMedia() {}

        emitFatal() {
            this.errorHandler?.('error', { fatal: true });
        }
    }
    return { default: TestHls };
});
import ListenerPlayer, {
    acceptsLeaseCursor,
    earlyBirdLeaseRecoveryDisposition,
    getOrCreateEarlyBirdDeviceId,
    LISTENER_HLS_BUFFER_CONFIG,
    LISTENER_PLAYBACK_PRESENCE_EVENT,
    nextPresenceSequence,
    prefersNativeHls,
    seekNativeAudioToLiveEdge,
} from '../ListenerPlayer';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    hlsHarness.instances.length = 0;
});

describe('EarlyBird Listener player', () => {
    it('keeps the connection identifier stable per tab without sharing it across tabs', () => {
        const first = getOrCreateEarlyBirdDeviceId(window.sessionStorage);
        const second = getOrCreateEarlyBirdDeviceId(window.sessionStorage);
        expect(second).toBe(first);
        expect(first.length).toBeGreaterThanOrEqual(16);

        const otherTab = new Map<string, string>();
        const otherTabStorage = {
            getItem: (key: string) => otherTab.get(key) ?? null,
            setItem: (key: string, value: string) => { otherTab.set(key, value); },
        } as Storage;
        expect(getOrCreateEarlyBirdDeviceId(otherTabStorage)).not.toBe(first);
        expect(window.localStorage.getItem('hb_earlybird_device_id')).toBeNull();
    });

    it('never accepts a reordered lease generation or presence sequence', () => {
        const current = {
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseGeneration: 4,
            presenceSequence: 7,
        };
        expect(acceptsLeaseCursor(current, { ...current, presenceSequence: 6 }, 3, 4)).toBe(false);
        expect(acceptsLeaseCursor(current, { ...current, leaseGeneration: 3 }, 3, 4)).toBe(false);
        expect(acceptsLeaseCursor(current, { ...current, presenceSequence: 8 }, 3, 4)).toBe(true);
        expect(acceptsLeaseCursor(current, { ...current, leaseGeneration: 5, presenceSequence: 0 }, 3, 4)).toBe(true);
        // Server generation is authoritative even if the corresponding HTTP
        // request started earlier and its response arrived last.
        expect(acceptsLeaseCursor(current, { ...current, leaseGeneration: 5 }, 5, 4)).toBe(true);
        expect(acceptsLeaseCursor(current, { ...current }, 5, 4)).toBe(false);
        expect(nextPresenceSequence('idle', 'listening', 7)).toBe(8);
        expect(nextPresenceSequence('listening', 'listening', 8)).toBe(8);
        expect(nextPresenceSequence('listening', 'idle', 8)).toBe(9);
    });

    it('resumes a native HLS element at the current live edge', () => {
        const audio = {
            currentTime: 12,
            seekable: {
                length: 1,
                end: () => 123.5,
            },
        } as unknown as HTMLAudioElement;
        expect(seekNativeAudioToLiveEdge(audio)).toBe(true);
        expect(audio.currentTime).toBe(123.25);
    });

    it('keeps a stability-first desktop HLS buffer without enabling low latency', () => {
        expect(LISTENER_HLS_BUFFER_CONFIG).toMatchObject({
            lowLatencyMode: false,
            liveSyncDurationCount: 5,
            liveMaxLatencyDurationCount: 10,
            maxBufferLength: 60,
            maxMaxBufferLength: 90,
        });
    });

    it('does not trust Chromium native HLS claims while preserving Apple native playback', () => {
        const audio = { canPlayType: () => 'maybe' } as unknown as HTMLAudioElement;
        expect(prefersNativeHls(audio, { vendor: 'Google Inc.' })).toBe(false);
        expect(prefersNativeHls(audio, { vendor: 'Apple Computer, Inc.' })).toBe(true);
    });

    it('treats only an explicit eviction as displacement', () => {
        expect(earlyBirdLeaseRecoveryDisposition({ reason: 'displaced' })).toBe('displaced');
        expect(earlyBirdLeaseRecoveryDisposition({ reason: 'expired' })).toBe('recoverable');
        expect(earlyBirdLeaseRecoveryDisposition({ reason: 'inactive' })).toBe('recoverable');
        expect(earlyBirdLeaseRecoveryDisposition(null)).toBe('recoverable');
    });

    it('refreshes the active lease and reattaches a fresh hls.js source after a fatal error', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
        const grants = [3, 4].map((suffix) => ({
            leaseId: `00000000-0000-4000-8000-00000000000${suffix}`,
            leaseExpiresAt: '2099-08-06T12:03:00.000Z',
            stream: {
                manifestUrl: `/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-00000000000${suffix}`,
                expiresAt: '2099-08-06T12:03:00.000Z',
            },
        }));
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(grants[0]), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(grants[0]), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(grants[1]), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(grants[1]), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        await waitFor(() => expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(1));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument());
        hlsHarness.instances[0].emitFatal();

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(2));
        expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/early-birds/stream/heartbeat');
        expect(hlsHarness.instances[0].destroy).toHaveBeenCalledOnce();
        expect(hlsHarness.instances[1].loadedSources).toEqual([grants[1].stream.manifestUrl]);
        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    });

    it('keeps the pre-attached iOS source lease alive before the first play gesture', async () => {
        const intervalCallbacks: Array<() => void | Promise<void>> = [];
        vi.spyOn(window, 'setInterval').mockImplementation((callback) => {
            intervalCallbacks.push(callback as () => void | Promise<void>);
            return intervalCallbacks.length as unknown as ReturnType<typeof window.setInterval>;
        });
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
        const manifestUrl = '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003';
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({
                leaseId: '00000000-0000-4000-8000-000000000003',
                leaseExpiresAt: '2099-08-06T12:03:00.000Z',
                stream: { manifestUrl, expiresAt: '2099-08-06T12:03:00.000Z' },
            }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                leaseExpiresAt: '2099-08-06T12:04:00.000Z',
                stream: { manifestUrl, expiresAt: '2099-08-06T12:04:00.000Z' },
            }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled());
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ intent: 'prepare' });

        await Promise.all(intervalCallbacks.map((callback) => callback()));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/early-birds/stream/heartbeat');
        expect(screen.getByRole('button', { name: 'Listen' })).toBeInTheDocument();
    });

    it('promotes a prepared generation by heartbeat and stops it with the next sequence', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
        const manifestUrl = '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003&leaseGeneration=1';
        const leaseGrant = {
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseGeneration: 1,
            presenceSequence: 0,
            leaseExpiresAt: '2099-08-06T12:03:00.000Z',
            stream: { manifestUrl, expiresAt: '2099-08-06T12:03:00.000Z' },
        };
        const heartbeat = (presenceSequence: number) => ({
            leaseGeneration: 1,
            presenceSequence,
            leaseExpiresAt: '2099-08-06T12:04:00.000Z',
            stream: { manifestUrl, expiresAt: '2099-08-06T12:04:00.000Z' },
        });
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(leaseGrant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(heartbeat(1)), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(heartbeat(2)), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const presenceEvents: string[] = [];
        const capturePresence = ((event: CustomEvent) => {
            presenceEvents.push(event.detail.presence);
        }) as EventListener;
        window.addEventListener(LISTENER_PLAYBACK_PRESENCE_EVENT, capturePresence);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        await waitFor(() => expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({ intent: 'prepare' });
        expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({
            leaseGeneration: 1,
            presenceSequence: 1,
            presence: 'listening',
        });
        expect(hlsHarness.instances).toHaveLength(1);
        expect(hlsHarness.instances[0].loadedSources).toEqual([manifestUrl]);

        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
            leaseGeneration: 1,
            presenceSequence: 2,
            presence: 'idle',
        });
        expect(presenceEvents).toEqual(['listening', 'idle']);
        window.removeEventListener(LISTENER_PLAYBACK_PRESENCE_EVENT, capturePresence);
    });

    it('fails closed on an immediate stale-cursor response without destructive reacquisition', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
        const manifestUrl = '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003&leaseGeneration=1';
        const grant = {
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseGeneration: 1,
            presenceSequence: 0,
            leaseExpiresAt: '2099-08-06T12:03:00.000Z',
            stream: { manifestUrl, expiresAt: '2099-08-06T12:03:00.000Z' },
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(grant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                error: 'Lease refresh required.',
                reason: 'refresh_required',
            }), { status: 409 }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        await waitFor(() => expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
            'The Beacon is unavailable right now.',
        ));
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            '/api/early-birds/stream/lease',
            '/api/early-birds/stream/heartbeat',
        ]);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('claims capacity without starting quota and activates the same claimed generation', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
        const manifestUrl = '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003&leaseGeneration=2';
        const claimGrant = {
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseGeneration: 2,
            presenceSequence: 0,
            leaseExpiresAt: '2099-08-06T12:03:00.000Z',
            stream: { manifestUrl, expiresAt: '2099-08-06T12:03:00.000Z' },
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ reason: 'device_limit' }), { status: 409 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(claimGrant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                ...claimGrant,
                presenceSequence: 1,
            }), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        await waitFor(() => expect(screen.getByText(
            'Two devices are already active. Enabling this one will stop playback on the least recent device.',
        )).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled());
        expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ intent: 'claim' });
        expect(fetchMock).toHaveBeenCalledTimes(2);

        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toMatchObject({
            leaseGeneration: 2,
            presenceSequence: 1,
            presence: 'listening',
        });
        expect(hlsHarness.instances).toHaveLength(1);
        expect(hlsHarness.instances[0].loadedSources).toEqual([manifestUrl]);
    });

    it('does not offer resume after a paused source loses preparation', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
        const grant = {
            leaseId: '00000000-0000-4000-8000-000000000005',
            leaseExpiresAt: '2099-08-06T12:03:00.000Z',
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000005',
                expiresAt: '2099-08-06T12:03:00.000Z',
            },
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(grant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(grant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(grant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                error: 'Listening lease expired.',
                reason: 'expired',
            }), { status: 410 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                error: 'Two devices are already active.',
                reason: 'device_limit',
            }), { status: 409 }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        await waitFor(() => expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument());
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        fireEvent(document, new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        fireEvent(document, new Event('visibilitychange'));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
        expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled();
        expect(screen.getByText('Two devices are already active. Enabling this one will stop playback on the least recent device.'))
            .toBeInTheDocument();
    });

    it('bounds automatic hls.js recovery attempts and ends in an honest unavailable state', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
        const initialGrant = {
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseExpiresAt: '2099-08-06T12:03:00.000Z',
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003',
                expiresAt: '2099-08-06T12:03:00.000Z',
            },
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(initialGrant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(initialGrant), { status: 200 }))
            .mockRejectedValue(new Error('synthetic outage'));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );
        await waitFor(() => expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(1));
        hlsHarness.instances[0].emitFatal();

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
            'The Beacon is unavailable right now.',
        ), { timeout: 5_500 });
        const boundedCallCount = fetchMock.mock.calls.length;
        expect(boundedCallCount).toBeLessThanOrEqual(6);
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
            'The Beacon is unavailable right now.',
        ));
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(fetchMock).toHaveBeenCalledTimes(boundedCallCount);
    }, 7_000);

    it('does not churn a healthy native stream on suspend and refreshes it after an error', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
        let lease = 2;
        const fetchMock = vi.fn().mockImplementation(() => {
            lease += 1;
            return Promise.resolve(new Response(JSON.stringify({
                leaseId: `00000000-0000-4000-8000-00000000000${lease}`,
                leaseExpiresAt: '2099-08-06T12:03:00.000Z',
                stream: {
                    manifestUrl: `/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-00000000000${lease}`,
                    expiresAt: '2099-08-06T12:03:00.000Z',
                },
            }), { status: 200 }));
        });
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );
        const live = screen.getByLabelText('Beacon');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument());

        vi.useFakeTimers();
        fireEvent.suspend(live);
        await vi.advanceTimersByTimeAsync(2_500);
        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(2);
        vi.useRealTimers();

        fireEvent.error(live);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 3_000 });
        expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/early-birds/stream/heartbeat');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument());
    });

    it('makes a displaced fatal recovery terminal without acquiring another lease', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
        const initialGrant = {
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseExpiresAt: '2099-08-06T12:03:00.000Z',
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003',
                expiresAt: '2099-08-06T12:03:00.000Z',
            },
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(initialGrant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(initialGrant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                error: 'Device displaced.',
                reason: 'displaced',
            }), { status: 410 }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        await waitFor(() => expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(1));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument());
        hlsHarness.instances[0].emitFatal();

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
            'This device was displaced because the account is already listening on two other devices.',
        ));
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            '/api/early-birds/stream/lease',
            '/api/early-birds/stream/heartbeat',
            '/api/early-birds/stream/heartbeat',
        ]);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('reacquires only after the recovery probe confirms that the lease expired', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
        const initialGrant = {
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseExpiresAt: '2099-08-06T12:03:00.000Z',
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003',
                expiresAt: '2099-08-06T12:03:00.000Z',
            },
        };
        const replacementGrant = {
            leaseId: '00000000-0000-4000-8000-000000000004',
            leaseExpiresAt: '2099-08-06T12:04:00.000Z',
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000004',
                expiresAt: '2099-08-06T12:04:00.000Z',
            },
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(initialGrant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(initialGrant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                error: 'Listening lease expired.',
                reason: 'expired',
            }), { status: 410 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(replacementGrant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(replacementGrant), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        await waitFor(() => expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(1));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument());
        hlsHarness.instances[0].emitFatal();

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            '/api/early-birds/stream/lease',
            '/api/early-birds/stream/heartbeat',
            '/api/early-birds/stream/heartbeat',
            '/api/early-birds/stream/lease',
            '/api/early-birds/stream/heartbeat',
        ]);
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(2));
        expect(hlsHarness.instances[1].loadedSources).toEqual([replacementGrant.stream.manifestUrl]);
        expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
    });

    it('does not strand a fatal hls.js signal raised while playback is still starting', async () => {
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        let finishFirstPlay: (() => void) | undefined;
        const firstPlay = new Promise<void>((resolve) => {
            finishFirstPlay = resolve;
        });
        vi.spyOn(HTMLMediaElement.prototype, 'play')
            .mockImplementationOnce(() => firstPlay)
            .mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
        const initialGrant = {
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseExpiresAt: '2099-08-06T12:03:00.000Z',
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003',
                expiresAt: '2099-08-06T12:03:00.000Z',
            },
        };
        const refreshedGrant = {
            leaseExpiresAt: '2099-08-06T12:04:00.000Z',
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003&refresh=1',
                expiresAt: '2099-08-06T12:04:00.000Z',
            },
        };
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify(initialGrant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(initialGrant), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(refreshedGrant), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        await waitFor(() => expect(screen.getByRole('button', { name: 'Listen' })).toBeEnabled());
        fireEvent.click(screen.getByRole('button', { name: 'Listen' }));
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(1));
        hlsHarness.instances[0].emitFatal();
        await waitFor(() => expect(screen.getByText('Restoring connection…')).toBeInTheDocument());
        finishFirstPlay?.();

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3), { timeout: 3_000 });
        // Presence promotion/refresh never replaces the prepared generation or
        // creates a second audio pipeline.
        expect(hlsHarness.instances).toHaveLength(1);
        await waitFor(() => expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument());
        expect(hlsHarness.instances[0].loadedSources).toEqual([initialGrant.stream.manifestUrl]);
    });
});
