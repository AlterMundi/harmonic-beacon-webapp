import { describe, expect, it } from 'vitest';

import type { HarmonicAnalysisFrame } from '@/lib/listener/analysis/types';

import {
    absoluteEnergy,
    buildReactiveCampfireScene,
    HARMONIC_ACTIVATION_THRESHOLD,
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
            absoluteFloorDb: -120,
            centerCutPercent: 16,
        });
        const strongLow = scene.rings.find((ring) => ring.harmonicIndex === 2);
        const quietHigh = scene.filaments.find((filament) => filament.harmonicIndex === 50);

        expect(strongLow).toBeDefined();
        expect(quietHigh).toBeDefined();
        expect(quietHigh!.opacity).toBeLessThan(strongLow!.opacity);
        expect(quietHigh!.weight).toBeLessThan(strongLow!.weight);
        expect(quietHigh!.emphasis).toBeLessThan(absoluteEnergy(absolute[50], -120));
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
            absoluteFloorDb: -101,
            baselineDurationSeconds: 24,
            attackMs: 30,
            releaseMs: 380,
            trailSeconds: 4,
            density: 0.6,
            highDetail: 1,
            centerCutPercent: 4,
            centerFieldScalePercent: 28,
            centerRibbonWidth: 0.8,
            rotationDegreesPerMinute: -59.5,
            radialSpacingGrowthPercent: 65,
            zoomPercent: 220,
            activationTtlSeconds: 13.5,
            ribbonWidth: 3,
            kelpPropagationSpeed: 0.5,
            kelpDamping: 3,
            kelpInnerImpulse: 3,
            palette: 'aurora',
            visualizationMode: 'inner-anchor-kelp',
            fftSize: 16_384,
        });
    });

    it('keeps the center invariant while endpoints move continuously', () => {
        const absolute = Array.from({ length: 64 }, () => -36);
        const first = buildReactiveCampfireScene(frameWith(absolute, undefined, {
            capturedAtMs: 10_000,
            stereoBalance: -1,
        }), { centerCutPercent: 20, visualizationMode: 'radial-ribbons' });
        const second = buildReactiveCampfireScene(frameWith(absolute, undefined, {
            capturedAtMs: 10_020,
            stereoBalance: 1,
        }), { centerCutPercent: 20, visualizationMode: 'radial-ribbons' });

        expect(first.core.stereoOffset).toBe(0);
        expect(second.core.stereoOffset).toBe(0);
        expect(second.filaments[0].angle).not.toBe(first.filaments[0].angle);
        expect(Math.abs(second.filaments[0].angle - first.filaments[0].angle)).toBeLessThan(0.01);
    });

    it('keeps inner-anchor kelp endpoints fixed while its local flow clock advances', () => {
        const absolute = Array.from({ length: 64 }, () => -36);
        const settings = {
            centerCutPercent: 20,
            visualizationMode: 'inner-anchor-kelp' as const,
        };
        const first = buildReactiveCampfireScene(
            frameWith(absolute, undefined, { capturedAtMs: 10_000 }),
            settings,
            new Map(),
            1,
            new Map(),
            new Map(),
            20_000,
        );
        const second = buildReactiveCampfireScene(
            frameWith(absolute, undefined, { capturedAtMs: 10_020 }),
            settings,
            new Map(),
            1,
            new Map(),
            new Map(),
            20_020,
        );

        expect(second.filaments[0]).toMatchObject({
            angle: first.filaments[0].angle,
            innerRadius: first.filaments[0].innerRadius,
            outerRadius: first.filaments[0].outerRadius,
            bend: first.filaments[0].bend,
        });
        expect(second.flowTimeSeconds).toBeGreaterThan(first.flowTimeSeconds);
    });

    it('advances an inner-anchor impulse smoothly between slower analysis frames', () => {
        const frame = frameWith(
            Array.from({ length: 64 }, () => -36),
            undefined,
            { capturedAtMs: 10_000 },
        );
        const started = new Map([[50, 9_500]]);
        const first = buildReactiveCampfireScene(
            frame,
            { centerCutPercent: 4, visualizationMode: 'inner-anchor-kelp' },
            new Map(),
            1,
            new Map(),
            started,
            10_000,
        );
        const next = buildReactiveCampfireScene(
            frame,
            { centerCutPercent: 4, visualizationMode: 'inner-anchor-kelp' },
            new Map(),
            1,
            new Map(),
            started,
            10_020,
        );

        expect(next.filaments.find(({ harmonicIndex }) => harmonicIndex === 50)?.impulseAgeSeconds)
            .toBeCloseTo(0.52);
        expect(first.filaments.find(({ harmonicIndex }) => harmonicIndex === 50)?.impulseAgeSeconds)
            .toBeCloseTo(0.5);
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

    it('keeps the older radial ribbons activation-gated according to TTL', () => {
        const activeFrame = frameWith(
            Array.from({ length: 64 }, (_, index) => index === 50 ? -20 : -82),
            Array.from({ length: 64 }, () => 0),
            { capturedAtMs: 10_000 },
        );
        const frame = frameWith(
            Array.from({ length: 64 }, () => -82),
            Array.from({ length: 64 }, () => 0),
            { capturedAtMs: 10_000 },
        );
        const active = buildReactiveCampfireScene(
            activeFrame,
            {
                centerCutPercent: 4,
                activationTtlSeconds: 8,
                visualizationMode: 'radial-ribbons',
            },
        );
        const recentlyActive = buildReactiveCampfireScene(
            frame,
            {
                centerCutPercent: 4,
                activationTtlSeconds: 8,
                visualizationMode: 'radial-ribbons',
            },
            new Map(),
            1,
            new Map([[50, 6_000]]),
        );
        const expired = buildReactiveCampfireScene(
            frame,
            {
                centerCutPercent: 4,
                activationTtlSeconds: 8,
                visualizationMode: 'radial-ribbons',
            },
            new Map(),
            1,
            new Map([[50, 1_000]]),
        );
        const recentRibbon = recentlyActive.filaments.find(({ harmonicIndex }) => harmonicIndex === 50);
        const expiredRibbon = expired.filaments.find(({ harmonicIndex }) => harmonicIndex === 50);
        const activeRibbon = active.filaments.find(({ harmonicIndex }) => harmonicIndex === 50);

        expect(activeRibbon?.activation).toBeGreaterThan(HARMONIC_ACTIVATION_THRESHOLD);
        expect(activeRibbon?.visibility).toBe(1);
        expect(recentRibbon?.activation).toBeLessThan(HARMONIC_ACTIVATION_THRESHOLD);
        expect(recentRibbon?.visibility).toBeCloseTo(0.5);
        expect(expiredRibbon?.visibility).toBe(0);
    });

    it('keeps every selected kelp ribbon visible before and after activation', () => {
        const quietFrame = frameWith(
            Array.from({ length: 64 }, () => -120),
            Array.from({ length: 64 }, () => 0),
            { capturedAtMs: 20_000 },
        );
        const neverActivated = buildReactiveCampfireScene(
            quietFrame,
            {
                centerCutPercent: 4,
                activationTtlSeconds: 0,
                visualizationMode: 'inner-anchor-kelp',
            },
        );
        const longAfterActivation = buildReactiveCampfireScene(
            quietFrame,
            {
                centerCutPercent: 4,
                activationTtlSeconds: 1,
                visualizationMode: 'inner-anchor-kelp',
            },
            new Map(),
            1,
            new Map([[50, 1_000]]),
            new Map([[50, 1_000]]),
            20_000,
        );

        expect(neverActivated.filaments.length).toBeGreaterThan(0);
        expect(neverActivated.filaments.every(({ visibility }) => visibility === 1)).toBe(true);
        expect(neverActivated.rings.every(({ visibility }) => visibility === 1)).toBe(true);
        expect(longAfterActivation.filaments.every(({ visibility }) => visibility === 1)).toBe(true);
        expect(longAfterActivation.filaments.find(({ harmonicIndex }) => harmonicIndex === 50))
            .toMatchObject({ activation: 0, visibility: 1, impulseAgeSeconds: 19 });
    });
});
