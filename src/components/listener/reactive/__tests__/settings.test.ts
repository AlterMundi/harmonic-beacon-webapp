import { describe, expect, it } from 'vitest';

import {
    DEFAULT_REACTIVE_CAMPFIRE_SETTINGS,
    serializeReactiveCampfirePreset,
    validateReactiveCampfireSettings,
} from '../settings';

describe('reactive campfire settings', () => {
    it('uses the accepted inner-anchor kelp preset exactly', () => {
        expect(JSON.parse(serializeReactiveCampfirePreset(
            DEFAULT_REACTIVE_CAMPFIRE_SETTINGS,
        ))).toEqual({
            schemaVersion: 1,
            sensitivity: 3,
            absoluteFloorDb: -70,
            baselineDurationSeconds: 24,
            attackMs: 30,
            releaseMs: 380,
            trailSeconds: 4,
            density: 0.95,
            highDetail: 1,
            centerCutPercent: 3,
            centerFieldScalePercent: 100,
            centerRibbonWidth: 3,
            rotationDegreesPerMinute: -20.6,
            radialSpacingGrowthPercent: 65,
            zoomPercent: 220,
            activationTtlSeconds: 27.5,
            ribbonWidth: 3,
            kelpPropagationSpeed: 0.24,
            kelpDamping: 2.8,
            kelpInnerImpulse: 3,
            palette: 'moon',
            visualizationMode: 'inner-anchor-kelp',
            fftSize: 16_384,
        });
    });

    it('clamps unsafe numeric input and rejects unknown enumerations', () => {
        const settings = validateReactiveCampfireSettings({
            sensitivity: Number.NaN,
            absoluteFloorDb: -999,
            baselineDurationSeconds: 999,
            attackMs: -1,
            releaseMs: Number.POSITIVE_INFINITY,
            trailSeconds: 20,
            density: -4,
            highDetail: 8,
            centerFieldScalePercent: -1,
            centerRibbonWidth: 99,
            rotationDegreesPerMinute: -999,
            zoomPercent: 999,
            activationTtlSeconds: -1,
            kelpPropagationSpeed: 99,
            kelpDamping: -1,
            kelpInnerImpulse: 99,
            palette: 'unknown' as never,
            fftSize: 32_768 as never,
        });

        expect(settings).toEqual({
            ...DEFAULT_REACTIVE_CAMPFIRE_SETTINGS,
            absoluteFloorDb: -120,
            baselineDurationSeconds: 120,
            attackMs: 20,
            trailSeconds: 4,
            density: 0.2,
            highDetail: 1,
            centerFieldScalePercent: 10,
            centerRibbonWidth: 3,
            rotationDegreesPerMinute: -90,
            zoomPercent: 220,
            activationTtlSeconds: 0,
            kelpPropagationSpeed: 2,
            kelpDamping: 0.2,
            kelpInnerImpulse: 3,
        });
    });

    it('exports a versioned, validated and reproducible JSON preset', () => {
        const serialized = serializeReactiveCampfirePreset({
            ...DEFAULT_REACTIVE_CAMPFIRE_SETTINGS,
            palette: 'aurora',
            sensitivity: 1.35,
        });

        expect(serialized.endsWith('\n')).toBe(true);
        expect(JSON.parse(serialized)).toEqual({
            schemaVersion: 1,
            ...DEFAULT_REACTIVE_CAMPFIRE_SETTINGS,
            sensitivity: 1.35,
            palette: 'aurora',
        });
        expect(serializeReactiveCampfirePreset(JSON.parse(serialized)))
            .toBe(serialized);
    });
});
