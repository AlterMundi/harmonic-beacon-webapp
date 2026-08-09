import type { HarmonicAnalysisFrame } from '@/lib/listener/analysis/types';

import {
    HARMONIC_ACTIVATION_THRESHOLD,
    type HarmonicTrailSample,
    harmonicActivationStrength,
    selectHarmonicIndexes,
    smoothVisualDb,
} from './scene';
import type { ReactiveCampfireSettings } from './settings';

const MAX_TRAIL_SAMPLES = 120;

export type ReactiveFrameState = {
    currentFrame: HarmonicAnalysisFrame | null;
    smoothedFrame: HarmonicAnalysisFrame | null;
    lastSmoothAtMs: number | null;
    previousCaptureAtMs: number | null;
    sourceKind: HarmonicAnalysisFrame['sourceKind'] | null;
    history: Map<number, HarmonicTrailSample[]>;
    lastActivatedAtMs: Map<number, number>;
};

export function createReactiveFrameState(): ReactiveFrameState {
    return {
        currentFrame: null,
        smoothedFrame: null,
        lastSmoothAtMs: null,
        previousCaptureAtMs: null,
        sourceKind: null,
        history: new Map(),
        lastActivatedAtMs: new Map(),
    };
}

function appendFrameToHistory(
    state: ReactiveFrameState,
    frame: HarmonicAnalysisFrame,
    settings: ReactiveCampfireSettings,
) {
    const indexes = selectHarmonicIndexes(
        frame.harmonicAbsoluteDb.length,
        settings.density,
        settings.highDetail,
    );
    const retained = new Set(indexes);
    for (const existing of state.history.keys()) {
        if (!retained.has(existing)) state.history.delete(existing);
    }
    for (const existing of state.lastActivatedAtMs.keys()) {
        if (!retained.has(existing)) state.lastActivatedAtMs.delete(existing);
    }
    const maxAgeMs = Math.max(4_000, settings.trailSeconds * 1_000);
    for (const index of indexes) {
        const activation = harmonicActivationStrength(
            frame.harmonicAbsoluteDb[index],
            frame.harmonicDeltaDb[index] ?? 0,
            settings.absoluteFloorDb,
        );
        if (activation >= HARMONIC_ACTIVATION_THRESHOLD) {
            state.lastActivatedAtMs.set(index, frame.capturedAtMs);
        }
        if (index < 38) continue;
        const samples = state.history.get(index) ?? [];
        samples.push({
            capturedAtMs: frame.capturedAtMs,
            absoluteDb: frame.harmonicAbsoluteDb[index],
            deltaDb: frame.harmonicDeltaDb[index] ?? 0,
        });
        const earliest = frame.capturedAtMs - maxAgeMs;
        while (samples.length > MAX_TRAIL_SAMPLES || samples[0]?.capturedAtMs < earliest) {
            samples.shift();
        }
        state.history.set(index, samples);
    }
}

function resetSourceHistory(state: ReactiveFrameState) {
    state.history.clear();
    state.smoothedFrame = null;
    state.lastSmoothAtMs = null;
    state.previousCaptureAtMs = null;
    state.lastActivatedAtMs.clear();
}

export function recordReactiveFrame(
    state: ReactiveFrameState,
    frame: HarmonicAnalysisFrame | null,
    settings: ReactiveCampfireSettings,
) {
    if (frame && state.sourceKind !== null && frame.sourceKind !== state.sourceKind) {
        resetSourceHistory(state);
    }
    if (frame) state.sourceKind = frame.sourceKind;
    state.currentFrame = frame;

    if (frame && frame.capturedAtMs !== state.previousCaptureAtMs) {
        state.previousCaptureAtMs = frame.capturedAtMs;
        appendFrameToHistory(state, frame, settings);
    }
}

function smoothFrame(
    previous: HarmonicAnalysisFrame | null,
    target: HarmonicAnalysisFrame | null,
    elapsedMs: number,
    settings: ReactiveCampfireSettings,
): HarmonicAnalysisFrame | null {
    if (!target) return null;
    if (!previous || previous.harmonicAbsoluteDb.length !== target.harmonicAbsoluteDb.length) {
        return target;
    }
    const absolute = new Float32Array(target.harmonicAbsoluteDb.length);
    const delta = new Float32Array(target.harmonicDeltaDb.length);
    for (let index = 0; index < absolute.length; index += 1) {
        absolute[index] = smoothVisualDb(
            previous.harmonicAbsoluteDb[index],
            target.harmonicAbsoluteDb[index],
            elapsedMs,
            settings.attackMs,
            settings.releaseMs,
        );
    }
    for (let index = 0; index < delta.length; index += 1) {
        delta[index] = smoothVisualDb(
            previous.harmonicDeltaDb[index],
            target.harmonicDeltaDb[index],
            elapsedMs,
            settings.attackMs,
            settings.releaseMs,
        );
    }
    return {
        ...target,
        overallDb: smoothVisualDb(
            previous.overallDb,
            target.overallDb,
            elapsedMs,
            settings.attackMs,
            settings.releaseMs,
        ),
        harmonicAbsoluteDb: absolute,
        harmonicDeltaDb: delta,
    };
}

export function advanceReactiveFrame(
    state: ReactiveFrameState,
    nowMs: number,
    fallbackElapsedMs: number,
    settings: ReactiveCampfireSettings,
): HarmonicAnalysisFrame | null {
    const elapsedMs = state.lastSmoothAtMs === null
        ? fallbackElapsedMs
        : Math.max(0, nowMs - state.lastSmoothAtMs);
    state.smoothedFrame = smoothFrame(
        state.smoothedFrame,
        state.currentFrame,
        elapsedMs,
        settings,
    );
    state.lastSmoothAtMs = nowMs;
    return state.smoothedFrame;
}
