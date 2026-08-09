import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
    BEACON_FUNDAMENTAL_HZ,
    HARMONIC_ANALYSIS_MAX_HZ,
    HARMONIC_ANALYSIS_SCHEMA_VERSION,
    type HarmonicAnalysisFrame,
} from './types';

const SAMPLE_RATE = 48_000;
const FFT_SIZE = 16_384;
const FRAMES_PER_SECOND = 4;
const MAX_CACHE_SEGMENTS = 36;
const MAX_CONCURRENT_DECODES = 2;
const MAX_PCM_BYTES = 4 * 1024 * 1024;
const ARTIFACT_ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const MEDIA_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export type ArtifactSegment = { file: string; durationSeconds: number };
export type ArtifactMetadata = {
    schemaVersion: 1 | 2;
    artifactId: string;
    timing: {
        epochUtc: string;
        segmentDurationSeconds?: number;
        loopDurationSeconds?: number;
        segmentCount: number;
    };
    initialization?: { file: string };
    segments: ArtifactSegment[];
};

export type ArtifactPosition = {
    segmentIndex: number;
    segmentOffsetSeconds: number;
    segmentProgramStartMs: number;
};

type RelativeFrame = Omit<HarmonicAnalysisFrame, 'capturedAtMs'> & {
    offsetSeconds: number;
};

function clamp(value: number, minimum: number, maximum: number): number {
    return Math.min(maximum, Math.max(minimum, value));
}

function decibels(amplitude: number): number {
    return clamp(20 * Math.log10(Math.max(amplitude, 1e-6)), -120, 0);
}

export function normalizeAnalysisArtifactMetadata(raw: ArtifactMetadata): ArtifactMetadata & {
    epochMs: number;
    loopDurationSeconds: number;
    segmentStartsSeconds: number[];
} {
    if (!raw || ![1, 2].includes(raw.schemaVersion)
        || !ARTIFACT_ID.test(raw.artifactId)
        || !Number.isFinite(Date.parse(raw.timing?.epochUtc))
        || !Number.isSafeInteger(raw.timing?.segmentCount)
        || raw.timing.segmentCount < 1
        || !Array.isArray(raw.segments)
        || raw.segments.length !== raw.timing.segmentCount) {
        throw new Error('Invalid Listener analysis artifact metadata');
    }
    const durationFallback = raw.timing.segmentDurationSeconds;
    const segments = raw.segments.map((segment) => {
        const durationSeconds = segment.durationSeconds ?? durationFallback;
        if (!MEDIA_FILE.test(segment.file) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
            throw new Error('Invalid Listener analysis segment metadata');
        }
        return { file: segment.file, durationSeconds };
    });
    if (raw.initialization && !MEDIA_FILE.test(raw.initialization.file)) {
        throw new Error('Invalid Listener analysis initialization metadata');
    }
    const segmentStartsSeconds: number[] = [];
    let measuredDuration = 0;
    for (const segment of segments) {
        segmentStartsSeconds.push(measuredDuration);
        measuredDuration += segment.durationSeconds;
    }
    const declaredLoop = raw.timing.loopDurationSeconds ?? measuredDuration;
    if (!Number.isFinite(declaredLoop) || Math.abs(declaredLoop - measuredDuration) > 0.01) {
        throw new Error('Listener analysis loop duration mismatch');
    }
    return {
        ...raw,
        segments,
        epochMs: Date.parse(raw.timing.epochUtc),
        loopDurationSeconds: measuredDuration,
        segmentStartsSeconds,
    };
}

export function resolveArtifactPosition(
    metadata: ReturnType<typeof normalizeAnalysisArtifactMetadata>,
    programTimeMs: number,
): ArtifactPosition {
    if (!Number.isFinite(programTimeMs)) throw new Error('Invalid program timestamp');
    const elapsedSeconds = Math.max(0, (programTimeMs - metadata.epochMs) / 1_000);
    const loopPosition = elapsedSeconds % metadata.loopDurationSeconds;
    let segmentIndex = metadata.segments.length - 1;
    for (let index = 0; index < metadata.segments.length; index += 1) {
        if (loopPosition < metadata.segmentStartsSeconds[index]
            + metadata.segments[index].durationSeconds) {
            segmentIndex = index;
            break;
        }
    }
    const segmentOffsetSeconds = loopPosition - metadata.segmentStartsSeconds[segmentIndex];
    return {
        segmentIndex,
        segmentOffsetSeconds,
        segmentProgramStartMs: programTimeMs - segmentOffsetSeconds * 1_000,
    };
}

