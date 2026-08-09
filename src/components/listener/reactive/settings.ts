export const REACTIVE_PALETTES = ['ember', 'aurora', 'moon'] as const;

export type ReactivePalette = typeof REACTIVE_PALETTES[number];

export type ReactiveCampfireSettings = {
    sensitivity: number;
    absoluteFloorDb: number;
    baselineDurationSeconds: number;
    attackMs: number;
    releaseMs: number;
    trailSeconds: number;
    density: number;
    highDetail: number;
    palette: ReactivePalette;
    fftSize: 8_192 | 16_384;
};

export const DEFAULT_REACTIVE_CAMPFIRE_SETTINGS: Readonly<ReactiveCampfireSettings> = Object.freeze({
    sensitivity: 1,
    absoluteFloorDb: -92,
    baselineDurationSeconds: 24,
    attackMs: 180,
    releaseMs: 720,
    trailSeconds: 1.4,
    density: 0.72,
    highDetail: 0.7,
    palette: 'ember',
    fftSize: 16_384,
});

const LIMITS = {
    sensitivity: [0.2, 3],
    absoluteFloorDb: [-120, -36],
    baselineDurationSeconds: [5, 120],
    attackMs: [20, 1_000],
    releaseMs: [80, 4_000],
    trailSeconds: [0, 4],
    density: [0.2, 1],
    highDetail: [0, 1],
} as const;

function clampFinite(value: unknown, fallback: number, min: number, max: number): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, value));
}

export function validateReactiveCampfireSettings(
    candidate: Partial<ReactiveCampfireSettings> | null | undefined,
): ReactiveCampfireSettings {
    const fallback = DEFAULT_REACTIVE_CAMPFIRE_SETTINGS;
    const palette = candidate?.palette && REACTIVE_PALETTES.includes(candidate.palette)
        ? candidate.palette
        : fallback.palette;
    const fftSize = candidate?.fftSize === 8_192 || candidate?.fftSize === 16_384
        ? candidate.fftSize
        : fallback.fftSize;

    return {
        sensitivity: clampFinite(
            candidate?.sensitivity,
            fallback.sensitivity,
            ...LIMITS.sensitivity,
        ),
        absoluteFloorDb: clampFinite(
            candidate?.absoluteFloorDb,
            fallback.absoluteFloorDb,
            ...LIMITS.absoluteFloorDb,
        ),
        baselineDurationSeconds: clampFinite(
            candidate?.baselineDurationSeconds,
            fallback.baselineDurationSeconds,
            ...LIMITS.baselineDurationSeconds,
        ),
        attackMs: clampFinite(candidate?.attackMs, fallback.attackMs, ...LIMITS.attackMs),
        releaseMs: clampFinite(candidate?.releaseMs, fallback.releaseMs, ...LIMITS.releaseMs),
        trailSeconds: clampFinite(
            candidate?.trailSeconds,
            fallback.trailSeconds,
            ...LIMITS.trailSeconds,
        ),
        density: clampFinite(candidate?.density, fallback.density, ...LIMITS.density),
        highDetail: clampFinite(
            candidate?.highDetail,
            fallback.highDetail,
            ...LIMITS.highDetail,
        ),
        palette,
        fftSize,
    };
}

export function serializeReactiveCampfirePreset(settings: ReactiveCampfireSettings): string {
    return `${JSON.stringify({
        schemaVersion: 1,
        ...validateReactiveCampfireSettings(settings),
    }, null, 2)}\n`;
}
