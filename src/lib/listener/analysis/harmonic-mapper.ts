import {
    BEACON_FUNDAMENTAL_HZ,
    HARMONIC_ANALYSIS_FFT_SIZES,
    HARMONIC_ANALYSIS_MAX_HZ,
    HARMONIC_ANALYSIS_SCHEMA_VERSION,
    type HarmonicAnalysisConfig,
    type HarmonicAnalysisFftSize,
    type HarmonicAnalysisFrame,
    type HarmonicAnalysisSourceKind,
} from './types';

const DB_FLOOR = -120;
const DB_CEILING = 0;
const MAX_DELTA_DB = 24;
const DEFAULT_ENVELOPE_BANDS = 32;

export type SpectrumObservation = {
    capturedAtMs: number;
    sourceTimeSeconds: number | null;
    sourceKind: HarmonicAnalysisSourceKind;
    sampleRate: number;
    fftSize: HarmonicAnalysisFftSize;
    leftSpectrumDb: Float32Array;
    rightSpectrumDb: Float32Array;
    leftWaveform: Float32Array;
    rightWaveform: Float32Array;
};

export type ValidatedHarmonicAnalysisConfig = Required<HarmonicAnalysisConfig>;

function finiteNumber(value: number, name: string): void {
    if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function boundedDb(value: number): number {
    return Number.isFinite(value) ? clamp(value, DB_FLOOR, DB_CEILING) : DB_FLOOR;
}

function dbToPower(value: number): number {
    return 10 ** (boundedDb(value) / 10);
}

function powerToDb(value: number): number {
    if (!Number.isFinite(value) || value <= 10 ** (DB_FLOOR / 10)) return DB_FLOOR;
    return clamp(10 * Math.log10(value), DB_FLOOR, DB_CEILING);
}

function meanPowerDb(values: Float32Array, first: number, last: number): number {
    let power = 0;
    let count = 0;
    for (let index = first; index <= last; index += 1) {
        power += dbToPower(values[index] ?? DB_FLOOR);
        count += 1;
    }
    return powerToDb(count > 0 ? power / count : 0);
}

function channelAverageDb(left: Float32Array, right: Float32Array): Float32Array {
    const result = new Float32Array(left.length);
    for (let index = 0; index < left.length; index += 1) {
        result[index] = powerToDb(
            (dbToPower(left[index] ?? DB_FLOOR) + dbToPower(right[index] ?? DB_FLOOR)) / 2,
        );
    }
    return result;
}

function waveformMetrics(left: Float32Array, right: Float32Array): {
    overallDb: number;
    stereoBalance: number;
    stereoWidth: number;
    confidence: number;
} {
    let leftPower = 0;
    let rightPower = 0;
    let midPower = 0;
    let sidePower = 0;
    let valid = 0;
    const length = Math.min(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
        const leftValue = left[index];
        const rightValue = right[index];
        if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) continue;
        leftPower += leftValue * leftValue;
        rightPower += rightValue * rightValue;
        const mid = (leftValue + rightValue) / 2;
        const side = (leftValue - rightValue) / 2;
        midPower += mid * mid;
        sidePower += side * side;
        valid += 1;
    }

    if (valid === 0) {
        return { overallDb: DB_FLOOR, stereoBalance: 0, stereoWidth: 0, confidence: 0 };
    }

    leftPower /= valid;
    rightPower /= valid;
    midPower /= valid;
    sidePower /= valid;
    const totalChannelPower = leftPower + rightPower;
    const midRms = Math.sqrt(midPower);
    const sideRms = Math.sqrt(sidePower);
    const overallDb = powerToDb(totalChannelPower / 2);
    const confidence = clamp((overallDb - DB_FLOOR) / 60, 0, 1);
    return {
        overallDb,
        stereoBalance: totalChannelPower > 0
            ? clamp((rightPower - leftPower) / totalChannelPower, -1, 1)
            : 0,
        stereoWidth: midRms + sideRms > 0
            ? clamp(sideRms / (midRms + sideRms), 0, 1)
            : 0,
        confidence,
    };
}

