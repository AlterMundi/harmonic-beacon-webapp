import {
    HARMONIC_ANALYSIS_SCHEMA_VERSION,
    type HarmonicAnalysisError,
    type HarmonicAnalysisFrame,
    type HarmonicAnalysisFrameListener,
    type HarmonicAnalysisProvider,
    type HarmonicAnalysisProviderStatus,
    type HarmonicAnalysisSourceKind,
    type HarmonicAnalysisStartResult,
    type HarmonicAnalysisStatusListener,
} from './types';

type RemoteAnalysisSource = { id: string; kind: HarmonicAnalysisSourceKind };

export type RemoteHarmonicAnalysisOptions = {
    endpoint: string;
    sources: readonly RemoteAnalysisSource[];
    activeSourceId?: string;
    framesPerSecond?: number;
    getPlaybackProgramTimeMs: () => number | null;
    getLeaseCursor: () => { leaseId: string; leaseGeneration: number } | null;
    fetcher?: typeof fetch;
    setTimer?: typeof window.setTimeout;
    clearTimer?: typeof window.clearTimeout;
};

function publicError(code: HarmonicAnalysisError['code'], message: string): HarmonicAnalysisError {
    return { code, message, recoverable: true };
}

function finiteArray(value: unknown, maximumLength: number): Float32Array | null {
    if (!Array.isArray(value) || value.length > maximumLength) return null;
    const output = new Float32Array(value.length);
    for (let index = 0; index < value.length; index += 1) {
        if (typeof value[index] !== 'number' || !Number.isFinite(value[index])) return null;
        output[index] = value[index];
    }
    return output;
}

export function parseRemoteHarmonicFrame(value: unknown): HarmonicAnalysisFrame | null {
    if (!value || typeof value !== 'object') return null;
    const input = value as Record<string, unknown>;
    const absolute = finiteArray(input.harmonicAbsoluteDb, 512);
    const delta = finiteArray(input.harmonicDeltaDb, 512);
    const envelope = finiteArray(input.spectralEnvelopeDb, 64);
    if (input.schemaVersion !== HARMONIC_ANALYSIS_SCHEMA_VERSION
        || typeof input.capturedAtMs !== 'number' || !Number.isFinite(input.capturedAtMs)
        || (input.sourceTimeSeconds !== null
            && (typeof input.sourceTimeSeconds !== 'number' || !Number.isFinite(input.sourceTimeSeconds)))
        || typeof input.overallDb !== 'number' || !Number.isFinite(input.overallDb)
        || !absolute || !delta || absolute.length !== delta.length || absolute.length < 1
        || !envelope
        || typeof input.stereoBalance !== 'number' || !Number.isFinite(input.stereoBalance)
        || typeof input.stereoWidth !== 'number' || !Number.isFinite(input.stereoWidth)
        || typeof input.confidence !== 'number' || !Number.isFinite(input.confidence)
        || input.sourceKind !== 'beacon') return null;
    return {
        schemaVersion: HARMONIC_ANALYSIS_SCHEMA_VERSION,
        capturedAtMs: input.capturedAtMs,
        sourceTimeSeconds: input.sourceTimeSeconds,
        overallDb: input.overallDb,
        harmonicAbsoluteDb: absolute,
        harmonicDeltaDb: delta,
        spectralEnvelopeDb: envelope,
        stereoBalance: input.stereoBalance,
        stereoWidth: input.stereoWidth,
        confidence: input.confidence,
        sourceKind: 'beacon',
    };
}

export class RemoteHarmonicAnalysisProvider implements HarmonicAnalysisProvider {
    private readonly sources: readonly RemoteAnalysisSource[];
    private readonly endpoint: string;
    private readonly getPlaybackProgramTimeMs: () => number | null;
    private readonly getLeaseCursor: () => { leaseId: string; leaseGeneration: number } | null;
    private readonly fetcher: typeof fetch;
    private readonly setTimer: typeof window.setTimeout;
    private readonly clearTimer: typeof window.clearTimeout;
    private readonly frameListeners = new Set<HarmonicAnalysisFrameListener>();
    private readonly statusListeners = new Set<HarmonicAnalysisStatusListener>();
    private activeSourceId: string;
    private framesPerSecond: number;
    private timer: number | null = null;
    private request: AbortController | null = null;
    private failures = 0;
    private requestGeneration = 0;
    private baselineDb: Float32Array | null = null;
    private previousCapturedAtMs: number | null = null;
    private status: HarmonicAnalysisProviderStatus;

