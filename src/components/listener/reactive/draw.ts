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

/** Draws a closed quadratic band. Energy changes its body, never the camera. */
function fillRibbon(
    context: CanvasRenderingContext2D,
    start: readonly [number, number],
    control: readonly [number, number],
    end: readonly [number, number],
    startWidth: number,
    endWidth: number,
) {
    const dx = end[0] - start[0];
    const dy = end[1] - start[1];
    const length = Math.max(1, Math.hypot(dx, dy));
    const normalX = -dy / length;
    const normalY = dx / length;
    context.beginPath();
    context.moveTo(start[0] + normalX * startWidth, start[1] + normalY * startWidth);
    context.quadraticCurveTo(
        control[0] + normalX * (startWidth + endWidth) * 0.45,
        control[1] + normalY * (startWidth + endWidth) * 0.45,
        end[0] + normalX * endWidth,
        end[1] + normalY * endWidth,
    );
    context.lineTo(end[0] - normalX * endWidth, end[1] - normalY * endWidth);
    context.quadraticCurveTo(
        control[0] - normalX * (startWidth + endWidth) * 0.45,
        control[1] - normalY * (startWidth + endWidth) * 0.45,
        start[0] - normalX * startWidth,
        start[1] - normalY * startWidth,
    );
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
    context.fillStyle = rgba(color, filament.opacity * 0.78);
    fillRibbon(context, start, control, end, width * 0.42, width);

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
            tier: 'low' as const,
        })),
        ...scene.filaments.map((filament) => ({
            harmonicIndex: filament.harmonicIndex,
            opacity: filament.opacity,
            weight: filament.weight,
            bend: filament.bend,
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
        context.fillStyle = rgba(color, item.opacity * 0.7);
        fillRibbon(
            context,
            [startX, startY],
            [controlX, controlY],
            [endX, endY],
            widthScale * 0.24,
            widthScale,
        );
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
    if (settings.visualizationMode === 'horizon-flow') {
        drawHorizonField(context, width, height, scene, palette, settings);
    } else {
        drawRadialField(context, width, height, scene, palette, settings);
    }
    context.restore();
}