export function validateHarmonicAnalysisConfig(
    config: HarmonicAnalysisConfig = {},
): ValidatedHarmonicAnalysisConfig {
    const fftSize = config.fftSize ?? 16_384;
    if (!(HARMONIC_ANALYSIS_FFT_SIZES as readonly number[]).includes(fftSize)) {
        throw new Error('fftSize must be 8192 or 16384');
    }
    const baselineSeconds = config.baselineSeconds ?? 30;
    const framesPerSecond = config.framesPerSecond ?? 30;
    const spectralEnvelopeBands = config.spectralEnvelopeBands ?? DEFAULT_ENVELOPE_BANDS;
    for (const [name, value] of Object.entries({
        baselineSeconds,
        framesPerSecond,
        spectralEnvelopeBands,
    })) finiteNumber(value, name);
    if (baselineSeconds <= 0 || baselineSeconds > 300) {
        throw new Error('baselineSeconds must be in (0, 300]');
    }
    if (framesPerSecond < 1 || framesPerSecond > 60) {
        throw new Error('framesPerSecond must be in [1, 60]');
    }
    if (!Number.isInteger(spectralEnvelopeBands)
        || spectralEnvelopeBands < 8
        || spectralEnvelopeBands > 64) {
        throw new Error('spectralEnvelopeBands must be an integer in [8, 64]');
    }
    return { fftSize, baselineSeconds, framesPerSecond, spectralEnvelopeBands };
}

export function harmonicFrequencyHz(harmonicIndex: number): number {
    if (!Number.isInteger(harmonicIndex) || harmonicIndex < 0) {
        throw new Error('harmonicIndex must be a non-negative integer');
    }
    return (harmonicIndex + 1) * BEACON_FUNDAMENTAL_HZ;
}

export function harmonicCountForSampleRate(sampleRate: number): number {
    finiteNumber(sampleRate, 'sampleRate');
    if (sampleRate <= 0) throw new Error('sampleRate must be positive');
    return Math.floor(Math.min(HARMONIC_ANALYSIS_MAX_HZ, sampleRate / 2) / BEACON_FUNDAMENTAL_HZ);
}

function validateObservation(observation: SpectrumObservation): void {
    finiteNumber(observation.capturedAtMs, 'capturedAtMs');
    finiteNumber(observation.sampleRate, 'sampleRate');
    if (observation.sourceTimeSeconds !== null) {
        finiteNumber(observation.sourceTimeSeconds, 'sourceTimeSeconds');
    }
    if (observation.sampleRate <= BEACON_FUNDAMENTAL_HZ * 2) {
        throw new Error('sampleRate is too low for the Beacon fundamental');
    }
    if (!(HARMONIC_ANALYSIS_FFT_SIZES as readonly number[]).includes(observation.fftSize)) {
        throw new Error('fftSize must be 8192 or 16384');
    }
    const expectedBins = observation.fftSize / 2;
    if (observation.leftSpectrumDb.length !== expectedBins
        || observation.rightSpectrumDb.length !== expectedBins) {
        throw new Error(`spectra must contain exactly ${expectedBins} bins`);
    }
    if (observation.leftWaveform.length !== observation.fftSize
        || observation.rightWaveform.length !== observation.fftSize) {
        throw new Error(`waveforms must contain exactly ${observation.fftSize} samples`);
    }
}

function extractHarmonics(
    spectrum: Float32Array,
    sampleRate: number,
    fftSize: number,
): Float32Array {
    const binWidthHz = sampleRate / fftSize;
    const count = harmonicCountForSampleRate(sampleRate);
    const result = new Float32Array(count);
    const halfWindowHz = Math.max(binWidthHz, BEACON_FUNDAMENTAL_HZ * 0.1);
    for (let index = 0; index < count; index += 1) {
        const centerHz = harmonicFrequencyHz(index);
        const first = clamp(Math.floor((centerHz - halfWindowHz) / binWidthHz), 0, spectrum.length - 1);
        const last = clamp(Math.ceil((centerHz + halfWindowHz) / binWidthHz), first, spectrum.length - 1);
        result[index] = meanPowerDb(spectrum, first, last);
    }
    return result;
}

