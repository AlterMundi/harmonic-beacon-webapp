import {
    HarmonicFrameMapper,
    validateHarmonicAnalysisConfig,
    type ValidatedHarmonicAnalysisConfig,
} from './harmonic-mapper';
import {
    type HarmonicAnalysisConfig,
    type HarmonicAnalysisError,
    type HarmonicAnalysisFrameListener,
    type HarmonicAnalysisProvider,
    type HarmonicAnalysisProviderStatus,
    type HarmonicAnalysisSourceKind,
    type HarmonicAnalysisStartResult,
    type HarmonicAnalysisStatusListener,
} from './types';

export type WebAudioAnalysisSource = {
    id: string;
    kind: HarmonicAnalysisSourceKind;
    element: HTMLMediaElement;
};

export type HarmonicAnalysisScheduler = {
    request(callback: FrameRequestCallback, delayMs: number): number;
    cancel(handle: number): void;
    now(): number;
};

export type WebAudioHarmonicAnalysisOptions = HarmonicAnalysisConfig & {
    sources: readonly WebAudioAnalysisSource[];
    activeSourceId?: string;
    audioContext?: AudioContext;
    audioContextFactory?: () => AudioContext;
    scheduler?: HarmonicAnalysisScheduler;
};

type AttachedSource = WebAudioAnalysisSource & {
    sourceNode: MediaElementAudioSourceNode;
    splitter: ChannelSplitterNode;
    leftAnalyser: AnalyserNode;
    rightAnalyser: AnalyserNode;
    leftSpectrumDb: Float32Array<ArrayBuffer>;
    rightSpectrumDb: Float32Array<ArrayBuffer>;
    leftWaveform: Float32Array<ArrayBuffer>;
    rightWaveform: Float32Array<ArrayBuffer>;
    mapper: HarmonicFrameMapper;
};

type WindowWithWebkitAudioContext = Window & typeof globalThis & {
    webkitAudioContext?: typeof AudioContext;
};

// A media element can be used to create only one MediaElementSourceNode for
// its lifetime. Keeping the claim weak avoids retaining discarded elements.
const claimedMediaElements = new WeakSet<HTMLMediaElement>();

function defaultAudioContextFactory(): AudioContext {
    if (typeof window === 'undefined') throw new Error('Web Audio is unavailable outside a browser');
    const browserWindow = window as WindowWithWebkitAudioContext;
    const Constructor = browserWindow.AudioContext ?? browserWindow.webkitAudioContext;
    if (!Constructor) throw new Error('This browser does not provide AudioContext');
    return new Constructor();
}

function defaultScheduler(): HarmonicAnalysisScheduler {
    return {
        request: (callback, delayMs) => window.setTimeout(
            () => callback(performance.now()),
            delayMs,
        ),
        cancel: (handle) => window.clearTimeout(handle),
        now: () => performance.now(),
    };
}

function publicError(
    code: HarmonicAnalysisError['code'],
    message: string,
    recoverable: boolean,
): HarmonicAnalysisError {
    return { code, message, recoverable };
}

function stoppedStatus(): HarmonicAnalysisProviderStatus {
    return { phase: 'stopped', activeSourceId: null, activeSourceKind: null, error: null };
}

/**
 * A renderer-independent analysis session for every media element involved in
 * one Listener playback. All sources are attached synchronously during start(),
 * before the first await, so a single trusted Listen gesture can create and
 * resume the complete graph. Switching the observed source never reconnects an
 * audible path.
 */
