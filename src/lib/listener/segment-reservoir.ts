import {
    type HlsConfig,
    type Loader,
    type LoaderCallbacks,
    type LoaderConfiguration,
    type LoaderContext,
    type LoaderStats,
} from 'hls.js';

import { LISTENER_BUFFER_TARGET_SECONDS } from './playback-resilience';

const MAX_RESERVOIR_BYTES = 16 * 1024 * 1024;
const MAX_PREFETCH_CONCURRENCY = 4;

type ReservoirEntry = {
    bytes: ArrayBuffer;
    durationSeconds: number;
};

type PlaylistSegment = {
    url: string;
    durationSeconds: number;
};

export type ListenerReservoirSnapshot = {
    retainedSeconds: number;
    retainedBytes: number;
    retainedSegments: number;
};

function safeMediaUrl(value: string, manifestUrl: string): string | null {
    try {
        const manifest = new URL(manifestUrl);
        const candidate = new URL(value, manifest);
        if (candidate.protocol !== 'https:' || candidate.origin !== manifest.origin) return null;
        return candidate.toString();
    } catch {
        return null;
    }
}

export function listenerReservoirInventory(
    playlist: string,
    manifestUrl: string,
    targetSeconds = LISTENER_BUFFER_TARGET_SECONDS,
): { initializationUrl: string | null; segments: PlaylistSegment[] } {
    if (!playlist.startsWith('#EXTM3U') || !Number.isFinite(targetSeconds) || targetSeconds <= 0) {
        return { initializationUrl: null, segments: [] };
    }
    let initializationUrl: string | null = null;
    let pendingDuration: number | null = null;
    const allSegments: PlaylistSegment[] = [];
    for (const rawLine of playlist.split(/\r?\n/)) {
        const line = rawLine.trim();
        const mapMatch = /^#EXT-X-MAP:URI="([^"]+)"$/.exec(line);
        if (mapMatch) {
            initializationUrl = safeMediaUrl(mapMatch[1], manifestUrl);
            continue;
        }
        const durationMatch = /^#EXTINF:([0-9]+(?:\.[0-9]+)?),/.exec(line);
        if (durationMatch) {
            const duration = Number(durationMatch[1]);
            pendingDuration = Number.isFinite(duration) && duration > 0 && duration <= 30
                ? duration
                : null;
            continue;
        }
        if (!line || line.startsWith('#') || pendingDuration === null) continue;
        const url = safeMediaUrl(line, manifestUrl);
        if (url) allSegments.push({ url, durationSeconds: pendingDuration });
        pendingDuration = null;
    }

    let retainedSeconds = 0;
    const selected: PlaylistSegment[] = [];
    for (let index = allSegments.length - 1; index >= 0; index -= 1) {
        selected.unshift(allSegments[index]);
        retainedSeconds += allSegments[index].durationSeconds;
        if (retainedSeconds >= targetSeconds) break;
    }
    return { initializationUrl, segments: selected };
}

function emptyStats(): LoaderStats {
    return {
        aborted: false,
        loaded: 0,
        retry: 0,
        total: 0,
        chunkCount: 0,
        bwEstimate: 0,
        loading: { start: 0, first: 0, end: 0 },
        parsing: { start: 0, end: 0 },
        buffering: { start: 0, first: 0, end: 0 },
    };
}

function cachedStats(bytes: number): LoaderStats {
    const stats = emptyStats();
    const now = performance.now();
    stats.loaded = bytes;
    stats.total = bytes;
    stats.chunkCount = 1;
    stats.loading = { start: now, first: now, end: now };
    return stats;
}

export class ListenerSegmentReservoir {
    private readonly entries = new Map<string, ReservoirEntry>();
    private readonly inflight = new Map<string, Promise<ArrayBuffer | null>>();
    private readonly controllers = new Set<AbortController>();
    private readonly playlistFallback = new Map<string, { mediaSequence: number; playlist: string }>();
    private readonly delivered = new Set<string>();
    private readonly initializationUrls = new Set<string>();
    private generation = 0;
    private disposed = false;
    private enabled: boolean;
    private originAllowed = true;
    private lastSnapshot: ListenerReservoirSnapshot = {
        retainedSeconds: 0,
        retainedBytes: 0,
        retainedSegments: 0,
    };

