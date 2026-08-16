import { describe, expect, it } from 'vitest';

import {
    HarmonicFrameMapper,
    harmonicCountForSampleRate,
    harmonicFrequencyHz,
    type SpectrumObservation,
} from '../harmonic-mapper';
import { BEACON_FUNDAMENTAL_HZ, type HarmonicAnalysisFftSize } from '../types';

const FFT_SIZE: HarmonicAnalysisFftSize = 8192;
const SAMPLE_RATE = 48_000;
const DB_FLOOR = -120;

function spectrumWithHarmonics(
    harmonics: Record<number, number>,
    fftSize = FFT_SIZE,
    sampleRate = SAMPLE_RATE,
): Float32Array {
    const spectrum = new Float32Array(fftSize / 2);
    spectrum.fill(DB_FLOOR);
    for (const [harmonic, db] of Object.entries(harmonics)) {
        const frequency = Number(harmonic) * BEACON_FUNDAMENTAL_HZ;
        const bin = Math.round(frequency / (sampleRate / fftSize));
        if (bin < spectrum.length) spectrum[bin] = db;
    }
    return spectrum;
}

function waveform(
    phase: number,
    amplitude = 0.25,
    fftSize = FFT_SIZE,
): Float32Array {
    return Float32Array.from(
        { length: fftSize },
        (_, index) => amplitude * Math.sin((index / 64) * Math.PI * 2 + phase),
    );
}

function observation(overrides: Partial<SpectrumObservation> = {}): SpectrumObservation {
    const spectrum = spectrumWithHarmonics({ 1: -18, 2: -24, 40: -70 });
    const channel = waveform(0);
    return {
        capturedAtMs: 1_000,
        sourceTimeSeconds: 10,
        sourceKind: 'beacon',
        sampleRate: SAMPLE_RATE,
        fftSize: FFT_SIZE,
        leftSpectrumDb: spectrum,
        rightSpectrumDb: new Float32Array(spectrum),
        leftWaveform: channel,
        rightWaveform: new Float32Array(channel),
        ...overrides,
    };
}

describe('HarmonicFrameMapper', () => {
    it('uses a stable 40.4 Hz identity and caps harmonics at 20 kHz or Nyquist', () => {
        expect(harmonicFrequencyHz(0)).toBe(40.4);
        expect(harmonicFrequencyHz(9)).toBe(404);
        expect(harmonicCountForSampleRate(48_000)).toBe(Math.floor(20_000 / 40.4));
        expect(harmonicCountForSampleRate(32_000)).toBe(Math.floor(16_000 / 40.4));
    });

    it('keeps a stable signal at zero delta instead of independently normalizing it', () => {
        const mapper = new HarmonicFrameMapper({ fftSize: FFT_SIZE, baselineSeconds: 30 });
        const first = mapper.map(observation());
        const second = mapper.map(observation({ capturedAtMs: 2_000 }));

        expect([...first.harmonicDeltaDb].every((value) => Math.abs(value) < 0.001)).toBe(true);
        expect([...second.harmonicDeltaDb].every((value) => Math.abs(value) < 0.001)).toBe(true);
        expect(first.harmonicAbsoluteDb[0]).toBeGreaterThan(first.harmonicAbsoluteDb[39]);
    });

    it('reveals a subtle upper-harmonic change without making it absolutely loud', () => {
        const mapper = new HarmonicFrameMapper({ fftSize: FFT_SIZE, baselineSeconds: 30 });
        const quiet = spectrumWithHarmonics({ 1: -18, 200: -100 });
        mapper.map(observation({ leftSpectrumDb: quiet, rightSpectrumDb: quiet }));

        const emerged = spectrumWithHarmonics({ 1: -18, 200: -76 });
        const frame = mapper.map(observation({
            capturedAtMs: 2_000,
            leftSpectrumDb: emerged,
            rightSpectrumDb: emerged,
        }));

        expect(frame.harmonicDeltaDb[199]).toBeGreaterThan(10);
        expect(frame.harmonicAbsoluteDb[199]).toBeLessThan(-70);
        expect(frame.harmonicAbsoluteDb[0]).toBeGreaterThan(frame.harmonicAbsoluteDb[199] + 40);
    });

    it('derives bounded stereo balance and width from waveform measurements', () => {
        const mapper = new HarmonicFrameMapper({ fftSize: FFT_SIZE });
        const mono = waveform(0);
        const monoFrame = mapper.map(observation({
            leftWaveform: mono,
            rightWaveform: new Float32Array(mono),
        }));
        expect(monoFrame.stereoBalance).toBeCloseTo(0, 5);
        expect(monoFrame.stereoWidth).toBeCloseTo(0, 5);

        const left = waveform(0, 0.1);
        const right = waveform(Math.PI, 0.4);
        const wideFrame = mapper.map(observation({
            capturedAtMs: 2_000,
            leftWaveform: left,
            rightWaveform: right,
        }));
        expect(wideFrame.stereoBalance).toBeGreaterThan(0.8);
        expect(wideFrame.stereoWidth).toBeGreaterThan(0.5);
        expect(wideFrame.stereoBalance).toBeLessThanOrEqual(1);
        expect(wideFrame.stereoWidth).toBeLessThanOrEqual(1);
    });

    it('reports silence honestly and bounds every numeric field', () => {
        const mapper = new HarmonicFrameMapper({ fftSize: FFT_SIZE });
        const silenceSpectrum = new Float32Array(FFT_SIZE / 2).fill(Number.NEGATIVE_INFINITY);
        const silenceWaveform = new Float32Array(FFT_SIZE);
        const frame = mapper.map(observation({
            leftSpectrumDb: silenceSpectrum,
            rightSpectrumDb: silenceSpectrum,
            leftWaveform: silenceWaveform,
            rightWaveform: silenceWaveform,
        }));

        expect(frame.overallDb).toBe(-120);
        expect(frame.confidence).toBe(0);
        expect(frame.stereoBalance).toBe(0);
        expect(frame.stereoWidth).toBe(0);
        expect(frame.harmonicAbsoluteDb).toHaveLength(harmonicCountForSampleRate(SAMPLE_RATE));
        expect(frame.spectralEnvelopeDb).toHaveLength(32);
        expect([...frame.harmonicAbsoluteDb, ...frame.spectralEnvelopeDb].every(
            (value) => Number.isFinite(value) && value >= -120 && value <= 0,
        )).toBe(true);
        expect([...frame.harmonicDeltaDb].every(
            (value) => Number.isFinite(value) && value >= -24 && value <= 24,
        )).toBe(true);
    });

    it('rejects unsupported FFT sizes and malformed observations', () => {
        expect(() => new HarmonicFrameMapper({ fftSize: 4096 as HarmonicAnalysisFftSize }))
            .toThrow('fftSize must be 8192 or 16384');
        const mapper = new HarmonicFrameMapper({ fftSize: FFT_SIZE });
        expect(() => mapper.map(observation({ leftSpectrumDb: new Float32Array(8) })))
            .toThrow('spectra must contain exactly 4096 bins');
        expect(() => harmonicFrequencyHz(-1)).toThrow('non-negative integer');
    });
});