    constructor(options: RemoteHarmonicAnalysisOptions) {
        if (!options.endpoint.startsWith('/')) throw new Error('Remote analysis endpoint must be same-origin');
        if (options.sources.length === 0) throw new Error('At least one remote analysis source is required');
        const ids = new Set(options.sources.map(({ id }) => id));
        const activeSourceId = options.activeSourceId ?? options.sources[0].id;
        if (!ids.has(activeSourceId)) throw new Error('Invalid active remote analysis source');
        this.sources = options.sources;
        this.endpoint = options.endpoint;
        this.activeSourceId = activeSourceId;
        this.framesPerSecond = this.validatedFramesPerSecond(options.framesPerSecond ?? 4);
        this.getPlaybackProgramTimeMs = options.getPlaybackProgramTimeMs;
        this.getLeaseCursor = options.getLeaseCursor;
        this.fetcher = options.fetcher ?? fetch;
        this.setTimer = options.setTimer ?? window.setTimeout.bind(window);
        this.clearTimer = options.clearTimer ?? window.clearTimeout.bind(window);
        const active = this.sources.find(({ id }) => id === activeSourceId)!;
        this.status = {
            phase: 'idle',
            activeSourceId,
            activeSourceKind: active.kind,
            error: null,
        };
    }

    private validatedFramesPerSecond(value: number): number {
        if (!Number.isFinite(value) || value < 1 || value > 10) {
            throw new Error('Remote analysis cadence must be between 1 and 10 fps');
        }
        return value;
    }

    getStatus(): HarmonicAnalysisProviderStatus { return { ...this.status }; }

    start(): Promise<HarmonicAnalysisStartResult> {
        if (this.status.phase === 'stopped') {
            return Promise.resolve({
                ok: false,
                error: publicError('PROVIDER_STOPPED', 'Remote analysis was stopped'),
            });
        }
        this.setStatus({ ...this.status, phase: 'running', error: null });
        this.schedule(0);
        return Promise.resolve({ ok: true });
    }

    setActiveSource(sourceId: string): HarmonicAnalysisStartResult {
        const source = this.sources.find(({ id }) => id === sourceId);
        if (!source) {
            return {
                ok: false,
                error: publicError('NO_ACTIVE_SOURCE', 'Unknown remote analysis source'),
            };
        }
        const wasRunning = this.status.phase === 'running';
        this.cancelPending();
        this.baselineDb = null;
        this.previousCapturedAtMs = null;
        this.activeSourceId = sourceId;
        this.setStatus({
            ...this.status,
            activeSourceId: sourceId,
            activeSourceKind: source.kind,
            error: null,
        });
        if (wasRunning) this.schedule(0);
        return { ok: true };
    }

    setFramesPerSecond(framesPerSecond: number): HarmonicAnalysisStartResult {
        try {
            this.framesPerSecond = this.validatedFramesPerSecond(framesPerSecond);
            if (this.status.phase === 'running') {
                this.cancelPending();
                this.schedule(0);
            }
            return { ok: true };
        } catch {
            return {
                ok: false,
                error: publicError('INVALID_CONFIGURATION', 'Invalid remote analysis cadence'),
            };
        }
    }

    pauseAnalysis(): void {
        if (this.status.phase !== 'running') return;
        this.cancelPending();
        this.setStatus({ ...this.status, phase: 'paused', error: null });
    }

