// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    parseRemoteHarmonicFrame,
    RemoteHarmonicAnalysisProvider,
} from '../remote-provider';

function wireFrame() {
    return {
        schemaVersion: 1,
        capturedAtMs: 1_786_233_600_000,
        sourceTimeSeconds: 12.5,
        overallDb: -18,
        harmonicAbsoluteDb: [-8, -20, -30],
        harmonicDeltaDb: [1, -1, 0],
        spectralEnvelopeDb: [-10, -20],
        stereoBalance: 0.1,
        stereoWidth: 0.2,
        confidence: 1,
        sourceKind: 'beacon',
    };
}

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('RemoteHarmonicAnalysisProvider', () => {
    it('accepts only the bounded renderer-neutral wire contract', () => {
        const parsed = parseRemoteHarmonicFrame(wireFrame());
        expect(parsed?.harmonicAbsoluteDb).toBeInstanceOf(Float32Array);
        expect(parsed?.sourceKind).toBe('beacon');
        expect(parseRemoteHarmonicFrame({ ...wireFrame(), sourceKind: 'intro' })).toBeNull();
        expect(parseRemoteHarmonicFrame({
            ...wireFrame(),
            harmonicAbsoluteDb: new Array(513).fill(-20),
            harmonicDeltaDb: new Array(513).fill(0),
        })).toBeNull();
    });

    it('requests the server frame aligned to audible HLS program time', async () => {
        vi.useFakeTimers();
        const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(wireFrame())));
        const listener = vi.fn();
        const provider = new RemoteHarmonicAnalysisProvider({
            endpoint: '/api/listener/analysis/frame',
            sources: [{ id: 'beacon', kind: 'beacon' }],
            getPlaybackProgramTimeMs: () => 1_786_233_600_125,
            getLeaseCursor: () => ({
                leaseId: '00000000-0000-4000-8000-000000000003',
                leaseGeneration: 7,
            }),
            fetcher,
        });
        provider.subscribe(listener);

        await provider.start();
        await vi.advanceTimersByTimeAsync(1);

        expect(fetcher).toHaveBeenCalledWith(
            '/api/listener/analysis/frame?at=1786233600125'
                + '&leaseId=00000000-0000-4000-8000-000000000003&leaseGeneration=7',
            expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }),
        );
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({ overallDb: -18 }));
        provider.stop();
    });

    it('binds the browser native fetch receiver before requesting a frame', async () => {
        vi.useFakeTimers();
        const browserFetch = vi.fn(function browserFetch(this: unknown) {
            if (this !== window) throw new TypeError('Illegal invocation');
            return Promise.resolve(new Response(JSON.stringify(wireFrame())));
        });
        vi.stubGlobal('fetch', browserFetch);
        const listener = vi.fn();
        const provider = new RemoteHarmonicAnalysisProvider({
            endpoint: '/api/listener/analysis/frame',
            sources: [{ id: 'beacon', kind: 'beacon' }],
            getPlaybackProgramTimeMs: () => 1_786_233_600_125,
            getLeaseCursor: () => ({
                leaseId: '00000000-0000-4000-8000-000000000003',
                leaseGeneration: 7,
            }),
        });
        provider.subscribe(listener);

        await provider.start();
        await vi.advanceTimersByTimeAsync(1);

        expect(browserFetch).toHaveBeenCalledOnce();
        expect(listener).toHaveBeenCalledOnce();
        provider.stop();
    });

    it('never fetches while the audible source is an introduction', async () => {
        vi.useFakeTimers();
        const fetcher = vi.fn();
        const provider = new RemoteHarmonicAnalysisProvider({
            endpoint: '/api/listener/analysis/frame',
            sources: [
                { id: 'beacon', kind: 'beacon' },
                { id: 'intro-en', kind: 'intro' },
            ],
            activeSourceId: 'intro-en',
            getPlaybackProgramTimeMs: () => 1_786_233_600_125,
            getLeaseCursor: () => ({
                leaseId: '00000000-0000-4000-8000-000000000003',
                leaseGeneration: 7,
            }),
            fetcher,
        });

        await provider.start();
        await vi.advanceTimersByTimeAsync(1_000);
        expect(fetcher).not.toHaveBeenCalled();
        provider.stop();
    });

    it('backs off through transient server failures and recovers without removing the field', async () => {
        vi.useFakeTimers();
        const fetcher = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockRejectedValueOnce(new Error('offline'))
            .mockRejectedValueOnce(new Error('offline'))
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue(new Response(JSON.stringify(wireFrame())));
        const listener = vi.fn();
        const provider = new RemoteHarmonicAnalysisProvider({
            endpoint: '/api/listener/analysis/frame',
            sources: [{ id: 'beacon', kind: 'beacon' }],
            getPlaybackProgramTimeMs: () => 1_786_233_600_125,
            getLeaseCursor: () => ({
                leaseId: '00000000-0000-4000-8000-000000000003',
                leaseGeneration: 7,
            }),
            fetcher,
            framesPerSecond: 4,
        });
        provider.subscribe(listener);

        await provider.start();
        await vi.advanceTimersByTimeAsync(2_000);
        expect(fetcher).toHaveBeenCalledTimes(4);
        expect(provider.getStatus()).toMatchObject({
            phase: 'running',
            error: { code: 'ANALYSIS_FAILED' },
        });

        await vi.advanceTimersByTimeAsync(1_751);
        expect(fetcher).toHaveBeenCalledTimes(5);
        expect(listener).toHaveBeenCalledOnce();
        expect(provider.getStatus()).toMatchObject({ phase: 'running', error: null });
        provider.stop();
    });

    it('never publishes a resolved Beacon frame after switching to an intro', async () => {
        vi.useFakeTimers();
        let resolveFetch!: (response: Response) => void;
        const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolveFetch = resolve; }));
        const listener = vi.fn();
        const provider = new RemoteHarmonicAnalysisProvider({
            endpoint: '/api/listener/analysis/frame',
            sources: [
                { id: 'beacon', kind: 'beacon' },
                { id: 'intro-en', kind: 'intro' },
            ],
            getPlaybackProgramTimeMs: () => 1_786_233_600_125,
            getLeaseCursor: () => ({
                leaseId: '00000000-0000-4000-8000-000000000003',
                leaseGeneration: 7,
            }),
            fetcher,
        });
        provider.subscribe(listener);
        await provider.start();
        await vi.advanceTimersByTimeAsync(1);
        expect(fetcher).toHaveBeenCalledOnce();

        provider.setActiveSource('intro-en');
        resolveFetch(new Response(JSON.stringify(wireFrame())));
        await vi.advanceTimersByTimeAsync(1);

        expect(listener).not.toHaveBeenCalled();
        provider.stop();
    });

    it('invalidates an in-flight frame when render cadence changes', async () => {
        vi.useFakeTimers();
        const resolvers: Array<(response: Response) => void> = [];
        const fetcher = vi.fn(() => new Promise<Response>((resolve) => { resolvers.push(resolve); }));
        const listener = vi.fn();
        const provider = new RemoteHarmonicAnalysisProvider({
            endpoint: '/api/listener/analysis/frame',
            sources: [{ id: 'beacon', kind: 'beacon' }],
            getPlaybackProgramTimeMs: () => 1_786_233_600_125,
            getLeaseCursor: () => ({
                leaseId: '00000000-0000-4000-8000-000000000003',
                leaseGeneration: 7,
            }),
            fetcher,
        });
        provider.subscribe(listener);
        await provider.start();
        await vi.advanceTimersByTimeAsync(1);

        provider.setFramesPerSecond(2);
        await vi.advanceTimersByTimeAsync(1);
        expect(fetcher).toHaveBeenCalledTimes(2);
        resolvers[1](new Response(JSON.stringify(wireFrame())));
        await vi.advanceTimersByTimeAsync(1);
        resolvers[0](new Response(JSON.stringify({ ...wireFrame(), capturedAtMs: 1 })));
        await vi.advanceTimersByTimeAsync(1);

        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledWith(expect.objectContaining({
            capturedAtMs: 1_786_233_600_000,
        }));
        provider.stop();
    });
});
