// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

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
    earlyBirdLeaseRecoveryDisposition,
    getOrCreateEarlyBirdDeviceId,
    seekNativeAudioToLiveEdge,
} from '../ListenerPlayer';

afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    hlsHarness.instances.length = 0;
});

describe('EarlyBird Listener player', () => {
    it('keeps the device identifier stable and device-local', () => {
        const first = getOrCreateEarlyBirdDeviceId(window.localStorage);
        const second = getOrCreateEarlyBirdDeviceId(window.localStorage);
        expect(second).toBe(first);
        expect(first.length).toBeGreaterThanOrEqual(16);
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

    it('treats only an explicit eviction as displacement', () => {
        expect(earlyBirdLeaseRecoveryDisposition({ reason: 'displaced' })).toBe('displaced');
        expect(earlyBirdLeaseRecoveryDisposition({ reason: 'expired' })).toBe('recoverable');
        expect(earlyBirdLeaseRecoveryDisposition({ reason: 'inactive' })).toBe('recoverable');
        expect(earlyBirdLeaseRecoveryDisposition(null)).toBe('recoverable');
    });

    it('renders both language controls and fails closed when renders are absent', () => {
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );
        expect(screen.getByRole('button', { name: 'Listen now' })).toBeInTheDocument();
        expect(screen.getByText('Warm-up · Spanish')).toBeInTheDocument();
        expect(screen.getByText('Warm-up · English')).toBeInTheDocument();
        expect(screen.getAllByText('The approved render has not been published yet.')).toHaveLength(2);
        expect(screen.getByText('Master volume')).toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Master volume' })).toHaveValue('1');
    });

    it('keeps the Beacon timeline, source and lease untouched while the intro pauses and ends', async () => {
        const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseExpiresAt: '2026-08-06T12:03:00.000Z',
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003',
                expiresAt: '2099-08-06T12:03:00.000Z',
            },
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);

        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{
                    es: 'https://media.example.test/reviewed-drop-es',
                    en: 'https://media.example.test/reviewed-drop-en',
                }} />
            </LocaleProvider>,
        );
        const live = screen.getByLabelText('Beacon 24/7') as HTMLAudioElement;
        const spanish = screen.getByLabelText('Warm-up · Spanish') as HTMLAudioElement;
        const spanishCard = spanish.closest('article')!;

        fireEvent.click(screen.getByRole('button', { name: 'Listen now' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument());
        const liveSource = live.src;
        const leaseRequests = fetchMock.mock.calls.length;
        const livePlayCalls = play.mock.instances.filter((instance) => instance === live).length;
        pause.mockClear();

        fireEvent.click(within(spanishCard).getByRole('button', { name: 'Play' }));
        await waitFor(() => expect(within(spanishCard).getByRole('button', { name: 'Pause' })).toBeInTheDocument());
        expect(live.muted).toBe(true);
        expect(pause.mock.instances).not.toContain(live);
        expect(fetchMock).toHaveBeenCalledTimes(leaseRequests);
        expect(live.src).toBe(liveSource);

        fireEvent.click(within(spanishCard).getByRole('button', { name: 'Pause' }));
        expect(live.muted).toBe(true);
        expect(pause.mock.instances).not.toContain(live);
        expect(fetchMock).toHaveBeenCalledTimes(leaseRequests);

        fireEvent.click(within(spanishCard).getByRole('button', { name: 'Play' }));
        await waitFor(() => expect(live.muted).toBe(true));
        fireEvent.ended(spanish);
        expect(live.muted).toBe(false);
        expect(live.src).toBe(liveSource);
        expect(fetchMock).toHaveBeenCalledTimes(leaseRequests);
        expect(play.mock.instances.filter((instance) => instance === live)).toHaveLength(livePlayCalls);
        expect(pause.mock.instances).not.toContain(live);
    });

    it('starts the shared Beacon muted beneath an intro and reveals it when the intro ends', async () => {
        const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
        vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('maybe');
        const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
            leaseId: '00000000-0000-4000-8000-000000000003',
            leaseExpiresAt: '2099-08-06T12:03:00.000Z',
            stream: {
                manifestUrl: '/api/early-birds/stream/manifest?leaseId=00000000-0000-4000-8000-000000000003',
                expiresAt: '2099-08-06T12:03:00.000Z',
            },
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: 'https://media.example.test/reviewed-drop-es', en: null }} />
            </LocaleProvider>,
        );
        const live = screen.getByLabelText('Beacon 24/7') as HTMLAudioElement;
        const spanish = screen.getByLabelText('Warm-up · Spanish') as HTMLAudioElement;
        const card = spanish.closest('article')!;
        fireEvent.click(within(card).getByRole('button', { name: 'Play' }));
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(play.mock.instances).toContain(live));
        expect(live.src).toContain('/api/early-birds/stream/manifest');
        expect(live.muted).toBe(true);
        fireEvent.ended(spanish);
        expect(live.muted).toBe(false);
    });

    it('restarts a playing drop-in without pausing and resets a paused drop-in without starting it', async () => {
        const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
        const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: 'https://media.example.test/drop-es', en: null }} />
            </LocaleProvider>,
        );
        const spanish = screen.getByLabelText('Warm-up · Spanish') as HTMLAudioElement;
        const card = spanish.closest('article')!;

        fireEvent.click(within(card).getByRole('button', { name: 'Play' }));
        await waitFor(() => expect(within(card).getByRole('button', { name: 'Pause' })).toBeInTheDocument());
        spanish.currentTime = 17;
        pause.mockClear();
        fireEvent.click(within(card).getByRole('button', { name: 'Restart' }));
        expect(spanish.currentTime).toBe(0);
        expect(within(card).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
        expect(pause.mock.instances).not.toContain(spanish);

        fireEvent.click(within(card).getByRole('button', { name: 'Pause' }));
        spanish.currentTime = 8;
        play.mockClear();
        fireEvent.click(within(card).getByRole('button', { name: 'Restart' }));
        expect(spanish.currentTime).toBe(0);
        expect(within(card).getByRole('button', { name: 'Play' })).toBeInTheDocument();
        expect(play.mock.instances).not.toContain(spanish);
    });

    it('localizes the drop-in play control in Spanish', () => {
        render(
            <LocaleProvider initialLocale="es">
                <ListenerPlayer dropIns={{ es: 'https://media.example.test/drop-es', en: null }} />
            </LocaleProvider>,
        );
        const spanish = screen.getByLabelText('Caldeamiento · Español');
        expect(within(spanish.closest('article')!).getByRole('button', { name: 'Reproducir' }))
            .toBeInTheDocument();
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
            .mockResolvedValueOnce(new Response(JSON.stringify(grants[1]), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Listen now' }));
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(1));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument());
        hlsHarness.instances[0].emitFatal();

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(2));
        expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/early-birds/stream/heartbeat');
        expect(hlsHarness.instances[0].destroy).toHaveBeenCalledOnce();
        expect(hlsHarness.instances[1].loadedSources).toEqual([grants[1].stream.manifestUrl]);
        expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
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
            .mockRejectedValue(new Error('synthetic outage'));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );
        fireEvent.click(screen.getByRole('button', { name: 'Listen now' }));
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(1));
        hlsHarness.instances[0].emitFatal();

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4), { timeout: 5_500 });
        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
            'The Beacon is unavailable right now.',
        ));
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(fetchMock).toHaveBeenCalledTimes(4);
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
        const live = screen.getByLabelText('Beacon 24/7');
        fireEvent.click(screen.getByRole('button', { name: 'Listen now' }));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument());

        vi.useFakeTimers();
        fireEvent.suspend(live);
        await vi.advanceTimersByTimeAsync(2_500);
        expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        vi.useRealTimers();

        fireEvent.error(live);
        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2), { timeout: 3_000 });
        expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/early-birds/stream/heartbeat');
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument());
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

        fireEvent.click(screen.getByRole('button', { name: 'Listen now' }));
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(1));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument());
        hlsHarness.instances[0].emitFatal();

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(
            'This device was displaced because the account is already listening on two other devices.',
        ));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            '/api/early-birds/stream/lease',
            '/api/early-birds/stream/heartbeat',
        ]);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(fetchMock).toHaveBeenCalledTimes(2);
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
            .mockResolvedValueOnce(new Response(JSON.stringify({
                error: 'Listening lease expired.',
                reason: 'expired',
            }), { status: 410 }))
            .mockResolvedValueOnce(new Response(JSON.stringify(replacementGrant), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Listen now' }));
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(1));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument());
        hlsHarness.instances[0].emitFatal();

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            '/api/early-birds/stream/lease',
            '/api/early-birds/stream/heartbeat',
            '/api/early-birds/stream/lease',
        ]);
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(2));
        expect(hlsHarness.instances[1].loadedSources).toEqual([replacementGrant.stream.manifestUrl]);
        expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument();
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
            .mockResolvedValueOnce(new Response(JSON.stringify(refreshedGrant), { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        render(
            <LocaleProvider initialLocale="en">
                <ListenerPlayer dropIns={{ es: null, en: null }} />
            </LocaleProvider>,
        );

        fireEvent.click(screen.getByRole('button', { name: 'Listen now' }));
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(1));
        hlsHarness.instances[0].emitFatal();
        await waitFor(() => expect(screen.getByRole('button', { name: 'Restoring connection…' }))
            .toBeInTheDocument());
        finishFirstPlay?.();

        await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
        await waitFor(() => expect(hlsHarness.instances).toHaveLength(2));
        await waitFor(() => expect(screen.getByRole('button', { name: 'Pause' })).toBeInTheDocument());
        expect(hlsHarness.instances[1].loadedSources).toEqual([refreshedGrant.stream.manifestUrl]);
    });
});
