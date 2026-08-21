import {
    LoadStats,
    type HlsConfig,
    type Loader,
    type LoaderCallbacks,
    type LoaderConfiguration,
    type LoaderContext,
} from 'hls.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    createListenerReservoirLoader,
    ListenerSegmentReservoir,
    listenerReservoirInventory,
} from '@/lib/listener/segment-reservoir';

const MANIFEST_URL = 'https://stream.example.test/v1/hls/approved/live.m3u8?grant=secret';

function playlist(segmentCount = 4, startSequence = 0): string {
    const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:7',
        '#EXT-X-MAP:URI="segments/init.mp4?grant=secret"',
    ];
    for (let index = startSequence; index < startSequence + segmentCount; index += 1) {
        lines.push('#EXTINF:6.000000,');
        lines.push(`segments/${index}.m4s?grant=secret`);
    }
    return `${lines.join('\n')}\n`;
}

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('listenerReservoirInventory', () => {
    it('selects the newest contiguous target without accepting another origin', () => {
        const source = `${playlist(4)}#EXTINF:6.000000,\nhttps://hostile.invalid/segment.m4s\n`;
        expect(listenerReservoirInventory(source, MANIFEST_URL, 12)).toEqual({
            initializationUrl: 'https://stream.example.test/v1/hls/approved/segments/init.mp4?grant=secret',
            segments: [
                {
                    url: 'https://stream.example.test/v1/hls/approved/segments/2.m4s?grant=secret',
                    durationSeconds: 6,
                },
                {
                    url: 'https://stream.example.test/v1/hls/approved/segments/3.m4s?grant=secret',
                    durationSeconds: 6,
                },
            ],
        });
    });

    it('rejects insecure manifests and malformed durations', () => {
        expect(listenerReservoirInventory(playlist(), 'http://stream.example.test/live.m3u8')).toEqual({
            initializationUrl: null,
            segments: [],
        });
        expect(listenerReservoirInventory('#EXTM3U\n#EXTINF:999,\nsegment.m4s\n', MANIFEST_URL))
            .toEqual({ initializationUrl: null, segments: [] });
    });
});