function extractEnvelope(
    spectrum: Float32Array,
    sampleRate: number,
    fftSize: number,
    bandCount: number,
): Float32Array {
    const result = new Float32Array(bandCount);
    const binWidthHz = sampleRate / fftSize;
    const minimumHz = BEACON_FUNDAMENTAL_HZ / 2;
    const maximumHz = Math.min(HARMONIC_ANALYSIS_MAX_HZ, sampleRate / 2);
    const ratio = maximumHz / minimumHz;
    for (let index = 0; index < bandCount; index += 1) {
        const firstHz = minimumHz * ratio ** (index / bandCount);
        const lastHz = minimumHz * ratio ** ((index + 1) / bandCount);
        const first = clamp(Math.floor(firstHz / binWidthHz), 0, spectrum.length - 1);
        const last = clamp(Math.ceil(lastHz / binWidthHz), first, spectrum.length - 1);
        result[index] = meanPowerDb(spectrum, first, last);
    }
    return result;
}

export class HarmonicFrameMapper {
    private readonly config: ValidatedHarmonicAnalysisConfig;
    private baselineDb: Float32Array | null = null;
    private previousCapturedAtMs: number | null = null;

    constructor(config: HarmonicAnalysisConfig = {}) {
        this.config = validateHarmonicAnalysisConfig(config);
    }

    map(observation: SpectrumObservation): HarmonicAnalysisFrame {
        validateObservation(observation);
        if (observation.fftSize !== this.config.fftSize) {
            throw new Error(`observation fftSize must match configured fftSize ${this.config.fftSize}`);
        }

        const combinedSpectrum = channelAverageDb(
            observation.leftSpectrumDb,
            observation.rightSpectrumDb,
        );
        const harmonicAbsoluteDb = extractHarmonics(
            combinedSpectrum,
            observation.sampleRate,
            observation.fftSize,
        );

        if (!this.baselineDb || this.baselineDb.length !== harmonicAbsoluteDb.length) {
            this.baselineDb = new Float32Array(harmonicAbsoluteDb);
        }
        const elapsedSeconds = this.previousCapturedAtMs === null
            ? 0
            : Math.max(0, observation.capturedAtMs - this.previousCapturedAtMs) / 1000;
        const alpha = 1 - Math.exp(-elapsedSeconds / this.config.baselineSeconds);
        const harmonicDeltaDb = new Float32Array(harmonicAbsoluteDb.length);
        for (let index = 0; index < harmonicAbsoluteDb.length; index += 1) {
            const previousBaseline = this.baselineDb[index] ?? harmonicAbsoluteDb[index];
            harmonicDeltaDb[index] = clamp(
                harmonicAbsoluteDb[index] - previousBaseline,
                -MAX_DELTA_DB,
                MAX_DELTA_DB,
            );
            this.baselineDb[index] = previousBaseline
                + alpha * (harmonicAbsoluteDb[index] - previousBaseline);
        }
        this.previousCapturedAtMs = observation.capturedAtMs;

        const metrics = waveformMetrics(observation.leftWaveform, observation.rightWaveform);
        return {
            schemaVersion: HARMONIC_ANALYSIS_SCHEMA_VERSION,
            capturedAtMs: observation.capturedAtMs,
            sourceTimeSeconds: observation.sourceTimeSeconds,
            overallDb: metrics.overallDb,
            harmonicAbsoluteDb,
            harmonicDeltaDb,
            spectralEnvelopeDb: extractEnvelope(
                combinedSpectrum,
                observation.sampleRate,
                observation.fftSize,
                this.config.spectralEnvelopeBands,
            ),
            stereoBalance: metrics.stereoBalance,
            stereoWidth: metrics.stereoWidth,
            confidence: metrics.confidence,
            sourceKind: observation.sourceKind,
        };
    }

    resetBaseline(): void {
        this.baselineDb = null;
        this.previousCapturedAtMs = null;
    }
}