export class WebAudioHarmonicAnalysisProvider implements HarmonicAnalysisProvider {
    private readonly sources: readonly WebAudioAnalysisSource[];
    private readonly contextFactory: () => AudioContext;
    private readonly injectedContext: AudioContext | undefined;
    private readonly scheduler: HarmonicAnalysisScheduler;
    private readonly config: ValidatedHarmonicAnalysisConfig;
    private readonly frameListeners = new Set<HarmonicAnalysisFrameListener>();
    private readonly statusListeners = new Set<HarmonicAnalysisStatusListener>();
    private readonly attached = new Map<string, AttachedSource>();
    private readonly terminalNodes = new Set<AudioNode>();
    private context: AudioContext | null = null;
    private activeSourceId: string;
    private animationHandle: number | null = null;
    private lastFrameAtMs = Number.NEGATIVE_INFINITY;
    private status: HarmonicAnalysisProviderStatus;
    private ownsContext = false;

    constructor(options: WebAudioHarmonicAnalysisOptions) {
        if (options.sources.length === 0) throw new Error('At least one analysis source is required');
        const ids = new Set<string>();
        const elements = new Set<HTMLMediaElement>();
        for (const source of options.sources) {
            if (!source.id.trim()) throw new Error('Analysis source ids cannot be empty');
            if (ids.has(source.id)) throw new Error(`Duplicate analysis source id: ${source.id}`);
            if (elements.has(source.element)) throw new Error('Each media element may be attached only once');
            ids.add(source.id);
            elements.add(source.element);
        }
        const activeSourceId = options.activeSourceId ?? options.sources[0]?.id;
        if (!activeSourceId || !ids.has(activeSourceId)) {
            throw new Error('activeSourceId must identify a configured source');
        }
        if (options.audioContext && options.audioContextFactory) {
            throw new Error('Provide audioContext or audioContextFactory, not both');
        }

        this.sources = options.sources;
        this.activeSourceId = activeSourceId;
        this.injectedContext = options.audioContext;
        this.contextFactory = options.audioContextFactory ?? defaultAudioContextFactory;
        this.scheduler = options.scheduler ?? defaultScheduler();
        this.config = validateHarmonicAnalysisConfig({
            fftSize: options.fftSize,
            baselineSeconds: options.baselineSeconds,
            framesPerSecond: options.framesPerSecond,
            spectralEnvelopeBands: options.spectralEnvelopeBands,
        });
        const active = this.sources.find(({ id }) => id === activeSourceId) ?? null;
        this.status = {
            phase: 'idle',
            activeSourceId,
            activeSourceKind: active?.kind ?? null,
            error: null,
        };
    }

    getStatus(): HarmonicAnalysisProviderStatus {
        return { ...this.status };
    }

    /** Graph attachment and context.resume() invocation happen before the first await. */
    async start(): Promise<HarmonicAnalysisStartResult> {
        if (this.status.phase === 'stopped') {
            return this.fail(publicError(
                'PROVIDER_STOPPED',
                'A stopped analysis provider cannot be restarted',
                false,
            ));
        }
        if (this.status.phase === 'running') return { ok: true };
        if (this.status.phase === 'paused') return this.resumeAnalysis();
        if (this.status.phase === 'suspended' && this.context) {
            return this.resumeAttachedContext();
        }
        if (this.status.phase === 'error' && this.terminalNodes.size > 0) {
            return {
                ok: false,
                error: this.status.error ?? publicError(
                    'GRAPH_ATTACH_FAILED',
                    'The existing media graph cannot be attached again',
                    true,
                ),
            };
        }
        if (this.status.phase === 'starting') {
            const error = publicError(
                'INVALID_CONFIGURATION',
                'Analysis startup is already in progress',
                true,
            );
            return { ok: false, error };
        }

        this.setStatus({ ...this.status, phase: 'starting', error: null });
        try {
            this.context = this.injectedContext ?? this.contextFactory();
            this.ownsContext = !this.injectedContext;
        } catch {
            return this.fail(publicError(
                'AUDIO_CONTEXT_UNAVAILABLE',
                'The browser could not create an audio analysis context',
                true,
            ));
        }

        try {
            this.attachAllSources(this.context);
            this.context.addEventListener('statechange', this.handleContextStateChange);
        } catch {
            // createMediaElementSource is irreversible for the lifetime of its
            // media element. Preserve every direct branch already attached;
            // integration can keep it audible or remount fresh media elements.
            return this.fail(publicError(
                'GRAPH_ATTACH_FAILED',
                'The media elements could not be attached for analysis',
                true,
            ));
        }

        // Calling resume in this synchronous portion of start preserves the
        // trusted user activation. Only its completion is awaited.
        const resumePromise = this.context.state === 'running'
            ? Promise.resolve()
            : this.context.resume();
        try {
            await resumePromise;
        } catch {
            return this.fail(publicError(
                'AUDIO_CONTEXT_SUSPENDED',
                'The audio analysis context could not be resumed',
                true,
            ), 'suspended');
        }

        if (this.context.state !== 'running') {
            return this.fail(publicError(
                'AUDIO_CONTEXT_SUSPENDED',
                'The audio analysis context remains suspended',
                true,
            ), 'suspended');
        }
        this.setStatus({ ...this.status, phase: 'running', error: null });
        this.scheduleNextFrame();
        return { ok: true };
    }

