import { describe, expect, it } from 'vitest';

import {
    DEFAULT_REACTIVE_CAMPFIRE_SETTINGS,
    serializeReactiveCampfirePreset,
    validateReactiveCampfireSettings,
} from '../settings';

describe('reactive campfire settings', () => {
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
