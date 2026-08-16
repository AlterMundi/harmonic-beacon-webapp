import { describe, expect, it } from 'vitest';

import {
    analyzePcmSegment,
    normalizeAnalysisArtifactMetadata,
    resolveArtifactPosition,
} from '../server-harmonic-analyzer';

describe('server harmonic analyzer', () => {
    it('maps wall-clock program time into the looping HLS artifact', () => {
        const metadata = normalizeAnalysisArtifactMetadata({
            schemaVersion: 2,
            artifactId: 'beacon-test',
            timing: {
                epochUtc: '2026-08-09T00:00:00.000Z',
                segmentCount: 3,
                loopDurationSeconds: 30,
            },
            initialization: { file: 'init.mp4' },
            segments: [
                { file: '00000.m4s', durationSeconds: 10 },
                { file: '00001.m4s', durationSeconds: 10 },
                { file: '00002.m4s', durationSeconds: 10 },
            ],
        });
        const epoch = Date.parse('2026-08-09T00:00:00.000Z');

        expect(resolveArtifactPosition(metadata, epoch + 12_250)).toEqual({
            segmentIndex: 1,
            segmentOffsetSeconds: 2.25,
            segmentProgramStartMs: epoch + 10_000,
        });
        expect(resolveArtifactPosition(metadata, epoch + 42_250)).toEqual({
            segmentIndex: 1,
            segmentOffsetSeconds: 2.25,
            segmentProgramStartMs: epoch + 40_000,
        });
    });

    it('extracts the real 40.4 Hz fundamental from decoded stereo PCM', () => {
        const seconds = 1;
        const sampleRate = 48_000;
        const pcm = new Float32Array(sampleRate * seconds * 2);
        for (let sample = 0; sample < sampleRate * seconds; sample += 1) {
            const value = 0.5 * Math.sin(2 * Math.PI * 40.4 * sample / sampleRate);
            pcm[sample * 2] = value;
            pcm[sample * 2 + 1] = value;
        }

        const frames = analyzePcmSegment(pcm, seconds);
        expect(frames).toHaveLength(4);
        expect(frames[1].harmonicAbsoluteDb[0]).toBeGreaterThan(-15);
        expect(frames[1].harmonicAbsoluteDb[0] - frames[1].harmonicAbsoluteDb[9]).toBeGreaterThan(25);
        expect(frames[1].spectralEnvelopeDb).toHaveLength(32);
        expect(frames[1].stereoWidth).toBeLessThan(0.01);
    });

    it('rejects malformed or path-like artifact metadata', () => {
        expect(() => normalizeAnalysisArtifactMetadata({
            schemaVersion: 2,
            artifactId: 'beacon-test',
            timing: { epochUtc: '2026-08-09T00:00:00Z', segmentCount: 1 },
            segments: [{ file: '../secret.m4s', durationSeconds: 10 }],
        })).toThrow('Invalid Listener analysis segment metadata');
    });
});
