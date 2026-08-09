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

function drawRadialRibbon(
    context: CanvasRenderingContext2D,
    filament: ReactiveFilament,
    centerX: number,
    centerY: number,
    scale: number,
    palette: Palette,
    ribbonScale: number,
    timeSeconds: number,
) {
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

    if (filament.trail.length > 1) {
        context.strokeStyle = rgba(color, Math.max(...filament.trail.map((point) => point.opacity)));
        context.lineWidth = Math.max(1.5, filament.weight * ribbonScale * 1.4);
        context.beginPath();
        filament.trail.forEach((point, index) => {
            const [x, y] = endpoint(centerX, centerY, scale, point.radius, point.angle);
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        });
        context.stroke();
    }

    const width = (1.8 + filament.weight * 3.2) * ribbonScale;
    const leafGradient = context.createLinearGradient(start[0], start[1], end[0], end[1]);
    leafGradient.addColorStop(0, rgba(color, 0.018 + filament.opacity * 0.18));
    leafGradient.addColorStop(0.58, rgba(color, 0.025 + filament.opacity * 0.62));
    leafGradient.addColorStop(1, rgba(color, 0.035 + filament.opacity * 0.86));
    context.fillStyle = leafGradient;
    context.save();
    const glowStrength = Math.max(0, (filament.activity - 0.68) / 0.32) + filament.wiggle;
    context.shadowColor = rgba(color, Math.min(0.8, glowStrength * 0.72));
    context.shadowBlur = glowStrength > 0.08
        ? Math.min(22, glowStrength * 16 * ribbonScale)
        : 0;
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
    context.restore();

    if (filament.emphasis > 0.04) {
        context.fillStyle = rgba(color, filament.emphasis * 0.42);
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

    for (const ring of scene.rings) {
        context.strokeStyle = rgba(palette.low, ring.opacity * 0.72);
        context.lineWidth = Math.max(2, (2 + ring.weight * 2.5) * settings.ribbonWidth);
        context.beginPath();
        context.ellipse(
            centerX,
            centerY,
            ring.radius * scale * (1 + scene.core.stereoWidth * 0.08),
            ring.radius * scale * ring.eccentricity,
            ring.rotation,
            0,
            Math.PI * 2,
        );
        context.stroke();
    }

    for (const filament of scene.filaments) {
        drawRadialRibbon(
            context,
            filament,
            centerX,
            centerY,
            scale,
            palette,
            settings.ribbonWidth,
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
        const radius = scene.core.radius * scale;
        const auraRadius = Math.max(radius * 4.5, Math.min(width, height) * 0.16);
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
            tier: 'low' as const,
        })),
        ...scene.filaments.map((filament) => ({
            harmonicIndex: filament.harmonicIndex,
            opacity: filament.opacity,
            weight: filament.weight,
            bend: filament.bend,
            activity: filament.activity,
            wiggle: filament.wiggle,
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
        const harmonicNumber = item.harmonicIndex + 1;
        const isCenter = harmonicNumber <= scene.centerCutHarmonic;
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
        leafGradient.addColorStop(0, rgba(color, 0.018 + item.opacity * 0.16));
        leafGradient.addColorStop(0.58, rgba(color, 0.025 + item.opacity * 0.58));
        leafGradient.addColorStop(1, rgba(color, 0.035 + item.opacity * 0.82));
        context.fillStyle = leafGradient;
        context.save();
        const glowStrength = Math.max(0, (item.activity - 0.68) / 0.32) + item.wiggle;
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

export type ToroidMeridianGeometry = {
    start: readonly [number, number];
    control: readonly [number, number];
    end: readonly [number, number];
    depth: number;
    pulse: number;
};

export function buildToroidMeridian({
    centerX,
    centerY,
    innerRadius,
    outerRadius,
    verticalScale,
    harmonicIndex,
    harmonicCount,
    timeSeconds,
    activity,
    wiggle,
}: {
    centerX: number;
    centerY: number;
    innerRadius: number;
    outerRadius: number;
    verticalScale: number;
    harmonicIndex: number;
    harmonicCount: number;
    timeSeconds: number;
    activity: number;
    wiggle: number;
}): ToroidMeridianGeometry {
    const angle = -Math.PI / 2
        + (harmonicIndex / Math.max(1, harmonicCount - 1)) * Math.PI * 2;
    const phase = seededUnit(harmonicIndex, 111) * Math.PI * 2;
    const pulseRate = 0.16 + seededUnit(harmonicIndex, 113) * 0.24;
    const pulse = 0.5 + 0.5 * Math.sin(timeSeconds * Math.PI * 2 * pulseRate + phase);
    const fluctuation = Math.sin(
        timeSeconds * Math.PI * 2 * (0.09 + seededUnit(harmonicIndex, 115) * 0.12)
            + phase * 0.71,
    );
    const tangentX = -Math.sin(angle);
    const tangentY = Math.cos(angle) * verticalScale;
    const activation = Math.max(0, activity) * 0.25 + Math.max(0, wiggle) * 0.75;
    const outerDrift = fluctuation * outerRadius * (0.004 + activation * 0.026);
    const midRadius = innerRadius + (outerRadius - innerRadius) * 0.56;
    const bend = fluctuation * outerRadius * (0.008 + activation * 0.055);
    return {
        start: [
            centerX + Math.cos(angle) * innerRadius,
            centerY + Math.sin(angle) * innerRadius * verticalScale,
        ],
        control: [
            centerX + Math.cos(angle) * midRadius + tangentX * bend,
            centerY + Math.sin(angle) * midRadius * verticalScale + tangentY * bend,
        ],
        end: [
            centerX + Math.cos(angle) * outerRadius + tangentX * outerDrift,
            centerY + Math.sin(angle) * outerRadius * verticalScale + tangentY * outerDrift,
        ],
        depth: 0.5 + Math.sin(angle) * 0.5,
        pulse,
    };
}

function drawToroidField(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    scene: ReactiveCampfireScene,
    palette: Palette,
    settings: ReactiveCampfireSettings,
) {
    const centerX = width * 0.5;
    const centerY = height * 0.49;
    const outerRadius = Math.min(width * 0.43, height * 0.47);
    const innerRadius = outerRadius * 0.27;
    const verticalScale = 0.62;
    const all = [
        ...scene.rings.map((ring) => ({
            harmonicIndex: ring.harmonicIndex,
            opacity: ring.opacity,
            weight: ring.weight,
            activity: Math.min(1, ring.opacity / 0.72),
            wiggle: 0,
            tier: 'low' as const,
        })),
        ...scene.filaments.map((filament) => ({
            harmonicIndex: filament.harmonicIndex,
            opacity: filament.opacity,
            weight: filament.weight,
            activity: filament.activity,
            wiggle: filament.wiggle,
            tier: filament.tier,
        })),
    ];
    const harmonicCount = Math.max(2, ...all.map((item) => item.harmonicIndex + 1));
    const lowEnergy = scene.rings.length === 0
        ? 0
        : scene.rings.reduce((sum, ring) => sum + ring.opacity, 0) / scene.rings.length;

    const atmosphere = context.createRadialGradient(
        centerX,
        centerY,
        0,
        centerX,
        centerY,
        outerRadius * 1.35,
    );
    atmosphere.addColorStop(0, rgba(palette.low, 0.07 + lowEnergy * 0.12));
    atmosphere.addColorStop(0.38, 'rgba(13, 34, 62, 0.045)');
    atmosphere.addColorStop(1, 'rgba(2, 7, 22, 0)');
    context.fillStyle = atmosphere;
    context.fillRect(0, 0, width, height);

    // The unenergized torus is barely present: active meridians reveal it.
    context.strokeStyle = rgba(palette.high, 0.035 * scene.confidence);
    context.lineWidth = Math.max(0.8, settings.ribbonWidth * 0.7);
    context.beginPath();
    context.ellipse(centerX, centerY, outerRadius, outerRadius * verticalScale, 0, 0, Math.PI * 2);
    context.stroke();
    context.strokeStyle = rgba(palette.low, 0.05 * scene.confidence);
    context.beginPath();
    context.ellipse(centerX, centerY, innerRadius, innerRadius * verticalScale, 0, 0, Math.PI * 2);
    context.stroke();

    const meridians = all.map((item) => ({
        item,
        geometry: buildToroidMeridian({
            centerX,
            centerY,
            innerRadius,
            outerRadius,
            verticalScale,
            harmonicIndex: item.harmonicIndex,
            harmonicCount,
            timeSeconds: scene.flowTimeSeconds,
            activity: item.activity,
            wiggle: item.wiggle,
        }),
    })).sort((a, b) => a.geometry.depth - b.geometry.depth);

    for (const { item, geometry } of meridians) {
        const color = item.tier === 'low'
            ? palette.low
            : item.tier === 'high' ? palette.high : palette.mid;
        const depthLight = 0.5 + geometry.depth * 0.5;
        const activation = item.opacity * (0.5 + geometry.pulse * 0.5);
        const gradient = context.createLinearGradient(
            geometry.start[0],
            geometry.start[1],
            geometry.end[0],
            geometry.end[1],
        );
        gradient.addColorStop(0, rgba(palette.core, 0.012 + activation * 0.18));
        gradient.addColorStop(0.48, rgba(color, 0.018 + activation * 0.52 * depthLight));
        gradient.addColorStop(1, rgba(color, 0.025 + activation * 0.9 * depthLight));
        context.fillStyle = gradient;
        context.save();
        const glow = Math.max(0, (item.activity - 0.58) / 0.42) + item.wiggle;
        context.shadowColor = rgba(color, Math.min(0.85, glow * 0.7));
        context.shadowBlur = glow > 0.08 ? Math.min(24, glow * 18) : 0;
        const meridianWidth = (0.65 + item.weight * 1.75) * settings.ribbonWidth * depthLight;
        fillClothRibbon(
            context,
            geometry.start,
            geometry.control,
            geometry.end,
            meridianWidth * 0.18,
            meridianWidth,
            item.harmonicIndex,
            scene.flowTimeSeconds,
            item.activity * 0.35,
            item.wiggle * 0.55,
        );
        context.restore();
    }

    const coreRadius = innerRadius * (0.72 + Math.min(0.28, lowEnergy * 0.4));
    const core = context.createRadialGradient(centerX, centerY, 0, centerX, centerY, coreRadius);
    core.addColorStop(0, rgba(palette.core, Math.min(0.95, scene.core.opacity + lowEnergy * 0.65)));
    core.addColorStop(0.28, rgba(palette.low, scene.core.opacity * 0.72 + lowEnergy * 0.28));
    core.addColorStop(1, rgba(palette.mid, 0));
    context.fillStyle = core;
    context.beginPath();
    context.ellipse(centerX, centerY, coreRadius, coreRadius * verticalScale, 0, 0, Math.PI * 2);
    context.fill();
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
    if (settings.visualizationMode === 'horizon-flow') {
        drawHorizonField(context, width, height, scene, palette, settings);
    } else if (settings.visualizationMode === 'toroid-meridians') {
        drawToroidField(context, width, height, scene, palette, settings);
    } else {
        drawRadialField(context, width, height, scene, palette, settings);
    }
    context.restore();
}
