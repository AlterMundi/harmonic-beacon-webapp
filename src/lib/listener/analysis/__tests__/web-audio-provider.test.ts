import { describe, expect, it, vi } from 'vitest';

import {
    WebAudioHarmonicAnalysisProvider,
    type HarmonicAnalysisScheduler,
} from '../web-audio-provider';

class FakeNode {
    readonly connections: Array<{ target: FakeNode; output?: number }> = [];
    disconnectCalls = 0;

    connect(target: FakeNode, output?: number): FakeNode {
        this.connections.push({ target, output });
        return target;
    }

    disconnect(): void {
        this.disconnectCalls += 1;
        this.connections.length = 0;
    }
}

class FakeAnalyser extends FakeNode {
    fftSize = 2048;
    smoothingTimeConstant = 0;

    get frequencyBinCount(): number {
        return this.fftSize / 2;
    }

    getFloatFrequencyData(target: Float32Array): void {
        target.fill(-80);
    }

    getFloatTimeDomainData(target: Float32Array): void {
        target.fill(0.1);
    }
}

class FakeAudioContext {
    readonly destination = new FakeNode();
    readonly sourceNodes: FakeNode[] = [];
    readonly splitterNodes: FakeNode[] = [];
    readonly analyserNodes: FakeAnalyser[] = [];
    readonly sampleRate = 48_000;
    state: AudioContextState = 'suspended';
    close = vi.fn(async () => undefined);
    private resumeResolver: (() => void) | null = null;
    private readonly listeners = new Set<EventListenerOrEventListenerObject>();

    constructor(private readonly rejectResume = false) {}

    createMediaElementSource(): MediaElementAudioSourceNode {
        const node = new FakeNode();
        this.sourceNodes.push(node);
        return node as unknown as MediaElementAudioSourceNode;
    }

    createChannelSplitter(): ChannelSplitterNode {
        const node = new FakeNode();
        this.splitterNodes.push(node);
        return node as unknown as ChannelSplitterNode;
    }

    createAnalyser(): AnalyserNode {
        const node = new FakeAnalyser();
        this.analyserNodes.push(node);
        return node as unknown as AnalyserNode;
    }

    resume(): Promise<void> {
        if (this.rejectResume) return Promise.reject(new Error('gesture rejected'));
        return new Promise((resolve) => {
            this.resumeResolver = () => {
                this.state = 'running';
                resolve();
            };
        });
    }

    resolveResume(): void {
        this.resumeResolver?.();
    }

    addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
        this.listeners.add(listener);
    }

    removeEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
        this.listeners.delete(listener);
    }
}

function media(currentTime: number): HTMLMediaElement {
    return { currentTime } as HTMLMediaElement;
}

function scheduler(): HarmonicAnalysisScheduler & {
    callbacks: FrameRequestCallback[];
} {
    const callbacks: FrameRequestCallback[] = [];
    return {
        callbacks,
        request: (callback) => {
            callbacks.push(callback);
            return callbacks.length;
        },
        cancel: vi.fn(),
        now: () => 1_000,
    };
}