    resumeAnalysis(): HarmonicAnalysisStartResult {
        if (this.status.phase === 'stopped') {
            return {
                ok: false,
                error: publicError('PROVIDER_STOPPED', 'Remote analysis was stopped'),
            };
        }
        this.setStatus({ ...this.status, phase: 'running', error: null });
        this.schedule(0);
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

    stop(): void {
        if (this.status.phase === 'stopped') return;
        this.cancelPending();
        this.frameListeners.clear();
        this.setStatus({ phase: 'stopped', activeSourceId: null, activeSourceKind: null, error: null });
    }

    private cancelPending(): void {
        this.requestGeneration += 1;
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = null;
        this.request?.abort();
        this.request = null;
    }

    private schedule(delayMs: number): void {
        if (this.status.phase !== 'running') return;
        if (this.timer !== null) this.clearTimer(this.timer);
        this.timer = this.setTimer(() => {
            this.timer = null;
            void this.capture();
        }, delayMs);
    }

    private async capture(): Promise<void> {
        if (this.status.phase !== 'running') return;
        const source = this.sources.find(({ id }) => id === this.activeSourceId);
        const programTimeMs = source?.kind === 'beacon' ? this.getPlaybackProgramTimeMs() : null;
        const lease = source?.kind === 'beacon' ? this.getLeaseCursor() : null;
        if (programTimeMs === null || !Number.isFinite(programTimeMs) || !lease) {
            this.schedule(250);
            return;
        }
        const generation = this.requestGeneration;
        const sourceId = this.activeSourceId;
        const controller = new AbortController();
        this.request = controller;
        let nextDelayMs = 1_000 / this.framesPerSecond;
        try {
            const response = await this.fetcher(
                `${this.endpoint}?at=${encodeURIComponent(Math.round(programTimeMs))}`
                    + `&leaseId=${encodeURIComponent(lease.leaseId)}`
                    + `&leaseGeneration=${encodeURIComponent(lease.leaseGeneration)}`,
                { cache: 'no-store', credentials: 'same-origin', signal: controller.signal },
            );
            if (!response.ok) throw new Error('Remote analysis unavailable');
            const parsed = parseRemoteHarmonicFrame(await response.json());
            if (controller.signal.aborted
                || generation !== this.requestGeneration
                || sourceId !== this.activeSourceId
                || this.status.phase !== 'running') return;
            const frame = parsed ? this.applySlowBaseline(parsed) : null;
            if (!frame) throw new Error('Invalid remote analysis frame');
            const wasRecovering = this.failures > 0 || this.status.error !== null;
            this.failures = 0;
            if (wasRecovering) {
                this.setStatus({ ...this.status, phase: 'running', error: null });
            }
            for (const listener of this.frameListeners) {
                try { listener(frame); } catch { /* renderer isolation */ }
            }
        } catch {
            if (controller.signal.aborted || this.status.phase !== 'running') return;
            this.failures += 1;
            nextDelayMs = Math.min(5_000, 250 * (2 ** Math.min(this.failures - 1, 4)));
            if (this.failures >= 4) {
                this.setStatus({
                    ...this.status,
                    phase: 'running',
                    error: publicError('ANALYSIS_FAILED', 'Server analysis is temporarily unavailable'),
                });
            }
        } finally {
            if (this.request === controller) this.request = null;
        }
        this.schedule(nextDelayMs);
    }

    private applySlowBaseline(frame: HarmonicAnalysisFrame): HarmonicAnalysisFrame {
        const baselineDb = this.baselineDb;
        const previousCapturedAtMs = this.previousCapturedAtMs;
        if (!baselineDb
            || baselineDb.length !== frame.harmonicAbsoluteDb.length
            || previousCapturedAtMs === null
            || frame.capturedAtMs < previousCapturedAtMs
            || frame.capturedAtMs - previousCapturedAtMs > 10_000) {
            this.baselineDb = new Float32Array(frame.harmonicAbsoluteDb);
            this.previousCapturedAtMs = frame.capturedAtMs;
            return { ...frame, harmonicDeltaDb: new Float32Array(frame.harmonicAbsoluteDb.length) };
        }
        const elapsedSeconds = Math.max(0, frame.capturedAtMs - previousCapturedAtMs) / 1_000;
        const alpha = 1 - Math.exp(-elapsedSeconds / 24);
        const delta = new Float32Array(frame.harmonicAbsoluteDb.length);
        for (let index = 0; index < delta.length; index += 1) {
            const absolute = frame.harmonicAbsoluteDb[index];
            const baseline = baselineDb[index];
            delta[index] = Math.min(24, Math.max(-24, absolute - baseline));
            baselineDb[index] = baseline + alpha * (absolute - baseline);
        }
        this.previousCapturedAtMs = frame.capturedAtMs;
        return { ...frame, harmonicDeltaDb: delta };
    }

    private setStatus(status: HarmonicAnalysisProviderStatus): void {
        this.status = status;
        for (const listener of this.statusListeners) {
            try { listener(this.getStatus()); } catch { /* observer isolation */ }
        }
    }
}
