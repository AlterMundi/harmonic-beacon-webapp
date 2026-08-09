import { describe, expect, it } from 'vitest';

import type { HarmonicAnalysisFrame } from '@/lib/listener/analysis/types';

import {
    advanceReactiveFrame,
    createReactiveFrameState,
    recordReactiveFrame,
} from '../frame-state';
import { DEFAULT_REACTIVE_CAMPFIRE_SETTINGS } from '../settings';

function sourceFrame(
    sourceKind: 'intro' | 'beacon',
    capturedAtMs: number,
    highDb: number,
): HarmonicAnalysisFrame {
    const absolute = new Float32Array(64).fill(-70);
    absolute[50] = highDb;
    return {
        schemaVersion: 1,
        capturedAtMs,
        sourceTimeSeconds: capturedAtMs / 1_000,
        overallDb: highDb,
        harmonicAbsoluteDb: absolute,
        harmonicDeltaDb: new Float32Array(64),
        spectralEnvelopeDb: new Float32Array(24),
        stereoBalance: 0,
        stereoWidth: 0.5,
        confidence: 1,
        sourceKind,
    } as HarmonicAnalysisFrame;
}

describe('reactive frame source boundaries', () => {
    it('starts a new source with no inherited smoothing, timing or trails', () => {
        const settings = {
            ...DEFAULT_REACTIVE_CAMPFIRE_SETTINGS,
            density: 1,
            highDetail: 1,
        };
        const state = createReactiveFrameState();
        const intro = sourceFrame('intro', 10_000, -20);
        const beacon = sourceFrame('beacon', 10_100, -82);

        recordReactiveFrame(state, intro, settings);
        expect(state.lastActivatedAtMs.get(50)).toBe(10_000);
        expect(advanceReactiveFrame(state, 10_000, 100, settings)?.harmonicAbsoluteDb[50])
            .toBe(-20);
        expect(state.history.get(50)?.map((sample) => sample.absoluteDb)).toEqual([-20]);

        recordReactiveFrame(state, beacon, settings);

        expect(state.lastSmoothAtMs).toBeNull();
        expect(state.lastActivatedAtMs.has(50)).toBe(false);
        expect(state.history.get(50)?.map((sample) => sample.absoluteDb)).toEqual([-82]);
        const firstBeaconRender = advanceReactiveFrame(state, 10_100, 100, settings);
        expect(firstBeaconRender?.harmonicAbsoluteDb[50]).toBe(-82);
        expect(firstBeaconRender?.overallDb).toBe(-82);
        expect(firstBeaconRender?.sourceKind).toBe('beacon');
    });

    it('also clears a retained source identity after an intervening null frame', () => {
        const settings = { ...DEFAULT_REACTIVE_CAMPFIRE_SETTINGS, density: 1, highDetail: 1 };
        const state = createReactiveFrameState();

        recordReactiveFrame(state, sourceFrame('intro', 10_000, -20), settings);
        advanceReactiveFrame(state, 10_000, 100, settings);
        recordReactiveFrame(state, null, settings);
        recordReactiveFrame(state, sourceFrame('beacon', 11_000, -80), settings);

        expect(state.history.get(50)?.map((sample) => sample.absoluteDb)).toEqual([-80]);
        expect(advanceReactiveFrame(state, 11_000, 100, settings)?.harmonicAbsoluteDb[50])
            .toBe(-80);
    });
});
