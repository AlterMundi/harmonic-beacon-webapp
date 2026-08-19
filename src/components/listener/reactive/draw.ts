import type { HarmonicAnalysisFrame } from '@/lib/listener/analysis/types';

import type { ReactiveCampfireSettings, ReactivePalette } from './settings';
import { seededUnit, type ReactiveCampfireScene, type ReactiveFilament } from './scene';

type Palette = {
    core: [number, number, number];
    low: [number, number, number];
    mid: [number, number, number];
    high: [number, number, number];
};

const PALETTES: Record<ReactivePalette, Palette> = {
    ember: {
        core: [255, 248, 225],
        low: [255, 190, 94],
        mid: [255, 119, 175],
        high: [119, 226, 255],
    },
    aurora: {
        core: [236, 255, 248],
        low: [104, 242, 194],
        mid: [126, 166, 255],
        high: [217, 129, 255],
    },
    moon: {
        core: [255, 255, 255],
        low: [204, 216, 255],
        mid: [167, 192, 243],
        high: [207, 232, 255],
    },
};

function rgba(color: readonly number[], alpha: number): string {
    return `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${Math.max(0, Math.min(1, alpha))})`;
}

/**
 * Lowest-cost truthful renderer: one fixed halo driven only by measured
 * overall level. It deliberately skips harmonic scene construction, trails,
 * cloth geometry and animation. This is a diagnostic/product fallback, not a
 * synthetic approximation of the harmonic field.
 */
export function drawMinimalReactivePulse(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: HarmonicAnalysisFrame | null,
    settings: ReactiveCampfireSettings,
    decay = 1,
) {
    context.clearRect(0, 0, width, height);
    if (!frame || frame.confidence <= 0 || !Number.isFinite(frame.overallDb) || decay <= 0) return;
    const palette = PALETTES[settings.palette];
    const normalized = Math.max(0, Math.min(
        1,
        (frame.overallDb - settings.absoluteFloorDb) / (-12 - settings.absoluteFloorDb),
    ));
    if (normalized <= 0) return;
    const centerX = width * 0.5;
    const centerY = height * 0.48;
    const radius = Math.min(width, height)
        * (0.09 + normalized * 0.2)
        * (settings.zoomPercent / 100);
    const alpha = normalized * frame.confidence * decay;
    const glow = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
    glow.addColorStop(0, rgba(palette.core, alpha * 0.8));
    glow.addColorStop(0.34, rgba(palette.low, alpha * 0.42));
    glow.addColorStop(1, rgba(palette.mid, 0));
    context.fillStyle = glow;
    context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2);
}

function endpoint(
    centerX: number,
    centerY: number,
    scale: number,
    radius: number,
    angle: number,
): [number, number] {
    return [
        centerX + Math.cos(angle) * radius * scale,
        centerY + Math.sin(angle) * radius * scale,
    ];
}

export type ClothRibbonPoint = {
    centerX: number;
    centerY: number;
    halfWidth: number;
};

export function innerKelpRotationAt(
    timeSeconds: number,
    degreesPerMinute: number,
): number {
    if (!Number.isFinite(timeSeconds) || !Number.isFinite(degreesPerMinute)) return 0;
    const radiansPerSecond = degreesPerMinute * Math.PI / 180 / 60;
    if (radiansPerSecond === 0) return 0;
    const revolutionSeconds = Math.PI * 2
        / Math.abs(radiansPerSecond);
    return (timeSeconds % revolutionSeconds)
        * radiansPerSecond;
}

export function scaledCenterFieldRadius(
    radius: number,
    settings: Pick<ReactiveCampfireSettings, 'centerFieldScalePercent'>,
): number {
    return radius * settings.centerFieldScalePercent / 100;
}

export function centerFieldStrokeWidth(
    weight: number,
    settings: Pick<ReactiveCampfireSettings, 'centerRibbonWidth'>,
): number {
    return Math.max(0.5, (2 + weight * 2.5) * settings.centerRibbonWidth);
}

function smoothstep(value: number): number {
    const bounded = Math.max(0, Math.min(1, value));
    return bounded * bounded * (3 - 2 * bounded);
}

export function innerRibbonOpacityStops(
    bodyAlpha: number,
    endAlpha: number,
): ReadonlyArray<readonly [offset: number, alpha: number]> {
    const body = Math.max(0, Math.min(1, bodyAlpha));
    const end = Math.max(0, Math.min(1, endAlpha));
    return [
        [0, 0],
        [0.16, body * 0.12],
        [0.36, body * 0.72],
        [0.52, body],
        [1, end],
    ];
}

