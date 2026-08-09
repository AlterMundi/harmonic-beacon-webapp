export const HARMONIC_ANALYSIS_SCHEMA_VERSION = 1 as const;
export const BEACON_FUNDAMENTAL_HZ = 40.4;
export const HARMONIC_ANALYSIS_MAX_HZ = 20_000;
export const HARMONIC_ANALYSIS_FFT_SIZES = [8192, 16_384] as const;

export type HarmonicAnalysisFftSize = typeof HARMONIC_ANALYSIS_FFT_SIZES[number];
export type HarmonicAnalysisSourceKind = 'intro' | 'beacon';

/**
 * Renderer-neutral analysis data. Array index n represents harmonic n + 1 of
 * the 40.4 Hz Beacon fundamental. Values are measurements, not display-normalized
 * intensities, so renderers cannot accidentally erase the absolute hierarchy.
 */
export type HarmonicAnalysisFrame = {
    schemaVersion: typeof HARMONIC_ANALYSIS_SCHEMA_VERSION;
    capturedAtMs: number;
    sourceTimeSeconds: number | null;
    overallDb: number;
    harmonicAbsoluteDb: Float32Array;
    harmonicDeltaDb: Float32Array;
    spectralEnvelopeDb: Float32Array;
    stereoBalance: number;
    stereoWidth: number;
    confidence: number;
    sourceKind: HarmonicAnalysisSourceKind;
};

export type HarmonicAnalysisErrorCode =
    | 'AUDIO_CONTEXT_UNAVAILABLE'
    | 'AUDIO_CONTEXT_SUSPENDED'
    | 'GRAPH_ATTACH_FAILED'
    | 'INVALID_CONFIGURATION'
    | 'NO_ACTIVE_SOURCE'
    | 'PROVIDER_STOPPED'
    | 'ANALYSIS_FAILED';

export type HarmonicAnalysisError = {
    code: HarmonicAnalysisErrorCode;
    message: string;
    recoverable: boolean;
};

export type HarmonicAnalysisProviderPhase =
    | 'idle'
    | 'starting'
    | 'running'
    | 'paused'
    | 'suspended'
    | 'error'
    | 'stopped';

export type HarmonicAnalysisProviderStatus = {
    phase: HarmonicAnalysisProviderPhase;
    activeSourceId: string | null;
    activeSourceKind: HarmonicAnalysisSourceKind | null;
    error: HarmonicAnalysisError | null;
};

export type HarmonicAnalysisStartResult =
    | { ok: true }
    | { ok: false; error: HarmonicAnalysisError };

export type HarmonicAnalysisFrameListener = (frame: HarmonicAnalysisFrame) => void;
export type HarmonicAnalysisStatusListener = (status: HarmonicAnalysisProviderStatus) => void;

export interface HarmonicAnalysisProvider {
    getStatus(): HarmonicAnalysisProviderStatus;
    start(): Promise<HarmonicAnalysisStartResult>;
    setActiveSource(sourceId: string): HarmonicAnalysisStartResult;
    pauseAnalysis(): void;
    resumeAnalysis(): HarmonicAnalysisStartResult;
    subscribe(listener: HarmonicAnalysisFrameListener): () => void;
    subscribeStatus(listener: HarmonicAnalysisStatusListener): () => void;
    stop(): void;
}

export type HarmonicAnalysisConfig = {
    fftSize?: HarmonicAnalysisFftSize;
    baselineSeconds?: number;
    framesPerSecond?: number;
    spectralEnvelopeBands?: number;
};