describe('ListenerSegmentReservoir', () => {
    it('prefetches a bounded media window and returns defensive byte copies', async () => {
        const snapshots: number[] = [];
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))));
        const reservoir = new ListenerSegmentReservoir((snapshot) => {
            snapshots.push(snapshot.retainedSeconds);
        }, true);

        reservoir.observePlaylist(MANIFEST_URL, playlist(4));
        await vi.waitFor(() => expect(snapshots.at(-1)).toBe(24));
        expect(fetch).toHaveBeenCalledTimes(5);
        const url = 'https://stream.example.test/v1/hls/approved/segments/3.m4s?grant=secret';
        const first = reservoir.cached(url);
        expect(first && [...new Uint8Array(first)]).toEqual([1, 2, 3]);
        new Uint8Array(first as ArrayBuffer)[0] = 9;
        expect([...(new Uint8Array(reservoir.cached(url) as ArrayBuffer))]).toEqual([1, 2, 3]);
        reservoir.dispose();
        expect(reservoir.cached(url)).toBeNull();
    });

    it('serves the last valid playlist when the origin is temporarily unavailable', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([1]))));
        const reservoir = new ListenerSegmentReservoir(undefined, true);
        reservoir.observePlaylist(MANIFEST_URL, playlist(1));
        class FailingLoader implements Loader<LoaderContext> {
            context: LoaderContext | null = null;
            stats = new LoadStats();
            constructor() {}
            load(
                context: LoaderContext,
                _config: LoaderConfiguration,
                callbacks: LoaderCallbacks<LoaderContext>,
            ): void {
                void _config;
                this.context = context;
                callbacks.onError(
                    { code: 503, text: 'offline' }, context, null, this.stats,
                );
            }
            abort(): void {}
            destroy(): void {}
        }
        const ReservoirLoader = createListenerReservoirLoader(FailingLoader, reservoir);
        const loader = new ReservoirLoader({} as HlsConfig);
        const onSuccess = vi.fn();
        const onError = vi.fn();
        loader.load(
            { url: MANIFEST_URL, responseType: 'text' },
            {} as LoaderConfiguration,
            {
                onSuccess,
                onError,
                onTimeout: vi.fn(),
            },
        );
        expect(onError).not.toHaveBeenCalled();
        expect(onSuccess.mock.calls[0]?.[0]).toMatchObject({ data: playlist(1), code: 200 });
        reservoir.dispose();
    });

    it('serves hls.js whole fragments expressed as the sentinel range 0-0', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([4, 1, 9]))));
        const reservoir = new ListenerSegmentReservoir(undefined, true);
        reservoir.observePlaylist(MANIFEST_URL, playlist(1));
        const segmentUrl = 'https://stream.example.test/v1/hls/approved/segments/0.m4s?grant=secret';
        await vi.waitFor(() => expect(reservoir.cached(segmentUrl)).not.toBeNull());
        const delegatedLoads = vi.fn();
        class UnexpectedNetworkLoader implements Loader<LoaderContext> {
            context: LoaderContext | null = null;
            stats = new LoadStats();
            constructor() {}
            load(): void { delegatedLoads(); }
            abort(): void {}
            destroy(): void {}
        }
        const ReservoirLoader = createListenerReservoirLoader(UnexpectedNetworkLoader, reservoir);
        const loader = new ReservoirLoader({} as HlsConfig);
        const onSuccess = vi.fn();
        loader.load(
            { url: segmentUrl, responseType: 'arraybuffer', rangeStart: 0, rangeEnd: 0 },
            {} as LoaderConfiguration,
            { onSuccess, onError: vi.fn(), onTimeout: vi.fn() },
        );
        await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
        expect(delegatedLoads).not.toHaveBeenCalled();
        expect([...new Uint8Array(onSuccess.mock.calls[0][0].data as ArrayBuffer)])
            .toEqual([4, 1, 9]);
        reservoir.dispose();
    });

    it('drains only cached playlists and fragments while origin access is disabled', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([7, 2, 1]))));
        const reservoir = new ListenerSegmentReservoir(undefined, true);
        reservoir.observePlaylist(MANIFEST_URL, playlist(1));
        const segmentUrl = 'https://stream.example.test/v1/hls/approved/segments/0.m4s?grant=secret';
        await vi.waitFor(() => expect(reservoir.cached(segmentUrl)).not.toBeNull());

        const delegatedLoads = vi.fn();
        class UnexpectedNetworkLoader implements Loader<LoaderContext> {
            context: LoaderContext | null = null;
            stats = new LoadStats();
            constructor() {}
            load(): void { delegatedLoads(); }
            abort(): void {}
            destroy(): void {}
        }
        const ReservoirLoader = createListenerReservoirLoader(UnexpectedNetworkLoader, reservoir);
        reservoir.setOriginAllowed(false);

        const playlistSuccess = vi.fn();
        new ReservoirLoader({} as HlsConfig).load(
            { url: MANIFEST_URL, responseType: 'text' },
            {} as LoaderConfiguration,
            { onSuccess: playlistSuccess, onError: vi.fn(), onTimeout: vi.fn() },
        );
        const fragmentSuccess = vi.fn();
        new ReservoirLoader({} as HlsConfig).load(
            { url: segmentUrl, responseType: 'arraybuffer', rangeStart: 0, rangeEnd: 0 },
            {} as LoaderConfiguration,
            { onSuccess: fragmentSuccess, onError: vi.fn(), onTimeout: vi.fn() },
        );
        const missingError = vi.fn();
        new ReservoirLoader({} as HlsConfig).load(
            {
                url: 'https://stream.example.test/v1/hls/approved/segments/missing.m4s',
                responseType: 'arraybuffer',
                rangeStart: 0,
                rangeEnd: 0,
            },
            {} as LoaderConfiguration,
            { onSuccess: vi.fn(), onError: missingError, onTimeout: vi.fn() },
        );
        const rangedError = vi.fn();
        new ReservoirLoader({} as HlsConfig).load(
            {
                url: segmentUrl,
                responseType: 'arraybuffer',
                rangeStart: 1,
                rangeEnd: 2,
            },
            {} as LoaderConfiguration,
            { onSuccess: vi.fn(), onError: rangedError, onTimeout: vi.fn() },
        );

        await vi.waitFor(() => expect(playlistSuccess).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(fragmentSuccess).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(missingError).toHaveBeenCalledOnce());
        await vi.waitFor(() => expect(rangedError).toHaveBeenCalledOnce());
        expect(delegatedLoads).not.toHaveBeenCalled();
        reservoir.dispose();
    });

    it('retains slid-out segments until the player consumes them', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([8, 1]))));
        const snapshots: number[] = [];
        const reservoir = new ListenerSegmentReservoir((snapshot) => {
            snapshots.push(snapshot.retainedSeconds);
        }, true);
        reservoir.observePlaylist(MANIFEST_URL, playlist(4, 0));
        await vi.waitFor(() => expect(snapshots.at(-1)).toBe(24));
        reservoir.observePlaylist(MANIFEST_URL, playlist(4, 4));
        await vi.waitFor(() => expect(snapshots.at(-1)).toBe(48));

        const delegatedLoads = vi.fn();
        class UnexpectedNetworkLoader implements Loader<LoaderContext> {
            context: LoaderContext | null = null;
            stats = new LoadStats();
            constructor() {}
            load(): void { delegatedLoads(); }
            abort(): void {}
            destroy(): void {}
        }
        const ReservoirLoader = createListenerReservoirLoader(UnexpectedNetworkLoader, reservoir);
        reservoir.setOriginAllowed(false);
        const success = vi.fn();
        const consumedUrl = 'https://stream.example.test/v1/hls/approved/segments/0.m4s?grant=secret';
        new ReservoirLoader({} as HlsConfig).load(
            {
                url: consumedUrl,
                responseType: 'arraybuffer',
                rangeStart: 0,
                rangeEnd: 0,
            },
            {} as LoaderConfiguration,
            { onSuccess: success, onError: vi.fn(), onTimeout: vi.fn() },
        );

        await vi.waitFor(() => expect(success).toHaveBeenCalledOnce());
        expect(delegatedLoads).not.toHaveBeenCalled();
        expect(reservoir.cached(consumedUrl)).toBeNull();
        expect(snapshots.at(-1)).toBe(42);
        reservoir.dispose();
    });
});
