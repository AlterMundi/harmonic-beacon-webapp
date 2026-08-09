import type { HarmonicAnalysisFrame } from '@/lib/listener/analysis/types';

import {
    DEFAULT_REACTIVE_CAMPFIRE_SETTINGS,
    type ReactiveCampfireSettings,
    validateReactiveCampfireSettings,
} from './settings';

export const MAX_RENDERED_HARMONICS = 128;
const LOW_HARMONIC_COUNT = 10;
const MID_HARMONIC_COUNT = 38;
const REFERENCE_CEILING_DB = -12;

export type HarmonicTrailSample = {
    capturedAtMs: number;
    absoluteDb: number;
    deltaDb: number;
};

export type ReactiveTrailHistory = ReadonlyMap<number, readonly HarmonicTrailSample[]>;

export type ReactiveRing = {
    harmonicIndex: number;
    radius: number;
    eccentricity: number;
    rotation: number;
    opacity: number;
    weight: number;
};

export type ReactiveFilament = {
    harmonicIndex: number;
    tier: 'mid' | 'high';
    angle: number;
    innerRadius: number;
    outerRadius: number;
    bend: number;
    opacity: number;
    weight: number;
    emphasis: number;
    trail: Array<{ radius: number; angle: number; opacity: number }>;
};

export type ReactiveCampfireScene = {
    core: {
        radius: number;
        opacity: number;
        stereoOffset: number;
        stereoWidth: number;
    };
    rings: ReactiveRing[];
    filaments: ReactiveFilament[];
    veils: Array<{
        bandIndex: number;
        radius: number;
        startAngle: number;
        arcLength: number;
        opacity: number;
        weight: number;
    }>;
    confidence: number;
};

function clamp(value: number, min = 0, max = 1): number {
    return Math.min(max, Math.max(min, value));
}

/** Stable pseudo-random-looking value derived only from an integer identity. */
export function seededUnit(index: number, salt = 0): number {
    const value = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43_758.5453;
    return value - Math.floor(value);
}

export function absoluteEnergy(
    db: number,
    floorDb = DEFAULT_REACTIVE_CAMPFIRE_SETTINGS.absoluteFloorDb,
): number {
    if (!Number.isFinite(db)) return 0;
    return clamp((db - floorDb) / (REFERENCE_CEILING_DB - floorDb));
}

export function smoothVisualDb(
    previousDb: number,
    targetDb: number,
    elapsedMs: number,
    attackMs: number,
    releaseMs: number,
): number {
    if (!Number.isFinite(targetDb)) return targetDb;
    if (!Number.isFinite(previousDb) || elapsedMs <= 0) return targetDb;
    const timeConstant = targetDb > previousDb ? attackMs : releaseMs;
    const alpha = 1 - Math.exp(-elapsedMs / Math.max(1, timeConstant));
    return previousDb + (targetDb - previousDb) * alpha;
}

export function selectHarmonicIndexes(length: number, density: number, highDetail: number): number[] {
    const safeLength = Math.max(0, Math.floor(length));
    if (safeLength <= LOW_HARMONIC_COUNT) {
        return Array.from({ length: safeLength }, (_, index) => index);
    }

    const targetCount = Math.min(
        safeLength,
        Math.max(LOW_HARMONIC_COUNT, Math.round(MAX_RENDERED_HARMONICS * clamp(density, 0.2, 1))),
    );
    const selected = new Set<number>();
    const guaranteedLowAndMid = Math.min(safeLength, MID_HARMONIC_COUNT, targetCount);
    for (let index = 0; index < guaranteedLowAndMid; index += 1) selected.add(index);

    const remaining = targetCount - selected.size;
    const upperStart = guaranteedLowAndMid;
    const upperLength = safeLength - upperStart;
    for (let slot = 0; slot < remaining && upperLength > 0; slot += 1) {
        const progress = remaining === 1 ? 1 : slot / (remaining - 1);
        // Detail shifts sampling toward the upper register without ever dropping
        // the last measurable harmonic. Every chosen line retains its real index.
        const shaped = progress ** (1 + (1 - clamp(highDetail)) * 0.85);
        selected.add(Math.min(safeLength - 1, upperStart + Math.round(shaped * (upperLength - 1))));
    }
    for (let index = upperStart; selected.size < targetCount && index < safeLength; index += 1) {
        selected.add(index);
    }
    return [...selected].sort((a, b) => a - b).slice(0, MAX_RENDERED_HARMONICS);
}

function movementFor(deltaDb: number, absolute: number, sensitivity: number): number {
    if (!Number.isFinite(deltaDb) || absolute <= 0) return 0;
    return clamp(deltaDb / 9, -1, 1) * sensitivity * absolute;
}