    constructor(
        private readonly onSnapshot: (snapshot: ListenerReservoirSnapshot) => void = () => undefined,
        enabled = false,
    ) {
        this.enabled = enabled;
    }

    snapshot(): ListenerReservoirSnapshot {
        return { ...this.lastSnapshot };
    }

    cached(url: string): ArrayBuffer | null {
        return this.entries.get(url)?.bytes.slice(0) ?? null;
    }

    pending(url: string): Promise<ArrayBuffer | null> | null {
        return this.inflight.get(url) ?? null;
    }

    fallbackPlaylist(url: string): string | null {
        return this.playlistFallback.get(url)?.playlist ?? null;
    }

    mayReachOrigin(): boolean {
        return this.originAllowed;
    }

    setOriginAllowed(allowed: boolean): void {
        if (this.disposed) return;
        this.originAllowed = allowed;
    }

    markDelivered(url: string): void {
        if (this.disposed || this.initializationUrls.has(url)) return;
        this.delivered.add(url);
        if (!this.entries.delete(url)) return;
        this.publishSnapshot();
    }

    private retainedByteCount(): number {
        let total = 0;
        for (const entry of this.entries.values()) total += entry.bytes.byteLength;
        return total;
    }

    observePlaylist(url: string, playlist: string): void {
        if (this.disposed || !playlist.startsWith('#EXTM3U')) return;
        const sequenceMatch = /^#EXT-X-MEDIA-SEQUENCE:(\d+)$/m.exec(playlist);
        const mediaSequence = sequenceMatch ? Number(sequenceMatch[1]) : 0;
        const previous = this.playlistFallback.get(url);
        if (previous && mediaSequence < previous.mediaSequence) return;
        this.playlistFallback.set(url, { mediaSequence, playlist });
        if (!this.enabled) return;
        this.prefetchPlaylist(url, playlist);
    }

    enable(): void {
        if (this.disposed || this.enabled) return;
        this.enabled = true;
        for (const [url, fallback] of this.playlistFallback) {
            this.prefetchPlaylist(url, fallback.playlist);
        }
    }

    private prefetchPlaylist(url: string, playlist: string): void {
        const generation = ++this.generation;
        const inventory = listenerReservoirInventory(playlist, url);
        const visibleUrls = new Set(inventory.segments.map((segment) => segment.url));
        for (const deliveredUrl of this.delivered) {
            if (!visibleUrls.has(deliveredUrl)) this.delivered.delete(deliveredUrl);
        }
        if (inventory.initializationUrl) {
            this.initializationUrls.clear();
            this.initializationUrls.add(inventory.initializationUrl);
        }
        void this.prefetchGeneration(generation, inventory.initializationUrl, inventory.segments);
    }

    private publishSnapshot(): void {
        let retainedBytes = 0;
        let retainedSeconds = 0;
        let retainedSegments = 0;
        for (const entry of this.entries.values()) {
            retainedBytes += entry.bytes.byteLength;
            retainedSeconds += entry.durationSeconds;
            if (entry.durationSeconds > 0) retainedSegments += 1;
        }
        this.lastSnapshot = { retainedSeconds, retainedBytes, retainedSegments };
        this.onSnapshot(this.snapshot());
    }