const hannWindow = Float64Array.from(
    { length: FFT_SIZE },
    (_, index) => 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (FFT_SIZE - 1)),
);
const hannSum = hannWindow.reduce((sum, value) => sum + value, 0);

function fft(real: Float64Array, imaginary: Float64Array): void {
    const size = real.length;
    for (let index = 1, reversed = 0; index < size; index += 1) {
        let bit = size >> 1;
        while (reversed & bit) {
            reversed ^= bit;
            bit >>= 1;
        }
        reversed ^= bit;
        if (index < reversed) {
            [real[index], real[reversed]] = [real[reversed], real[index]];
            [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
        }
    }
    for (let length = 2; length <= size; length <<= 1) {
        const angle = -2 * Math.PI / length;
        const baseReal = Math.cos(angle);
        const baseImaginary = Math.sin(angle);
        for (let start = 0; start < size; start += length) {
            let twiddleReal = 1;
            let twiddleImaginary = 0;
            for (let offset = 0; offset < length / 2; offset += 1) {
                const even = start + offset;
                const odd = even + length / 2;
                const oddReal = real[odd] * twiddleReal - imaginary[odd] * twiddleImaginary;
                const oddImaginary = real[odd] * twiddleImaginary + imaginary[odd] * twiddleReal;
                real[odd] = real[even] - oddReal;
                imaginary[odd] = imaginary[even] - oddImaginary;
                real[even] += oddReal;
                imaginary[even] += oddImaginary;
                const nextReal = twiddleReal * baseReal - twiddleImaginary * baseImaginary;
                twiddleImaginary = twiddleReal * baseImaginary + twiddleImaginary * baseReal;
                twiddleReal = nextReal;
            }
        }
    }
}

export function analyzePcmSegment(
    pcm: Float32Array,
    durationSeconds: number,
): RelativeFrame[] {
    const sampleFrames = Math.floor(pcm.length / 2);
    if (sampleFrames < FFT_SIZE || durationSeconds <= 0) return [];
    const frameCount = Math.max(1, Math.floor(durationSeconds * FRAMES_PER_SECOND));
    const harmonicCount = Math.floor(
        Math.min(HARMONIC_ANALYSIS_MAX_HZ, SAMPLE_RATE / 2) / BEACON_FUNDAMENTAL_HZ,
    );
    const frames: RelativeFrame[] = [];

    for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
        const offsetSeconds = Math.min(
            durationSeconds,
            (frameIndex + 0.5) / FRAMES_PER_SECOND,
        );
        const centerSample = Math.round(offsetSeconds * SAMPLE_RATE);
        const firstSample = clamp(
            centerSample - FFT_SIZE / 2,
            0,
            Math.max(0, sampleFrames - FFT_SIZE),
        );
        const real = new Float64Array(FFT_SIZE);
        const imaginary = new Float64Array(FFT_SIZE);
        let leftPower = 0;
        let rightPower = 0;
        let sidePower = 0;
        for (let index = 0; index < FFT_SIZE; index += 1) {
            const left = pcm[(firstSample + index) * 2] ?? 0;
            const right = pcm[(firstSample + index) * 2 + 1] ?? left;
            const mono = (left + right) * 0.5;
            real[index] = mono * hannWindow[index];
            leftPower += left * left;
            rightPower += right * right;
            const side = left - right;
            sidePower += side * side;
        }
        fft(real, imaginary);
        const spectralEnvelopeDb = new Float32Array(32);
        const minimumHz = BEACON_FUNDAMENTAL_HZ / 2;
        const maximumHz = Math.min(HARMONIC_ANALYSIS_MAX_HZ, SAMPLE_RATE / 2);
        const frequencyRatio = maximumHz / minimumHz;
        for (let band = 0; band < spectralEnvelopeDb.length; band += 1) {
            const firstHz = minimumHz * frequencyRatio ** (band / spectralEnvelopeDb.length);
            const lastHz = minimumHz * frequencyRatio ** ((band + 1) / spectralEnvelopeDb.length);
            const firstBin = clamp(Math.floor(firstHz * FFT_SIZE / SAMPLE_RATE), 1, FFT_SIZE / 2 - 1);
            const lastBin = clamp(Math.ceil(lastHz * FFT_SIZE / SAMPLE_RATE), firstBin, FFT_SIZE / 2 - 1);
            let power = 0;
            let count = 0;
            for (let bin = firstBin; bin <= lastBin; bin += 1) {
                const amplitude = 2 * Math.hypot(real[bin], imaginary[bin]) / hannSum;
                power += amplitude * amplitude;
                count += 1;
            }
            spectralEnvelopeDb[band] = decibels(Math.sqrt(power / Math.max(1, count)));
        }
        const harmonicAbsoluteDb = new Float32Array(harmonicCount);
        for (let harmonicIndex = 0; harmonicIndex < harmonicCount; harmonicIndex += 1) {
            const frequency = (harmonicIndex + 1) * BEACON_FUNDAMENTAL_HZ;
            const centerBin = frequency * FFT_SIZE / SAMPLE_RATE;
            const minimumBin = Math.max(1, Math.floor(centerBin) - 2);
            const maximumBin = Math.min(FFT_SIZE / 2 - 1, Math.ceil(centerBin) + 2);
            let power = 0;
            for (let bin = minimumBin; bin <= maximumBin; bin += 1) {
                const amplitude = 2 * Math.hypot(real[bin], imaginary[bin]) / hannSum;
                power += amplitude * amplitude;
            }
            harmonicAbsoluteDb[harmonicIndex] = decibels(Math.sqrt(power));
        }
        const leftRms = Math.sqrt(leftPower / FFT_SIZE);
        const rightRms = Math.sqrt(rightPower / FFT_SIZE);
        const totalRms = Math.sqrt((leftPower + rightPower) / (FFT_SIZE * 2));
        const denominator = leftRms + rightRms;
        frames.push({
            schemaVersion: HARMONIC_ANALYSIS_SCHEMA_VERSION,
            offsetSeconds,
            sourceTimeSeconds: offsetSeconds,
            overallDb: decibels(totalRms),
            harmonicAbsoluteDb,
            // The slow baseline is client-instance state over ordered remote
            // frames. Keeping it out of segment cache avoids false resets at
            // every HLS fragment boundary or cross-client state contamination.
            harmonicDeltaDb: new Float32Array(harmonicCount),
            spectralEnvelopeDb,
            stereoBalance: denominator > 0 ? (rightRms - leftRms) / denominator : 0,
            stereoWidth: clamp(Math.sqrt(sidePower / FFT_SIZE) / Math.max(totalRms * 2, 1e-6), 0, 1),
            confidence: totalRms > 1e-6 ? 1 : 0,
            sourceKind: 'beacon',
        });
    }
    return frames;
}