    setActiveSource(sourceId: string): HarmonicAnalysisStartResult {
        if (this.status.phase === 'stopped') {
            return this.fail(publicError(
                'PROVIDER_STOPPED',
                'A stopped analysis provider cannot change source',
                false,
            ));
        }
        const source = this.sources.find(({ id }) => id === sourceId);
        if (!source) {
            const error = publicError(
                'NO_ACTIVE_SOURCE',
                'The requested analysis source is not attached',
                true,
            );
            this.setStatus({ ...this.status, error });
            return { ok: false, error };
        }
        this.activeSourceId = sourceId;
        this.setStatus({
            ...this.status,
            activeSourceId: sourceId,
            activeSourceKind: source.kind,
            error: null,
        });
        return { ok: true };
    }

    setFramesPerSecond(framesPerSecond: number): HarmonicAnalysisStartResult {
        let validated: ValidatedHarmonicAnalysisConfig;
        try {
            validated = validateHarmonicAnalysisConfig({
                ...this.config,
                framesPerSecond,
            });
        } catch {
            const error = publicError(
                'INVALID_CONFIGURATION',
                'Analysis cadence must be between 1 and 60 frames per second',
                true,
            );
            this.setStatus({ ...this.status, error });
            return { ok: false, error };
        }
        this.config.framesPerSecond = validated.framesPerSecond;
        if (this.status.phase === 'running' && this.animationHandle !== null) {
            try { this.scheduler.cancel(this.animationHandle); } catch { /* non-throwing reschedule */ }
            this.animationHandle = null;
            this.scheduleNextFrame();
        }
        return { ok: true };
    }

    pauseAnalysis(): void {
        if (this.status.phase !== 'running') return;
        if (this.animationHandle !== null) {
            try { this.scheduler.cancel(this.animationHandle); } catch { /* non-throwing pause */ }
            this.animationHandle = null;
        }
        this.setStatus({ ...this.status, phase: 'paused', error: null });
    }

    resumeAnalysis(): HarmonicAnalysisStartResult {
        if (this.status.phase === 'stopped') {
            return this.fail(publicError(
                'PROVIDER_STOPPED',
                'A stopped analysis provider cannot be resumed',
                false,
            ));
        }
        if (!this.context || this.context.state !== 'running') {
            return this.fail(publicError(
                'AUDIO_CONTEXT_SUSPENDED',
                'The audio analysis context is not running',
                true,
            ), 'suspended');
        }
        this.setStatus({ ...this.status, phase: 'running', error: null });
        this.scheduleNextFrame();
        return { ok: true };
    }

    subscribe(listener: HarmonicAnalysisFrameListener): () => void {
        this.frameListeners.add(listener);
        return () => { this.frameListeners.delete(listener); };
    }

    subscribeStatus(listener: HarmonicAnalysisStatusListener): () => void {
        this.statusListeners.add(listener);
        listener(this.getStatus());
        return () => { this.statusListeners.delete(listener); };
    }