    private fetchBytes(url: string, durationSeconds: number): Promise<ArrayBuffer | null> {
        const existing = this.entries.get(url);
        if (existing) return Promise.resolve(existing.bytes);
        const pending = this.inflight.get(url);
        if (pending) return pending;
        const controller = new AbortController();
        this.controllers.add(controller);
        const request = fetch(url, {
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            signal: controller.signal,
        }).then(async (response) => {
            if (!response.ok || response.type === 'opaqueredirect') return null;
            const declaredBytes = Number(response.headers.get('content-length'));
            if (Number.isFinite(declaredBytes) && declaredBytes > MAX_RESERVOIR_BYTES) return null;
            const bytes = await response.arrayBuffer();
            if (bytes.byteLength <= 0 || bytes.byteLength > MAX_RESERVOIR_BYTES) return null;
            if (
                !this.disposed
                && !this.delivered.has(url)
                && this.retainedByteCount() + bytes.byteLength <= MAX_RESERVOIR_BYTES
            ) {
                this.entries.set(url, { bytes, durationSeconds });
            } else if (!this.delivered.has(url)) {
                return null;
            }
            return bytes;
        }).catch(() => null).finally(() => {
            this.controllers.delete(controller);
            this.inflight.delete(url);
        });
        this.inflight.set(url, request);
        return request;
    }

    private async prefetchGeneration(
        generation: number,
        initializationUrl: string | null,
        segments: PlaylistSegment[],
    ): Promise<void> {
        const queue: PlaylistSegment[] = initializationUrl
            ? [{ url: initializationUrl, durationSeconds: 0 }, ...segments]
            : [...segments];
        let cursor = 0;
        const workers = Array.from(
            { length: Math.min(MAX_PREFETCH_CONCURRENCY, queue.length) },
            async () => {
                while (!this.disposed) {
                    const index = cursor;
                    cursor += 1;
                    if (index >= queue.length) return;
                    const item = queue[index];
                    const currentBytes = this.retainedByteCount();
                    if (currentBytes >= MAX_RESERVOIR_BYTES) return;
                    await this.fetchBytes(item.url, item.durationSeconds);
                }
            },
        );
        await Promise.all(workers);
        if (this.disposed || generation !== this.generation) return;

        // Do not prune a segment merely because it slid out of the newest live
        // playlist. It may still be ahead of the listener's media clock after
        // jitter or an outage. The loader releases it exactly when delivered.
        this.publishSnapshot();
    }

    dispose(): void {
        this.disposed = true;
        this.generation += 1;
        for (const controller of this.controllers) controller.abort();
        this.controllers.clear();
        this.inflight.clear();
        this.entries.clear();
        this.playlistFallback.clear();
        this.delivered.clear();
        this.initializationUrls.clear();
    }
}