function applyInnerRibbonOpacityRamp(
    gradient: CanvasGradient,
    color: readonly number[],
    bodyAlpha: number,
    endAlpha: number,
) {
    for (const [offset, alpha] of innerRibbonOpacityStops(bodyAlpha, endAlpha)) {
        gradient.addColorStop(offset, rgba(color, alpha));
    }
}

/**
 * A small deterministic cloth model: the inner edge is pinned and two slow
 * waves travel toward the free edge. Absolute energy and measured variation
 * amplify the motion without ever translating the camera.
 */
export function buildClothRibbonPoints({
    start,
    control,
    end,
    startWidth,
    endWidth,
    harmonicIndex,
    timeSeconds,
    activity,
    wiggle,
}: {
    start: readonly [number, number];
    control: readonly [number, number];
    end: readonly [number, number];
    startWidth: number;
    endWidth: number;
    harmonicIndex: number;
    timeSeconds: number;
    activity: number;
    wiggle: number;
}): ClothRibbonPoint[] {
    const points: ClothRibbonPoint[] = [];
    const phase = seededUnit(harmonicIndex, 91) * Math.PI * 2;
    const slowRate = 0.12 + seededUnit(harmonicIndex, 93) * 0.12;
    const livelyRate = 0.22 + seededUnit(harmonicIndex, 95) * 0.22;
    const ambientAmplitude = 0.65;
    const activeAmplitude = Math.max(0, activity) * 4.5 + Math.max(0, wiggle) * 8.5;
    const perspective = 0.45 + seededUnit(harmonicIndex, 97) * 0.55;
    const segments = 12;

    for (let segment = 0; segment <= segments; segment += 1) {
        const t = segment / segments;
        const oneMinusT = 1 - t;
        const baseX = oneMinusT * oneMinusT * start[0]
            + 2 * oneMinusT * t * control[0]
            + t * t * end[0];
        const baseY = oneMinusT * oneMinusT * start[1]
            + 2 * oneMinusT * t * control[1]
            + t * t * end[1];
        const tangentX = 2 * oneMinusT * (control[0] - start[0])
            + 2 * t * (end[0] - control[0]);
        const tangentY = 2 * oneMinusT * (control[1] - start[1])
            + 2 * t * (end[1] - control[1]);
        const tangentLength = Math.max(1, Math.hypot(tangentX, tangentY));
        const normalX = -tangentY / tangentLength;
        const normalY = tangentX / tangentLength;
        const freeEdge = t ** 1.65;
        const ambientWave = Math.sin(
            phase + timeSeconds * Math.PI * 2 * slowRate + t * Math.PI * 2.2,
        ) * ambientAmplitude;
        const activatedWave = Math.sin(
            phase * 0.63 + timeSeconds * Math.PI * 2 * livelyRate + t * Math.PI * 4.6,
        ) * activeAmplitude;
        const displacement = (ambientWave + activatedWave) * freeEdge;
        const leafProfile = 0.32
            + Math.sin(Math.PI * t) * 0.78
            + perspective * t * t * 0.52;
        points.push({
            centerX: baseX + normalX * displacement,
            centerY: baseY + normalY * displacement,
            // Narrow pinned stem, full body, then a perspective-biased free
            // edge. Outer leaves therefore feel closer without camera motion.
            halfWidth: (startWidth + (endWidth - startWidth) * t) * leafProfile,
        });
    }
    return points;
}

/**
 * An inner-driven rope/leaf model. The first sample is pinned; ambient water
 * and measured activation both use a delayed phase, so their wavefront travels
 * from the center-facing anchor toward the free edge. Activation has an actual
 * causal front: samples remain unchanged until the measured rising edge has
 * had enough time to reach them.
 */
