export const REACTIVE_PALETTES = ['ember', 'aurora', 'moon'] as const;
export const REACTIVE_VISUALIZATION_MODES = [
    'harmonic-radial-series',
    'radial-ribbons',
    'horizon-flow',
] as const;

export type ReactivePalette = typeof REACTIVE_PALETTES[number];
export type ReactiveVisualizationMode = typeof REACTIVE_VISUALIZATION_MODES[number];

export type ReactiveCampfireSettings = {
    sensitivity: number;
    absoluteFloorDb: number;
    baselineDurationSeconds: number;
    attackMs: number;
    releaseMs: number;
    trailSeconds: number;
    density: number;
    highDetail: number;
    centerCutPercent: number;
    radialSpacingGrowthPercent: number;
    zoomPercent: number;
    activationTtlSeconds: number;
    ribbonWidth: number;
    palette: ReactivePalette;
    visualizationMode: ReactiveVisualizationMode;
    fftSize: 8_192 | 16_384;
};

export const DEFAULT_REACTIVE_CAMPFIRE_SETTINGS: Readonly<ReactiveCampfireSettings> = Object.freeze({
    sensitivity: 3,
    absoluteFloorDb: -120,
    baselineDurationSeconds: 24,
    attackMs: 20,
    releaseMs: 140,
    trailSeconds: 0,
    density: 1,
    highDetail: 1,
    centerCutPercent: 4,
    radialSpacingGrowthPercent: 65,
    zoomPercent: 100,
    activationTtlSeconds: 8,
    ribbonWidth: 3,
    palette: 'ember',
    visualizationMode: 'radial-ribbons',
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
    centerCutPercent: [0, 100],
    radialSpacingGrowthPercent: [0, 250],
    zoomPercent: [50, 220],
    activationTtlSeconds: [0, 30],
    ribbonWidth: [0.6, 3],
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
    const visualizationMode = candidate?.visualizationMode
        && REACTIVE_VISUALIZATION_MODES.includes(candidate.visualizationMode)
        ? candidate.visualizationMode
        : fallback.visualizationMode;
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
        centerCutPercent: Math.round(clampFinite(
            candidate?.centerCutPercent,
            fallback.centerCutPercent,
            ...LIMITS.centerCutPercent,
        )),
        radialSpacingGrowthPercent: Math.round(clampFinite(
            candidate?.radialSpacingGrowthPercent,
            fallback.radialSpacingGrowthPercent,
            ...LIMITS.radialSpacingGrowthPercent,
        )),
        zoomPercent: Math.round(clampFinite(
            candidate?.zoomPercent,
            fallback.zoomPercent,
            ...LIMITS.zoomPercent,
        )),
        activationTtlSeconds: clampFinite(
            candidate?.activationTtlSeconds,
            fallback.activationTtlSeconds,
            ...LIMITS.activationTtlSeconds,
        ),
        ribbonWidth: clampFinite(
            candidate?.ribbonWidth,
            fallback.ribbonWidth,
            ...LIMITS.ribbonWidth,
        ),
        palette,
        visualizationMode,
        fftSize,
    };
}

export function serializeReactiveCampfirePreset(settings: ReactiveCampfireSettings): string {
    return `${JSON.stringify({
        schemaVersion: 1,
        ...validateReactiveCampfireSettings(settings),
    }, null, 2)}\n`;
}