async function decodeSegment(
    artifactRoot: string,
    metadata: ReturnType<typeof normalizeAnalysisArtifactMetadata>,
    segmentIndex: number,
): Promise<Float32Array> {
    const segment = metadata.segments[segmentIndex];
    const segmentsRoot = path.resolve(artifactRoot, 'segments');
    const segmentPath = path.resolve(segmentsRoot, segment.file);
    if (!segmentPath.startsWith(`${segmentsRoot}${path.sep}`)) throw new Error('Unsafe segment path');
    const inputs = metadata.initialization
        ? [path.resolve(segmentsRoot, metadata.initialization.file), segmentPath]
        : [segmentPath];
    const input = `concat:${inputs.join('|')}`;
    const chunks: Buffer[] = [];
    let bytes = 0;
    await new Promise<void>((resolve, reject) => {
        const process = spawn('ffmpeg', [
            '-hide_banner', '-loglevel', 'error', '-i', input,
            '-vn', '-ac', '2', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1',
        ], { stdio: ['ignore', 'pipe', 'ignore'] });
        const timeout = setTimeout(() => {
            process.kill('SIGKILL');
            reject(new Error('Listener analysis decode timed out'));
        }, 10_000);
        process.stdout.on('data', (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > MAX_PCM_BYTES) {
                process.kill('SIGKILL');
                reject(new Error('Listener analysis PCM exceeded bound'));
                return;
            }
            chunks.push(chunk);
        });
        process.once('error', (error) => {
            clearTimeout(timeout);
            reject(error);
        });
        process.once('close', (code) => {
            clearTimeout(timeout);
            if (code === 0) resolve();
            else reject(new Error('Listener analysis decode failed'));
        });
    });
    const pcm = Buffer.concat(chunks);
    return new Float32Array(
        pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength),
    );
}