export function buildInnerDrivenRibbonPoints({
    start,
    control,
    end,
    startWidth,
    endWidth,
    harmonicIndex,
    timeSeconds,
    activity,
    wiggle,
    impulseAgeSeconds,
    propagationSpeed,
    damping,
    innerImpulse,
}: {
    start: readonly [number, number];
    control: readonly [number, number];
    end: readonly [number, number];
    startWidth: number;
    endWidth: number;
    harmonicIndex: number;
    timeSeconds: number;
    activity: number;
    wiggle: number;
    impulseAgeSeconds: number | null;
    propagationSpeed: number;
    damping: number;
    innerImpulse: number;
}): ClothRibbonPoint[] {
    const points: ClothRibbonPoint[] = [];
    const phase = seededUnit(harmonicIndex, 191) * Math.PI * 2;
    const ambientRate = 0.07 + seededUnit(harmonicIndex, 193) * 0.055;
    const activeRate = 0.24 + seededUnit(harmonicIndex, 195) * 0.2;
    const safeSpeed = Math.max(0.2, propagationSpeed);
    const safeDamping = Math.max(0.2, damping);
    const safeImpulse = Math.max(0, innerImpulse);
    const perspective = 0.45 + seededUnit(harmonicIndex, 197) * 0.55;
    const segments = 18;

    for (let segment = 0; segment <= segments; segment += 1) {
        const t = segment / segments;
        const oneMinusT = 1 - t;
        const baseX = oneMinusT * oneMinusT * start[0]
            + 2 * oneMinusT * t * control[0]
            + t * t * end[0];
        const baseY = oneMinusT * oneMinusT * start[1]
            + 2 * oneMinusT * t * control[1]
            + t * t * end[1];
        const tangentX = 2 * oneMinusT * (control[0] - start[0])
            + 2 * t * (end[0] - control[0]);
        const tangentY = 2 * oneMinusT * (control[1] - start[1])
            + 2 * t * (end[1] - control[1]);
        const tangentLength = Math.max(1, Math.hypot(tangentX, tangentY));
        const normalX = -tangentY / tangentLength;
        const normalY = tangentX / tangentLength;

        // Constant phase moves toward increasing t because every outer sample
        // evaluates an earlier source time. This is the opposite sign from an
        // exterior-driven wave.
        const travelDelay = t * 1.55 / safeSpeed;
        const delayedTime = timeSeconds - travelDelay;
        const pinnedProfile = Math.sin(t * Math.PI * 0.5) ** 1.35;
        const ambientWave = Math.sin(
            phase + delayedTime * Math.PI * 2 * ambientRate,
        ) * 0.7 * pinnedProfile;

        const arrival = impulseAgeSeconds === null
            ? 0
            : smoothstep((impulseAgeSeconds - travelDelay) / 0.18);
        const spatialDamping = Math.exp(-safeDamping * t * 0.24);
        const measuredAmplitude = (
            Math.max(0, activity) * 4.1 + Math.max(0, wiggle) * 9.4
        ) * safeImpulse;
        const activatedWave = Math.sin(
            phase * 0.61 + delayedTime * Math.PI * 2 * activeRate,
        ) * measuredAmplitude * arrival * spatialDamping * pinnedProfile;
        const displacement = ambientWave + activatedWave;
        const leafProfile = 0.28
            + Math.sin(Math.PI * t) * 0.82
            + perspective * t * t * 0.5;
        points.push({
            centerX: baseX + normalX * displacement,
            centerY: baseY + normalY * displacement,
            halfWidth: (startWidth + (endWidth - startWidth) * t) * leafProfile,
        });
    }
    return points;
}

