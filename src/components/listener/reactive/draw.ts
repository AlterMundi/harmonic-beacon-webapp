import type { ReactivePalette } from './settings';
import type { ReactiveCampfireScene, ReactiveFilament } from './scene';

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

function drawFilament(
    context: CanvasRenderingContext2D,
    filament: ReactiveFilament,
    centerX: number,
    centerY: number,
    scale: number,
    palette: Palette,
) {
    const color = filament.tier === 'high' ? palette.high : palette.mid;
    const [startX, startY] = endpoint(
        centerX,
        centerY,
        scale,
        filament.innerRadius,
        filament.angle - filament.bend * 0.35,
    );
    const [endX, endY] = endpoint(
        centerX,
        centerY,
        scale,
        filament.outerRadius,
        filament.angle,
    );
    const [controlX, controlY] = endpoint(
        centerX,
        centerY,
        scale,
        (filament.innerRadius + filament.outerRadius) * 0.54,
        filament.angle + filament.bend,
    );

    if (filament.trail.length > 1) {
        context.strokeStyle = rgba(color, Math.max(...filament.trail.map((point) => point.opacity)));
        context.lineWidth = Math.max(0.35, filament.weight * 0.58);
        context.beginPath();
        filament.trail.forEach((point, index) => {
            const [x, y] = endpoint(centerX, centerY, scale, point.radius, point.angle);
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        });
        context.stroke();
    }

    context.strokeStyle = rgba(color, filament.opacity);
    context.lineWidth = filament.weight;
    context.beginPath();
    context.moveTo(startX, startY);
    context.quadraticCurveTo(controlX, controlY, endX, endY);
    context.stroke();

    if (filament.emphasis > 0.04) {
        context.fillStyle = rgba(color, filament.emphasis * 0.55);
        context.beginPath();
        context.arc(endX, endY, 0.8 + filament.emphasis * 2.2, 0, Math.PI * 2);
        context.fill();
    }
}

export function drawReactiveCampfire(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    scene: ReactiveCampfireScene,
    paletteName: ReactivePalette,
) {
    context.clearRect(0, 0, width, height);
    if (scene.confidence <= 0) return;

    const palette = PALETTES[paletteName];
    const scale = Math.min(width, height) * 0.72;
    const centerX = width * (0.5 + scene.core.stereoOffset);
    const centerY = height * 0.48;

    context.save();
    context.globalCompositeOperation = 'screen';
    context.lineCap = 'round';

    for (const ring of scene.rings) {
        context.strokeStyle = rgba(palette.low, ring.opacity);
        context.lineWidth = ring.weight;
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
        drawFilament(context, filament, centerX, centerY, scale, palette);
    }

    for (const veil of scene.veils) {
        context.strokeStyle = rgba(palette.high, veil.opacity);
        context.lineWidth = veil.weight;
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
    context.restore();
}