export class ServerHarmonicAnalyzer {
    private metadataPromise: Promise<ReturnType<typeof normalizeAnalysisArtifactMetadata>> | null = null;
    private readonly cache = new Map<number, Promise<RelativeFrame[]>>();
    private activeDecodes = 0;

    constructor(
        private readonly mediaRoot: string,
        private readonly artifactId: string,
    ) {
        if (!ARTIFACT_ID.test(artifactId)) throw new Error('Invalid Listener analysis artifact ID');
    }

    private async metadata() {
        this.metadataPromise ??= readFile(
            path.resolve(this.mediaRoot, this.artifactId, 'artifact.json'),
            'utf8',
        ).then((value) => normalizeAnalysisArtifactMetadata(JSON.parse(value) as ArtifactMetadata));
        return this.metadataPromise;
    }

    private async frames(
        metadata: ReturnType<typeof normalizeAnalysisArtifactMetadata>,
        segmentIndex: number,
    ): Promise<RelativeFrame[]> {
        let pending = this.cache.get(segmentIndex);
        if (!pending) {
            if (this.activeDecodes >= MAX_CONCURRENT_DECODES) {
                throw new Error('Listener analysis decoder is busy');
            }
            const artifactRoot = path.resolve(this.mediaRoot, this.artifactId);
            this.activeDecodes += 1;
            pending = decodeSegment(artifactRoot, metadata, segmentIndex)
                .then((pcm) => analyzePcmSegment(pcm, metadata.segments[segmentIndex].durationSeconds))
                .catch((error) => {
                    this.cache.delete(segmentIndex);
                    throw error;
                })
                .finally(() => {
                    this.activeDecodes -= 1;
                });
            this.cache.set(segmentIndex, pending);
            while (this.cache.size > MAX_CACHE_SEGMENTS) {
                const oldest = this.cache.keys().next().value as number | undefined;
                if (oldest === undefined) break;
                this.cache.delete(oldest);
            }
        }
        return pending;
    }

    async frameAt(programTimeMs: number): Promise<HarmonicAnalysisFrame> {
        const metadata = await this.metadata();
        const position = resolveArtifactPosition(metadata, programTimeMs);
        const frames = await this.frames(metadata, position.segmentIndex);
        if (frames.length === 0) throw new Error('Listener analysis segment produced no frames');
        const selected = frames.reduce((nearest, candidate) => (
            Math.abs(candidate.offsetSeconds - position.segmentOffsetSeconds)
                < Math.abs(nearest.offsetSeconds - position.segmentOffsetSeconds)
                ? candidate
                : nearest
        ));
        const { offsetSeconds, ...frame } = selected;
        return {
            ...frame,
            capturedAtMs: position.segmentProgramStartMs + offsetSeconds * 1_000,
            sourceTimeSeconds: (
                metadata.segmentStartsSeconds[position.segmentIndex] + offsetSeconds
            ) % metadata.loopDurationSeconds,
        };
    }
}

const globalAnalyzer = Symbol.for('harmonic-beacon.listener.server-harmonic-analyzer.v1');
type AnalyzerGlobal = typeof globalThis & { [globalAnalyzer]?: ServerHarmonicAnalyzer };

export function listenerServerHarmonicAnalyzer(environment = process.env): ServerHarmonicAnalyzer {
    const artifactId = environment.EARLY_BIRDS_STREAM_ARTIFACT_ID?.trim();
    const mediaRoot = environment.EARLY_BIRDS_STREAM_MEDIA_ROOT?.trim() || '/media/artifacts';
    if (!artifactId) throw new Error('Listener server analysis is not configured');
    const root = globalThis as AnalyzerGlobal;
    root[globalAnalyzer] ??= new ServerHarmonicAnalyzer(mediaRoot, artifactId);
    return root[globalAnalyzer];
}

export function serializeServerHarmonicFrame(frame: HarmonicAnalysisFrame) {
    return {
        ...frame,
        harmonicAbsoluteDb: Array.from(frame.harmonicAbsoluteDb),
        harmonicDeltaDb: Array.from(frame.harmonicDeltaDb),
        spectralEnvelopeDb: Array.from(frame.spectralEnvelopeDb),
    };
}