function fillRibbonPoints(
    context: CanvasRenderingContext2D,
    points: readonly ClothRibbonPoint[],
) {
    context.beginPath();
    points.forEach((point, index) => {
        const previous = points[Math.max(0, index - 1)];
        const next = points[Math.min(points.length - 1, index + 1)];
        const dx = next.centerX - previous.centerX;
        const dy = next.centerY - previous.centerY;
        const length = Math.max(1, Math.hypot(dx, dy));
        const x = point.centerX - (dy / length) * point.halfWidth;
        const y = point.centerY + (dx / length) * point.halfWidth;
        if (index === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
    });
    [...points].reverse().forEach((point, reverseIndex) => {
        const index = points.length - 1 - reverseIndex;
        const previous = points[Math.max(0, index - 1)];
        const next = points[Math.min(points.length - 1, index + 1)];
        const dx = next.centerX - previous.centerX;
        const dy = next.centerY - previous.centerY;
        const length = Math.max(1, Math.hypot(dx, dy));
        context.lineTo(
            point.centerX + (dy / length) * point.halfWidth,
            point.centerY - (dx / length) * point.halfWidth,
        );
    });
    context.closePath();
    context.fill();
}

function fillClothRibbon(
    context: CanvasRenderingContext2D,
    start: readonly [number, number],
    control: readonly [number, number],
    end: readonly [number, number],
    startWidth: number,
    endWidth: number,
    harmonicIndex: number,
    timeSeconds: number,
    activity: number,
    wiggle: number,
) {
    const points = buildClothRibbonPoints({
        start,
        control,
        end,
        startWidth,
        endWidth,
        harmonicIndex,
        timeSeconds,
        activity,
        wiggle,
    });
    fillRibbonPoints(context, points);
}

function fillInnerDrivenRibbon(
    context: CanvasRenderingContext2D,
    start: readonly [number, number],
    control: readonly [number, number],
    end: readonly [number, number],
    startWidth: number,
    endWidth: number,
    filament: ReactiveFilament,
    timeSeconds: number,
    settings: ReactiveCampfireSettings,
    impulseAgeSeconds = filament.impulseAgeSeconds,
    activity = filament.activity,
    wiggle = filament.wiggle,
) {
    fillRibbonPoints(context, buildInnerDrivenRibbonPoints({
        start,
        control,
        end,
        startWidth,
        endWidth,
        harmonicIndex: filament.harmonicIndex,
        timeSeconds,
        activity,
        wiggle,
        impulseAgeSeconds,
        propagationSpeed: settings.kelpPropagationSpeed,
        damping: settings.kelpDamping,
        innerImpulse: settings.kelpInnerImpulse,
    }));
}

function drawRadialRibbon(
    context: CanvasRenderingContext2D,
    filament: ReactiveFilament,
    centerX: number,
    centerY: number,
    scale: number,
    palette: Palette,
    settings: ReactiveCampfireSettings,
    timeSeconds: number,
) {
    if (filament.visibility <= 0) return;
    const ribbonScale = settings.ribbonWidth;
    const innerDriven = settings.visualizationMode === 'inner-anchor-kelp';
    const color = filament.tier === 'high' ? palette.high : palette.mid;
    const start = endpoint(
        centerX,
        centerY,
        scale,
        filament.innerRadius,
        filament.angle - filament.bend * 0.35,
    );
    const end = endpoint(centerX, centerY, scale, filament.outerRadius, filament.angle);
    const control = endpoint(
        centerX,
        centerY,
        scale,
        (filament.innerRadius + filament.outerRadius) * 0.54,
        filament.angle + filament.bend,
    );

    for (const ghost of filament.trail) {
        const ghostStart = endpoint(
            centerX,
            centerY,
            scale,
            ghost.innerRadius,
            ghost.angle - ghost.bend * 0.35,
        );
        const ghostEnd = endpoint(
            centerX,
            centerY,
            scale,
            ghost.outerRadius,
            ghost.angle,
        );
        const ghostControl = endpoint(
            centerX,
            centerY,
            scale,
            (ghost.innerRadius + ghost.outerRadius) * 0.54,
            ghost.angle + ghost.bend,
        );
        const ghostWidth = (1.4 + ghost.weight * 2.6) * ribbonScale;
        if (innerDriven) {
            const ghostGradient = context.createLinearGradient(
                ghostStart[0],
                ghostStart[1],
                ghostEnd[0],
                ghostEnd[1],
            );
            applyInnerRibbonOpacityRamp(
                ghostGradient,
                color,
                ghost.opacity * filament.visibility,
                ghost.opacity * 0.62 * filament.visibility,
            );
            context.fillStyle = ghostGradient;
            const ghostAge = filament.impulseAgeSeconds === null
                ? null
                : Math.max(0, filament.impulseAgeSeconds - (
                    timeSeconds - ghost.capturedAtMs / 1_000
                ));
            fillInnerDrivenRibbon(
                context,
                ghostStart,
                ghostControl,
                ghostEnd,
                ghostWidth * 0.36,
                ghostWidth,
                filament,
                ghost.capturedAtMs / 1_000,
                settings,
                ghostAge,
                ghost.activity,
                ghost.wiggle,
            );
        } else {
            context.fillStyle = rgba(color, ghost.opacity * filament.visibility);
            fillClothRibbon(
                context,
                ghostStart,
                ghostControl,
                ghostEnd,
                ghostWidth * 0.36,
                ghostWidth,
                filament.harmonicIndex,
                ghost.capturedAtMs / 1_000,
                ghost.activity,
                ghost.wiggle,
            );
        }
    }

    const width = (1.8 + filament.weight * 3.2) * ribbonScale;
    const leafGradient = context.createLinearGradient(start[0], start[1], end[0], end[1]);
    if (innerDriven) {
        applyInnerRibbonOpacityRamp(
            leafGradient,
            color,
            (0.025 + filament.opacity * 0.68 + filament.activation * 0.12)
                * filament.visibility,
            (0.012 + filament.opacity * 0.44) * filament.visibility,
        );
    } else {
        leafGradient.addColorStop(0, rgba(
            color,
            (0.012 + filament.opacity * 0.18) * filament.visibility,
        ));
        leafGradient.addColorStop(0.58, rgba(
            color,
            (0.018 + filament.opacity * 0.62) * filament.visibility,
        ));
        leafGradient.addColorStop(1, rgba(
            color,
            (0.025 + filament.opacity * 0.86) * filament.visibility,
        ));
    }
    context.fillStyle = leafGradient;
    context.save();
    const glowStrength = filament.activation * filament.visibility;
    context.shadowColor = rgba(color, Math.min(0.8, glowStrength * 0.72));
    context.shadowBlur = glowStrength > 0.08
        ? Math.min(22, glowStrength * 16 * ribbonScale)
        : 0;
    if (innerDriven) {
        fillInnerDrivenRibbon(
            context,
            start,
            control,
            end,
            width * 0.42,
            width,
            filament,
            timeSeconds,
            settings,
        );
    } else {
        fillClothRibbon(
            context,
            start,
            control,
            end,
            width * 0.42,
            width,
            filament.harmonicIndex,
            timeSeconds,
            filament.activity,
            filament.wiggle,
        );
    }
    context.restore();

    if (!innerDriven && filament.emphasis > 0.04 && filament.visibility > 0) {
        context.fillStyle = rgba(
            color,
            filament.emphasis * 0.42 * filament.visibility,
        );
        context.beginPath();
        context.arc(end[0], end[1], width * (0.45 + filament.emphasis), 0, Math.PI * 2);
        context.fill();
    }
}

function drawRadialField(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    scene: ReactiveCampfireScene,
    palette: Palette,
    settings: ReactiveCampfireSettings,
) {
    const scale = Math.min(width, height) * 0.72;
    // Deliberately invariant: no audio measurement may translate this point.
    const centerX = width * 0.5;
    const centerY = height * 0.48;

    const atmosphere = context.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        Math.max(width, height) * 0.72,
    );
    atmosphere.addColorStop(0, rgba(palette.low, 0.075 * scene.confidence));
    atmosphere.addColorStop(0.34, 'rgba(19, 57, 78, 0.055)');
    atmosphere.addColorStop(1, 'rgba(2, 8, 24, 0)');
    context.fillStyle = atmosphere;
    context.fillRect(0, 0, width, height);

    context.save();
    if (settings.visualizationMode === 'inner-anchor-kelp') {
        context.translate(centerX, centerY);
        context.rotate(innerKelpRotationAt(
            scene.flowTimeSeconds,
            settings.rotationDegreesPerMinute,
        ));
        context.translate(-centerX, -centerY);
    }

    for (const ring of scene.rings) {
        if (ring.visibility <= 0) continue;
        context.save();
        context.shadowColor = rgba(palette.low, ring.activation * 0.65);
        context.shadowBlur = ring.activation > 0.08 ? Math.min(18, ring.activation * 16) : 0;
        context.strokeStyle = rgba(palette.low, ring.opacity * 0.72 * ring.visibility);
        context.lineWidth = centerFieldStrokeWidth(ring.weight, settings);
        context.beginPath();
        context.ellipse(
            centerX,
            centerY,
            scaledCenterFieldRadius(ring.radius * scale, settings)
                * (1 + scene.core.stereoWidth * 0.08),
            scaledCenterFieldRadius(ring.radius * scale, settings) * ring.eccentricity,
            ring.rotation,
            0,
            Math.PI * 2,
        );
        context.stroke();
        context.restore();
    }

    for (const filament of scene.filaments) {
        drawRadialRibbon(
            context,
            filament,
            centerX,
            centerY,
            scale,
            palette,
            settings,
            scene.flowTimeSeconds,
        );
    }

    for (const veil of scene.veils) {
        context.strokeStyle = rgba(palette.high, veil.opacity);
        context.lineWidth = Math.max(1.5, veil.weight * settings.ribbonWidth * 1.8);
        context.beginPath();
        context.arc(
            centerX,
            centerY,
            veil.radius * scale,
            veil.startAngle,
            veil.startAngle + veil.arcLength,
        );
        context.stroke();
    }

    if (scene.core.radius > 0) {
        const radius = scaledCenterFieldRadius(scene.core.radius * scale, settings);
        const auraRadius = Math.max(
            radius * 4.5,
            scaledCenterFieldRadius(Math.min(width, height) * 0.16, settings),
        );
        const aura = context.createRadialGradient(
            centerX,
            centerY,
            0,
            centerX,
            centerY,
            auraRadius,
        );
        aura.addColorStop(0, rgba(palette.core, scene.core.opacity * 0.32));
        aura.addColorStop(0.3, rgba(palette.low, scene.core.opacity * 0.16));
        aura.addColorStop(1, rgba(palette.high, 0));
        context.fillStyle = aura;
        context.beginPath();
        context.arc(centerX, centerY, auraRadius, 0, Math.PI * 2);
        context.fill();
        const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        gradient.addColorStop(0, rgba(palette.core, scene.core.opacity));
        gradient.addColorStop(0.28, rgba(palette.low, scene.core.opacity * 0.8));
        gradient.addColorStop(1, rgba(palette.mid, 0));
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.fill();
    }
    context.restore();
}