    /**
     * Terminal teardown. A MediaElementSource attachment is irreversible, so
     * callers may stop only when every attached media element will be discarded.
     * Use pauseAnalysis() to hide or suspend rendering while audio keeps playing.
     */
    stop(): void {
        if (this.status.phase === 'stopped') return;
        if (this.animationHandle !== null) {
            try { this.scheduler.cancel(this.animationHandle); } catch { /* non-throwing teardown */ }
            this.animationHandle = null;
        }
        if (this.context) {
            try { this.context.removeEventListener('statechange', this.handleContextStateChange); } catch { /* noop */ }
        }
        this.disconnectGraph();
        if (this.context && this.ownsContext) {
            try { void this.context.close().catch(() => undefined); } catch { /* noop */ }
        }
        this.context = null;
        this.setStatus(stoppedStatus());
    }

    private attachAllSources(context: AudioContext): void {
        if (this.attached.size > 0) return;
        for (const source of this.sources) {
            if (claimedMediaElements.has(source.element)) {
                throw new Error('Media element was already attached to a Web Audio source');
            }
            const sourceNode = context.createMediaElementSource(source.element);
            claimedMediaElements.add(source.element);
            this.terminalNodes.add(sourceNode);
            // Establish the sole audible branch immediately. If any later
            // analysis setup fails, the remapped element remains audible.
            sourceNode.connect(context.destination);
            const splitter = context.createChannelSplitter(2);
            this.terminalNodes.add(splitter);
            const leftAnalyser = context.createAnalyser();
            this.terminalNodes.add(leftAnalyser);
            const rightAnalyser = context.createAnalyser();
            this.terminalNodes.add(rightAnalyser);
            const mapper = new HarmonicFrameMapper(this.config);
            const fftSize = this.config.fftSize;
            leftAnalyser.fftSize = fftSize;
            rightAnalyser.fftSize = fftSize;
            leftAnalyser.minDecibels = -120;
            rightAnalyser.minDecibels = -120;
            leftAnalyser.maxDecibels = 0;
            rightAnalyser.maxDecibels = 0;
            leftAnalyser.smoothingTimeConstant = 0;
            rightAnalyser.smoothingTimeConstant = 0;

            // The sole audible branch is direct and unprocessed. Neither
            // analyser is connected to destination.
            sourceNode.connect(splitter);
            splitter.connect(leftAnalyser, 0);
            splitter.connect(rightAnalyser, 1);

            this.attached.set(source.id, {
                ...source,
                sourceNode,
                splitter,
                leftAnalyser,
                rightAnalyser,
                leftSpectrumDb: new Float32Array(leftAnalyser.frequencyBinCount),
                rightSpectrumDb: new Float32Array(rightAnalyser.frequencyBinCount),
                leftWaveform: new Float32Array(fftSize),
                rightWaveform: new Float32Array(fftSize),
                mapper,
            });
        }
    }

    private readonly handleContextStateChange = (): void => {
        if (!this.context || this.status.phase === 'stopped') return;
        if (this.context.state === 'running') {
            if (this.status.phase === 'paused') return;
            this.setStatus({ ...this.status, phase: 'running', error: null });
            this.scheduleNextFrame();
            return;
        }
        this.setStatus({
            ...this.status,
            phase: 'suspended',
            error: publicError(
                'AUDIO_CONTEXT_SUSPENDED',
                'Audio analysis was interrupted or suspended',
                true,
            ),
        });
    };

    private scheduleNextFrame(): void {
        if (this.animationHandle !== null || this.status.phase !== 'running') return;
        const intervalMs = 1000 / this.config.framesPerSecond;
        const elapsedMs = this.scheduler.now() - this.lastFrameAtMs;
        const delayMs = Number.isFinite(elapsedMs)
            ? Math.max(0, intervalMs - elapsedMs)
            : 0;
        this.animationHandle = this.scheduler.request(this.captureFrame, delayMs);
    }