export function createListenerReservoirLoader(
    BaseLoader: new (config: HlsConfig) => Loader<LoaderContext>,
    reservoir: ListenerSegmentReservoir,
): new (config: HlsConfig) => Loader<LoaderContext> {
    return class ListenerReservoirLoader implements Loader<LoaderContext> {
        private readonly delegate: Loader<LoaderContext>;
        private aborted = false;
        context: LoaderContext | null = null;
        stats: LoaderStats;

        constructor(config: HlsConfig) {
            this.delegate = new BaseLoader(config);
            // FragmentLoader captures this object before calling load(). Keep
            // the reference stable so cached responses report real progress
            // instead of leaving hls.js with a detached all-zero stats object.
            this.stats = this.delegate.stats;
        }

        load(
            context: LoaderContext,
            config: LoaderConfiguration,
            callbacks: LoaderCallbacks<LoaderContext>,
        ): void {
            this.context = context;
            const serveBytes = (bytes: ArrayBuffer) => {
                if (this.aborted) return;
                Object.assign(this.stats, cachedStats(bytes.byteLength));
                reservoir.markDelivered(context.url);
                callbacks.onSuccess(
                    { url: context.url, data: bytes.slice(0), code: 200 },
                    this.stats,
                    context,
                    null,
                );
            };
            const rejectOfflineMiss = () => {
                if (this.aborted) return;
                callbacks.onError(
                    { code: 503, text: 'origin unavailable' },
                    context,
                    null,
                    this.stats,
                );
            };
            if (context.responseType === 'arraybuffer') {
                // hls.js represents an ordinary whole-fragment request as
                // rangeStart=0/rangeEnd=0. Only a real non-zero byte range
                // must bypass the whole-object reservoir.
                if ((context.rangeStart ?? 0) !== 0 || (context.rangeEnd ?? 0) !== 0) {
                    if (reservoir.mayReachOrigin()) {
                        this.loadDelegate(context, config, callbacks);
                    } else {
                        queueMicrotask(rejectOfflineMiss);
                    }
                    return;
                }
                const cached = reservoir.cached(context.url);
                if (cached) {
                    queueMicrotask(() => serveBytes(cached));
                    return;
                }
                const pending = reservoir.pending(context.url);
                if (pending) {
                    void pending.then((bytes) => {
                        if (this.aborted) return;
                        if (bytes) serveBytes(bytes);
                        else if (reservoir.mayReachOrigin()) {
                            this.loadDelegate(context, config, callbacks);
                        } else {
                            rejectOfflineMiss();
                        }
                    });
                    return;
                }
            }
            if (!reservoir.mayReachOrigin()) {
                const fallback = context.responseType !== 'arraybuffer'
                    ? reservoir.fallbackPlaylist(context.url)
                    : null;
                if (fallback !== null) {
                    const bytes = new TextEncoder().encode(fallback).byteLength;
                    const fallbackStats = cachedStats(bytes);
                    Object.assign(this.stats, fallbackStats);
                    queueMicrotask(() => {
                        if (this.aborted) return;
                        callbacks.onSuccess(
                            { url: context.url, data: fallback, code: 200 },
                            fallbackStats,
                            context,
                            null,
                        );
                    });
                } else {
                    queueMicrotask(rejectOfflineMiss);
                }
                return;
            }
            this.loadDelegate(context, config, callbacks);
        }

        private loadDelegate(
            context: LoaderContext,
            config: LoaderConfiguration,
            callbacks: LoaderCallbacks<LoaderContext>,
        ): void {
            this.delegate.load(context, config, {
                ...callbacks,
                onSuccess: (response, stats, successfulContext, networkDetails) => {
                    if (typeof response.data === 'string') {
                        reservoir.observePlaylist(successfulContext.url, response.data);
                    } else if (response.data instanceof ArrayBuffer) {
                        reservoir.markDelivered(successfulContext.url);
                    }
                    callbacks.onSuccess(response, stats, successfulContext, networkDetails);
                },
                onError: (error, failedContext, networkDetails, stats) => {
                    const fallback = reservoir.fallbackPlaylist(failedContext.url);
                    if (fallback !== null && failedContext.responseType !== 'arraybuffer') {
                        const fallbackStats = cachedStats(new TextEncoder().encode(fallback).byteLength);
                        Object.assign(this.stats, fallbackStats);
                        callbacks.onSuccess(
                            { url: failedContext.url, data: fallback, code: 200 },
                            fallbackStats,
                            failedContext,
                            null,
                        );
                        return;
                    }
                    callbacks.onError(error, failedContext, networkDetails, stats);
                },
                onTimeout: (stats, failedContext, networkDetails) => {
                    const fallback = reservoir.fallbackPlaylist(failedContext.url);
                    if (fallback !== null && failedContext.responseType !== 'arraybuffer') {
                        const fallbackStats = cachedStats(new TextEncoder().encode(fallback).byteLength);
                        Object.assign(this.stats, fallbackStats);
                        callbacks.onSuccess(
                            { url: failedContext.url, data: fallback, code: 200 },
                            fallbackStats,
                            failedContext,
                            null,
                        );
                        return;
                    }
                    callbacks.onTimeout(stats, failedContext, networkDetails);
                },
            });
        }

        abort(): void {
            this.aborted = true;
            this.delegate.abort();
        }

        destroy(): void {
            this.aborted = true;
            this.delegate.destroy();
            this.context = null;
        }

        getCacheAge(): number | null {
            return this.delegate.getCacheAge?.() ?? null;
        }

        getResponseHeader(name: string): string | null {
            return this.delegate.getResponseHeader?.(name) ?? null;
        }
    };
}