describe('WebAudioHarmonicAnalysisProvider', () => {
    it('attaches all sources synchronously before resume and creates one direct audible branch each', async () => {
        const context = new FakeAudioContext();
        const frameScheduler = scheduler();
        const provider = new WebAudioHarmonicAnalysisProvider({
            audioContext: context as unknown as AudioContext,
            scheduler: frameScheduler,
            fftSize: 8192,
            sources: [
                { id: 'intro-en', kind: 'intro', element: media(2) },
                { id: 'beacon', kind: 'beacon', element: media(90) },
            ],
        });

        const started = provider.start();
        expect(context.sourceNodes).toHaveLength(2);
        expect(context.splitterNodes).toHaveLength(2);
        expect(context.analyserNodes).toHaveLength(4);
        expect(context.analyserNodes.every(({ fftSize }) => fftSize === 8192)).toBe(true);
        for (let index = 0; index < context.sourceNodes.length; index += 1) {
            const source = context.sourceNodes[index];
            expect(source?.connections).toEqual([
                { target: context.destination, output: undefined },
                { target: context.splitterNodes[index], output: undefined },
            ]);
            expect(context.splitterNodes[index]?.connections).toEqual([
                { target: context.analyserNodes[index * 2], output: 0 },
                { target: context.analyserNodes[index * 2 + 1], output: 1 },
            ]);
        }
        expect(context.analyserNodes.every(({ connections }) => connections.length === 0)).toBe(true);

        context.resolveResume();
        await expect(started).resolves.toEqual({ ok: true });
        expect(provider.getStatus().phase).toBe('running');
        expect(frameScheduler.callbacks).toHaveLength(1);
    });

    it('switches observed source without reconnecting paths and emits the selected kind', async () => {
        const context = new FakeAudioContext();
        context.state = 'running';
        const frameScheduler = scheduler();
        const provider = new WebAudioHarmonicAnalysisProvider({
            audioContext: context as unknown as AudioContext,
            scheduler: frameScheduler,
            fftSize: 8192,
            sources: [
                { id: 'intro-es', kind: 'intro', element: media(12) },
                { id: 'beacon', kind: 'beacon', element: media(240) },
            ],
        });
        const frames = vi.fn();
        provider.subscribe(frames);
        await expect(provider.start()).resolves.toEqual({ ok: true });
        const connectionCounts = context.sourceNodes.map(({ connections }) => connections.length);

        expect(provider.setActiveSource('beacon')).toEqual({ ok: true });
        expect(context.sourceNodes.map(({ connections }) => connections.length)).toEqual(connectionCounts);
        frameScheduler.callbacks.shift()?.(1_000);

        expect(frames).toHaveBeenCalledOnce();
        expect(frames.mock.calls[0]?.[0]).toMatchObject({
            sourceKind: 'beacon',
            sourceTimeSeconds: 240,
        });
    });

    it('pauses frame capture without disconnecting the irreversible audible graph', async () => {
        const context = new FakeAudioContext();
        context.state = 'running';
        const frameScheduler = scheduler();
        const provider = new WebAudioHarmonicAnalysisProvider({
            audioContext: context as unknown as AudioContext,
            scheduler: frameScheduler,
            sources: [{ id: 'beacon', kind: 'beacon', element: media(0) }],
        });
        await provider.start();
        const audibleConnections = context.sourceNodes[0]?.connections.slice();

        provider.pauseAnalysis();
        expect(provider.getStatus().phase).toBe('paused');
        expect(context.sourceNodes[0]?.connections).toEqual(audibleConnections);
        expect(frameScheduler.cancel).toHaveBeenCalledOnce();

        expect(provider.resumeAnalysis()).toEqual({ ok: true });
        expect(provider.getStatus().phase).toBe('running');
        expect(context.sourceNodes[0]?.connections).toEqual(audibleConnections);
    });

    it('retains the direct branch when context resume fails so integration can remount', async () => {
        const context = new FakeAudioContext(true);
        const provider = new WebAudioHarmonicAnalysisProvider({
            audioContextFactory: () => context as unknown as AudioContext,
            scheduler: scheduler(),
            sources: [{ id: 'beacon', kind: 'beacon', element: media(0) }],
        });

        await expect(provider.start()).resolves.toMatchObject({
            ok: false,
            error: { code: 'AUDIO_CONTEXT_SUSPENDED', recoverable: true },
        });
        expect(provider.getStatus().phase).toBe('suspended');
        expect(context.sourceNodes[0]?.connections[0]?.target).toBe(context.destination);
        expect(context.sourceNodes[0]?.disconnectCalls).toBe(0);
        expect(context.close).not.toHaveBeenCalled();
    });

    it('never attaches the same element twice and does not recreate sources on repeated start', async () => {
        const sharedElement = media(0);
        expect(() => new WebAudioHarmonicAnalysisProvider({
            sources: [
                { id: 'one', kind: 'intro', element: sharedElement },
                { id: 'two', kind: 'beacon', element: sharedElement },
            ],
        })).toThrow('Each media element may be attached only once');

        const context = new FakeAudioContext();
        context.state = 'running';
        const provider = new WebAudioHarmonicAnalysisProvider({
            audioContext: context as unknown as AudioContext,
            scheduler: scheduler(),
            sources: [{ id: 'beacon', kind: 'beacon', element: media(0) }],
        });
        await provider.start();
        await provider.start();
        expect(context.sourceNodes).toHaveLength(1);
    });

    it('returns explicit errors and teardown remains non-throwing', async () => {
        const context = new FakeAudioContext();
        context.state = 'running';
        const provider = new WebAudioHarmonicAnalysisProvider({
            audioContext: context as unknown as AudioContext,
            scheduler: scheduler(),
            sources: [{ id: 'beacon', kind: 'beacon', element: media(0) }],
        });
        const statuses = vi.fn();
        provider.subscribeStatus(statuses);
        await provider.start();

        expect(provider.setActiveSource('missing')).toMatchObject({
            ok: false,
            error: { code: 'NO_ACTIVE_SOURCE', recoverable: true },
        });
        expect(() => provider.stop()).not.toThrow();
        expect(() => provider.stop()).not.toThrow();
        expect(provider.getStatus()).toEqual({
            phase: 'stopped',
            activeSourceId: null,
            activeSourceKind: null,
            error: null,
        });
        expect(context.close).not.toHaveBeenCalled();
        expect(statuses).toHaveBeenCalled();
    });
});
