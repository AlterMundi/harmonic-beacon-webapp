import { describe, expect, it } from 'vitest';

import type { HarmonicAnalysisFrame } from '@/lib/listener/analysis/types';

import {
    absoluteEnergy,
    buildReactiveCampfireScene,
    MAX_RENDERED_HARMONICS,
    seededUnit,
    smoothVisualDb,
    type ReactiveTrailHistory,
} from '../scene';
import { DEFAULT_REACTIVE_CAMPFIRE_SETTINGS } from '../settings';

function frameWith(
    absolute: number[],
    delta: number[] = absolute.map(() => 0),
    patch: Partial<HarmonicAnalysisFrame> = {},
): HarmonicAnalysisFrame {
    return {
        schemaVersion: 1,
        capturedAtMs: 10_000,
        sourceTimeSeconds: 10,
        overallDb: -26,
        harmonicAbsoluteDb: Float32Array.from(absolute),
        harmonicDeltaDb: Float32Array.from(delta),
        spectralEnvelopeDb: new Float32Array(24),
        stereoBalance: 0,
        stereoWidth: 0.5,
        confidence: 1,
        sourceKind: 'beacon',
        ...patch,
    } as HarmonicAnalysisFrame;
}

describe('reactive campfire scene', () => {
    it('is deterministic and derives geometry only from the measured frame and settings', () => {
        const absolute = Array.from({ length: 80 }, (_, index) => -24 - index * 0.7);
        const delta = Array.from({ length: 80 }, (_, index) => Math.sin(index) * 3);
        const input = frameWith(absolute, delta);

        expect(buildReactiveCampfireScene(input)).toEqual(buildReactiveCampfireScene(input));
        expect(seededUnit(42, 7)).toBe(seededUnit(42, 7));
        expect(seededUnit(42, 7)).not.toBe(seededUnit(43, 7));
    });

    it('keeps absolute energy authoritative when a quiet high harmonic varies strongly', () => {
        const absolute = Array.from({ length: 64 }, () => -60);
        const delta = Array.from({ length: 64 }, () => 0);
        absolute[2] = -24;
        absolute[50] = -82;
        delta[2] = 0;
        delta[50] = 9;

        const scene = buildReactiveCampfireScene(frameWith(absolute, delta), {
            density: 1,
            highDetail: 1,
            sensitivity: 3,
            centerCutPercent: 16,
        });
        const strongLow = scene.rings.find((ring) => ring.harmonicIndex === 2);
        const quietHigh = scene.filaments.find((filament) => filament.harmonicIndex === 50);

        expect(strongLow).toBeDefined();
        expect(quietHigh).toBeDefined();
        expect(quietHigh!.opacity).toBeLessThan(strongLow!.opacity);
        expect(quietHigh!.weight).toBeLessThan(strongLow!.weight);
        expect(quietHigh!.emphasis).toBeLessThan(absoluteEnergy(absolute[50]));
    });

    it('settles to a truthful rest state for silence or a fully decayed stop', () => {
        const silence = frameWith(
            Array.from({ length: 64 }, () => Number.NEGATIVE_INFINITY),
            undefined,
            { overallDb: Number.NEGATIVE_INFINITY, confidence: 0 },
        );
        const silentScene = buildReactiveCampfireScene(silence);
        const stoppedScene = buildReactiveCampfireScene(
            frameWith(Array.from({ length: 64 }, () => -24)),
            {},
            new Map(),
            0,
        );

        expect(silentScene.core.opacity).toBe(0);
        expect(silentScene.rings.every((ring) => ring.opacity === 0)).toBe(true);
        expect(silentScene.filaments.every((filament) => filament.opacity === 0)).toBe(true);
        expect(stoppedScene.confidence).toBe(0);
        expect(stoppedScene.core.radius).toBe(0);
    });

    it('keeps upper harmonics individually addressable with short measured trails', () => {
        const absolute = Array.from({ length: 72 }, () => -48);
        const history = new Map([
            [50, [
                { capturedAtMs: 9_000, absoluteDb: -54, deltaDb: -2 },
                { capturedAtMs: 9_500, absoluteDb: -49, deltaDb: 1 },
                { capturedAtMs: 10_000, absoluteDb: -44, deltaDb: 4 },
            ]],
        ]) as ReactiveTrailHistory;
        const scene = buildReactiveCampfireScene(frameWith(absolute), {
            density: 1,
            highDetail: 1,
            trailSeconds: 2,
            centerCutPercent: 20,
        }, history);
        const upper = scene.filaments.filter((filament) => filament.tier === 'high');
        const trail = upper.find((filament) => filament.harmonicIndex === 50)?.trail;

        expect(new Set(upper.map((filament) => filament.harmonicIndex)).size).toBe(upper.length);
        expect(trail).toHaveLength(3);
        expect(trail?.every((ghost) => (
            Number.isFinite(ghost.innerRadius)
            && Number.isFinite(ghost.outerRadius)
            && Number.isFinite(ghost.bend)
            && ghost.opacity >= 0
        ))).toBe(true);
        expect(upper.every((filament) => Number.isFinite(filament.angle))).toBe(true);
    });

    it('bounds rendered entities even if a provider supplies a larger bank', () => {
        const frame = frameWith(Array.from({ length: 600 }, () => -40));
        const scene = buildReactiveCampfireScene(frame, {
            density: 1,
            highDetail: 1,
            centerCutPercent: 10,
        });

        expect(scene.rings.length + scene.filaments.length).toBeLessThanOrEqual(MAX_RENDERED_HARMONICS);
        expect(Math.max(...scene.filaments.map((filament) => filament.harmonicIndex)))
            .toBe(599);
    });

    it('applies visual attack and release without changing the measured frame', () => {
        const attack = smoothVisualDb(-80, -20, 100, 100, 1_000);
        const release = smoothVisualDb(-20, -80, 100, 100, 1_000);

        expect(attack).toBeGreaterThan(-43);
        expect(release).toBeGreaterThan(-30);
        expect(smoothVisualDb(-20, Number.NEGATIVE_INFINITY, 100, 100, 1_000))
            .toBe(Number.NEGATIVE_INFINITY);
    });

    it('uses the approved 30 fps ceiling and a static low-rate accessibility policy', async () => {
        const { resolveReactiveRenderPolicy } = await import('../render-policy');

        expect(resolveReactiveRenderPolicy({ reducedMotion: false, saveData: false }))
            .toMatchObject({ conservative: false, frameIntervalMs: 1_000 / 30, maxDevicePixelRatio: 1.5 });
        expect(resolveReactiveRenderPolicy({ reducedMotion: true, saveData: false }))
            .toMatchObject({ conservative: true, frameIntervalMs: 500 });
        expect(resolveReactiveRenderPolicy({ reducedMotion: false, saveData: true }))
            .toMatchObject({ conservative: true, frameIntervalMs: 500 });
    });

    it('retains stable defaults in the deterministic fixture', () => {
        expect(DEFAULT_REACTIVE_CAMPFIRE_SETTINGS).toMatchObject({
            sensitivity: 3,
            absoluteFloorDb: -120,
            baselineDurationSeconds: 24,
            attackMs: 20,
            releaseMs: 140,
            trailSeconds: 4,
            density: 1,
            highDetail: 1,
            centerCutPercent: 100,
            radialSpacingGrowthPercent: 65,
            ribbonWidth: 2.25,
            palette: 'ember',
            visualizationMode: 'harmonic-radial-series',
            fftSize: 16_384,
        });
    });

    it('keeps the center invariant while endpoints move continuously', () => {
        const absolute = Array.from({ length: 64 }, () => -36);
        const first = buildReactiveCampfireScene(frameWith(absolute, undefined, {
            capturedAtMs: 10_000,
            stereoBalance: -1,
        }), { centerCutPercent: 20 });
        const second = buildReactiveCampfireScene(frameWith(absolute, undefined, {
            capturedAtMs: 10_020,
            stereoBalance: 1,
        }), { centerCutPercent: 20 });

        expect(first.core.stereoOffset).toBe(0);
        expect(second.core.stereoOffset).toBe(0);
        expect(second.filaments[0].angle).not.toBe(first.filaments[0].angle);
        expect(Math.abs(second.filaments[0].angle - first.filaments[0].angle)).toBeLessThan(0.01);
    });

    it('maps the complete radial series from the center beyond the short edge', () => {
        const scene = buildReactiveCampfireScene(
            frameWith(Array.from({ length: 496 }, () => -32)),
            { density: 1, highDetail: 1 },
        );

        expect(scene.seriesRings).toHaveLength(MAX_RENDERED_HARMONICS);
        expect(scene.seriesRings[0].tier).toBe('low');
        expect(scene.seriesRings.at(-1)?.tier).toBe('high');
        expect(scene.seriesRings.at(-1)?.radius).toBeGreaterThan(0.8);
        expect(scene.seriesRings.at(-1)?.harmonicIndex).toBe(495);
        const innerGap = scene.seriesRings[20].radius - scene.seriesRings[19].radius;
        const outerGap = scene.seriesRings.at(-1)!.radius - scene.seriesRings.at(-2)!.radius;
        expect(outerGap).toBeGreaterThan(innerGap * 2);
    });

    it('makes radial spacing growth controllable from linear to strongly expanded', () => {
        const frame = frameWith(Array.from({ length: 496 }, () => -32));
        const linear = buildReactiveCampfireScene(frame, {
            density: 1,
            highDetail: 1,
            radialSpacingGrowthPercent: 0,
        });
        const expanded = buildReactiveCampfireScene(frame, {
            density: 1,
            highDetail: 1,
            radialSpacingGrowthPercent: 150,
        });
        const gap = (scene: ReturnType<typeof buildReactiveCampfireScene>) => (
            scene.seriesRings.at(-1)!.radius - scene.seriesRings.at(-2)!.radius
        );

        expect(gap(expanded)).toBeGreaterThan(gap(linear) * 2);
        expect(expanded.seriesRings.at(-1)?.radius).toBe(linear.seriesRings.at(-1)?.radius);
    });

    it('uses a true percentage of the complete bank as the center / outer boundary', () => {
        const scene = buildReactiveCampfireScene(
            frameWith(Array.from({ length: 64 }, () => -32)),
            { centerCutPercent: 25 },
        );

        expect(scene.rings.at(-1)?.harmonicIndex).toBe(15);
        expect(scene.filaments[0]?.harmonicIndex).toBe(16);
        expect(scene.centerCutIndex).toBe(16);
    });

    it('allows pure outer and pure center fields at the percentage extremes', () => {
        const frame = frameWith(Array.from({ length: 64 }, () => -32));
        const allOuter = buildReactiveCampfireScene(frame, { centerCutPercent: 0 });
        const allCenter = buildReactiveCampfireScene(frame, { centerCutPercent: 100 });

        expect(allOuter.rings).toHaveLength(0);
        expect(allOuter.filaments.length).toBeGreaterThan(0);
        expect(allOuter.core.opacity).toBe(0);
        expect(allCenter.filaments).toHaveLength(0);
        expect(allCenter.rings.length).toBeGreaterThan(0);
        expect(allCenter.veils.every((veil) => veil.opacity === 0)).toBe(true);
    });
});