function drawHarmonicRadialSeries(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    scene: ReactiveCampfireScene,
    palette: Palette,
    settings: ReactiveCampfireSettings,
) {
    const centerX = width * 0.5;
    const centerY = height * 0.48;
    const scale = Math.min(width, height) * 0.82;

    const atmosphere = context.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        Math.min(width, height) * 0.72,
    );
    atmosphere.addColorStop(0, rgba(palette.low, scene.core.opacity * 0.075));
    atmosphere.addColorStop(0.48, rgba(palette.mid, 0.025 * scene.confidence));
    atmosphere.addColorStop(1, rgba(palette.high, 0));
    context.fillStyle = atmosphere;
    context.fillRect(0, 0, width, height);

    for (const ring of scene.seriesRings) {
        if (ring.visibility <= 0) continue;
        const color = ring.tier === 'low'
            ? palette.low
            : ring.tier === 'mid' ? palette.mid : palette.high;
        const radiusX = ring.radius * scale;
        const radiusY = radiusX * ring.eccentricity;
        const glowStrength = ring.activation * ring.visibility;
        context.save();
        context.shadowColor = rgba(color, Math.min(0.68, glowStrength * 0.62));
        context.shadowBlur = glowStrength > 0.05 ? Math.min(18, glowStrength * 14) : 0;
        context.strokeStyle = rgba(
            color,
            (0.012 + ring.opacity * 0.84) * ring.visibility,
        );
        context.lineWidth = Math.max(
            0.9,
            (0.7 + ring.weight * 1.45) * settings.ribbonWidth,
        );
        context.beginPath();
        context.ellipse(
            centerX,
            centerY,
            radiusX,
            radiusY,
            ring.rotation,
            0,
            Math.PI * 2,
        );
        context.stroke();
        context.restore();
    }

    if (scene.core.opacity > 0) {
        const radius = Math.max(12, scene.core.radius * scale * 2.2);
        const gradient = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
        gradient.addColorStop(0, rgba(palette.core, scene.core.opacity * 0.82));
        gradient.addColorStop(0.3, rgba(palette.low, scene.core.opacity * 0.52));
        gradient.addColorStop(1, rgba(palette.mid, 0));
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.fill();
    }
}