    private readonly captureFrame: FrameRequestCallback = (timestamp): void => {
        this.animationHandle = null;
        if (this.status.phase !== 'running' || !this.context) return;
        const framesPerSecond = this.config.framesPerSecond;
        const capturedAtMs = Number.isFinite(timestamp) ? timestamp : this.scheduler.now();
        if (capturedAtMs - this.lastFrameAtMs < 1000 / framesPerSecond) {
            this.scheduleNextFrame();
            return;
        }
        this.lastFrameAtMs = capturedAtMs;
        const source = this.attached.get(this.activeSourceId);
        if (!source) {
            this.fail(publicError(
                'NO_ACTIVE_SOURCE',
                'No attached source is available for analysis',
                true,
            ));
            return;
        }
        try {
            source.leftAnalyser.getFloatFrequencyData(source.leftSpectrumDb);
            source.rightAnalyser.getFloatFrequencyData(source.rightSpectrumDb);
            source.leftAnalyser.getFloatTimeDomainData(source.leftWaveform);
            source.rightAnalyser.getFloatTimeDomainData(source.rightWaveform);
            const sourceTimeSeconds = Number.isFinite(source.element.currentTime)
                ? source.element.currentTime
                : null;
            const frame = source.mapper.map({
                capturedAtMs,
                sourceTimeSeconds,
                sourceKind: source.kind,
                sampleRate: this.context.sampleRate,
                fftSize: this.config.fftSize,
                leftSpectrumDb: source.leftSpectrumDb,
                rightSpectrumDb: source.rightSpectrumDb,
                leftWaveform: source.leftWaveform,
                rightWaveform: source.rightWaveform,
            });
            for (const listener of this.frameListeners) {
                try { listener(frame); } catch { /* renderer failures never affect audio or analysis */ }
            }
        } catch {
            this.fail(publicError(
                'ANALYSIS_FAILED',
                'The current audio frame could not be analysed',
                true,
            ));
            return;
        }
        this.scheduleNextFrame();
    };

    private disconnectGraph(): void {
        for (const node of this.terminalNodes) {
            try { node.disconnect(); } catch { /* non-throwing teardown */ }
        }
        this.terminalNodes.clear();
        this.attached.clear();
    }

    private async resumeAttachedContext(): Promise<HarmonicAnalysisStartResult> {
        if (!this.context) {
            return this.fail(publicError(
                'AUDIO_CONTEXT_UNAVAILABLE',
                'The existing audio analysis context is unavailable',
                true,
            ));
        }
        this.setStatus({ ...this.status, phase: 'starting', error: null });
        // Invocation occurs synchronously when start() is called from a new
        // trusted gesture; no media source is created or reconnected.
        const resumePromise = this.context.resume();
        try {
            await resumePromise;
        } catch {
            return this.fail(publicError(
                'AUDIO_CONTEXT_SUSPENDED',
                'The audio analysis context could not be resumed',
                true,
            ), 'suspended');
        }
        if (this.context.state !== 'running') {
            return this.fail(publicError(
                'AUDIO_CONTEXT_SUSPENDED',
                'The audio analysis context remains suspended',
                true,
            ), 'suspended');
        }
        this.setStatus({ ...this.status, phase: 'running', error: null });
        this.scheduleNextFrame();
        return { ok: true };
    }

    private fail(
        error: HarmonicAnalysisError,
        phase: HarmonicAnalysisProviderStatus['phase'] = 'error',
    ): HarmonicAnalysisStartResult {
        this.setStatus({ ...this.status, phase, error });
        return { ok: false, error };
    }

    private setStatus(status: HarmonicAnalysisProviderStatus): void {
        this.status = status;
        for (const listener of this.statusListeners) {
            try { listener(this.getStatus()); } catch { /* subscriber isolation */ }
        }
    }
}