function trailFor(
    index: number,
    samples: readonly HarmonicTrailSample[] | undefined,
    nowMs: number,
    trailSeconds: number,
    absoluteFloorDb: number,
    sensitivity: number,
    baseAngle: number,
    baseOuterRadius: number,
): ReactiveFilament['trail'] {
    if (!samples || trailSeconds <= 0) return [];
    const windowMs = trailSeconds * 1_000;
    return samples
        .filter((sample) => nowMs - sample.capturedAtMs >= 0 && nowMs - sample.capturedAtMs <= windowMs)
        .slice(-18)
        .map((sample) => {
            const absolute = absoluteEnergy(sample.absoluteDb, absoluteFloorDb);
            const movement = movementFor(sample.deltaDb, absolute, sensitivity);
            const age = clamp(1 - (nowMs - sample.capturedAtMs) / windowMs);
            return {
                radius: baseOuterRadius + movement * 0.032,
                angle: baseAngle + movement * 0.055,
                opacity: absolute * age * 0.42,
            };
        });
}

export function buildReactiveCampfireScene(
    frame: HarmonicAnalysisFrame | null,
    settingsCandidate: Partial<ReactiveCampfireSettings> = {},
    history: ReactiveTrailHistory = new Map(),
    decay = 1,
): ReactiveCampfireScene {
    const settings = validateReactiveCampfireSettings(settingsCandidate);
    const confidence = clamp(frame?.confidence ?? 0) * clamp(decay);
    const overall = absoluteEnergy(frame?.overallDb ?? Number.NEGATIVE_INFINITY, settings.absoluteFloorDb);
    const harmonics = frame?.harmonicAbsoluteDb ?? new Float32Array();
    const deltas = frame?.harmonicDeltaDb ?? new Float32Array();
    const indexes = selectHarmonicIndexes(harmonics.length, settings.density, settings.highDetail);
    const capturedAtMs = frame?.capturedAtMs ?? 0;
    const rings: ReactiveRing[] = [];
    const filaments: ReactiveFilament[] = [];
    const envelope = frame?.spectralEnvelopeDb ?? new Float32Array();
    const veils = Array.from(
        { length: Math.min(24, envelope.length) },
        (_, bandIndex) => {
            const absolute = absoluteEnergy(envelope[bandIndex], settings.absoluteFloorDb) * confidence;
            return {
                bandIndex,
                radius: 0.2 + (bandIndex / Math.max(1, envelope.length - 1)) * 0.7,
                startAngle: seededUnit(bandIndex, 41) * Math.PI * 2,
                arcLength: 0.18 + seededUnit(bandIndex, 43) * 0.38,
                opacity: absolute * 0.16,
                weight: 0.3 + absolute * 0.65,
            };
        },
    );

    for (const index of indexes) {
        const absolute = absoluteEnergy(harmonics[index], settings.absoluteFloorDb) * confidence;
        if (index < LOW_HARMONIC_COUNT) {
            rings.push({
                harmonicIndex: index,
                radius: 0.09 + index * 0.024,
                eccentricity: 0.7 + seededUnit(index, 4) * 0.18,
                rotation: (seededUnit(index, 8) - 0.5) * 0.55,
                opacity: absolute * 0.72,
                weight: 0.5 + absolute * 2.3,
            });
            continue;
        }

        const tier = index < MID_HARMONIC_COUNT ? 'mid' : 'high';
        const baseAngle = seededUnit(index, 2) * Math.PI * 2;
        const innerRadius = tier === 'mid'
            ? 0.12 + seededUnit(index, 9) * 0.08
            : 0.24 + seededUnit(index, 9) * 0.13;
        const baseOuterRadius = tier === 'mid'
            ? 0.38 + seededUnit(index, 11) * 0.25
            : 0.57 + seededUnit(index, 11) * 0.32;
        const movement = movementFor(deltas[index] ?? 0, absolute, settings.sensitivity);

        filaments.push({
            harmonicIndex: index,
            tier,
            angle: baseAngle + movement * (tier === 'high' ? 0.075 : 0.045),
            innerRadius,
            outerRadius: baseOuterRadius + movement * (tier === 'high' ? 0.05 : 0.028),
            bend: (seededUnit(index, 6) - 0.5) * 0.24 + movement * 0.035,
            opacity: absolute * (tier === 'high' ? 0.62 : 0.7),
            weight: 0.35 + absolute * (tier === 'high' ? 1.05 : 1.5),
            // Delta never raises opacity or weight: it changes geometry and the
            // secondary highlight only, preserving truthful absolute hierarchy.
            emphasis: clamp(Math.abs(movement)) * absolute,
            trail: tier === 'high'
                ? trailFor(
                    index,
                    history.get(index),
                    capturedAtMs,
                    settings.trailSeconds,
                    settings.absoluteFloorDb,
                    settings.sensitivity,
                    baseAngle,
                    baseOuterRadius,
                )
                : [],
        });
    }

    return {
        core: {
            radius: (0.035 + overall * 0.055) * confidence,
            opacity: overall * 0.84 * confidence,
            stereoOffset: clamp(frame?.stereoBalance ?? 0, -1, 1) * 0.026,
            stereoWidth: clamp(frame?.stereoWidth ?? 0),
        },
        rings,
        filaments,
        veils,
        confidence,
    };
}