function drawHorizonField(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    scene: ReactiveCampfireScene,
    palette: Palette,
    settings: ReactiveCampfireSettings,
) {
    const horizonY = height * 0.42;
    const centerX = width * 0.5;
    const all = [
        ...scene.rings.map((ring) => ({
            harmonicIndex: ring.harmonicIndex,
            opacity: ring.opacity,
            weight: ring.weight,
            bend: ring.rotation * 0.12,
            activity: ring.opacity,
            wiggle: 0,
            activation: ring.activation,
            visibility: ring.visibility,
            tier: 'low' as const,
        })),
        ...scene.filaments.map((filament) => ({
            harmonicIndex: filament.harmonicIndex,
            opacity: filament.opacity,
            weight: filament.weight,
            bend: filament.bend,
            activity: filament.activity,
            wiggle: filament.wiggle,
            activation: filament.activation,
            visibility: filament.visibility,
            tier: filament.tier,
        })),
    ];

    // A fixed horizon makes the point of view legible. Harmonics emerge from
    // stable positions; only the local ribbon body responds to the signal.
    context.strokeStyle = rgba(palette.low, 0.12 * scene.confidence);
    context.lineWidth = Math.max(1, settings.ribbonWidth);
    context.beginPath();
    context.moveTo(width * 0.08, horizonY);
    context.bezierCurveTo(width * 0.3, horizonY - 8, width * 0.7, horizonY + 8, width * 0.92, horizonY);
    context.stroke();

    for (const item of all) {
        if (item.visibility <= 0) continue;
        const isCenter = item.harmonicIndex < scene.centerCutIndex;
        const seed = seededUnit(item.harmonicIndex, 71) * 2 - 1;
        const spread = isCenter ? 0.18 : 0.44;
        const startX = centerX + seed * width * spread;
        const startY = horizonY + (seededUnit(item.harmonicIndex, 73) - 0.5) * height * 0.035;
        const endX = centerX + seed * width * (isCenter ? 0.28 : 0.62);
        const endY = height * (isCenter ? 0.82 : 1.06);
        const controlX = (startX + endX) * 0.5 + item.bend * width * 0.12;
        const controlY = horizonY + height * (isCenter ? 0.19 : 0.3);
        const color = item.tier === 'low'
            ? palette.low
            : item.tier === 'high' ? palette.high : palette.mid;
        const widthScale = (2.4 + item.weight * 3.8) * settings.ribbonWidth;
        const leafGradient = context.createLinearGradient(startX, startY, endX, endY);
        leafGradient.addColorStop(0, rgba(
            color,
            (0.012 + item.opacity * 0.16) * item.visibility,
        ));
        leafGradient.addColorStop(0.58, rgba(
            color,
            (0.018 + item.opacity * 0.58) * item.visibility,
        ));
        leafGradient.addColorStop(1, rgba(
            color,
            (0.025 + item.opacity * 0.82) * item.visibility,
        ));
        context.fillStyle = leafGradient;
        context.save();
        const glowStrength = item.activation * item.visibility;
        context.shadowColor = rgba(color, Math.min(0.8, glowStrength * 0.7));
        context.shadowBlur = glowStrength > 0.08
            ? Math.min(22, glowStrength * 16 * settings.ribbonWidth)
            : 0;
        fillClothRibbon(
            context,
            [startX, startY],
            [controlX, controlY],
            [endX, endY],
            widthScale * 0.24,
            widthScale,
            item.harmonicIndex,
            scene.flowTimeSeconds,
            item.activity,
            item.wiggle,
        );
        context.restore();
    }

    if (scene.core.opacity > 0) {
        const glow = Math.min(width, height) * (0.09 + scene.core.radius);
        const gradient = context.createRadialGradient(centerX, horizonY, 0, centerX, horizonY, glow);
        gradient.addColorStop(0, rgba(palette.core, scene.core.opacity * 0.7));
        gradient.addColorStop(0.35, rgba(palette.low, scene.core.opacity * 0.35));
        gradient.addColorStop(1, rgba(palette.mid, 0));
        context.fillStyle = gradient;
        context.fillRect(centerX - glow, horizonY - glow, glow * 2, glow * 2);
    }
}

export function drawReactiveCampfire(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    scene: ReactiveCampfireScene,
    settings: ReactiveCampfireSettings,
) {
    context.clearRect(0, 0, width, height);
    if (scene.confidence <= 0) return;

    const palette = PALETTES[settings.palette];
    context.save();
    context.globalCompositeOperation = 'screen';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    const zoom = settings.zoomPercent / 100;
    context.translate(width * 0.5, height * 0.5);
    context.scale(zoom, zoom);
    context.translate(-width * 0.5, -height * 0.5);
    if (settings.visualizationMode === 'harmonic-radial-series') {
        drawHarmonicRadialSeries(context, width, height, scene, palette, settings);
    } else if (settings.visualizationMode === 'horizon-flow') {
        drawHorizonField(context, width, height, scene, palette, settings);
    } else {
        drawRadialField(context, width, height, scene, palette, settings);
    }
    context.restore();
}
