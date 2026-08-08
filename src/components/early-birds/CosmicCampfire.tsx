'use client';

import { useEffect, useRef } from 'react';

import type { ListenerCampfireFixture } from '@/lib/early-birds/campfire-prototype';

import { buildCampfireFrame, type CampfireFrame } from './cosmic-campfire-scene';

type NavigatorWithConnection = Navigator & {
    connection?: { saveData?: boolean };
};

const MAX_DEVICE_PIXEL_RATIO = 1.5;
const FRAME_INTERVAL_MS = 50;

function drawGlow(
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    inner: string,
    outer: string,
) {
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, inner);
    gradient.addColorStop(1, outer);
    context.fillStyle = gradient;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fill();
}

export function drawCampfireFrame(
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    frame: CampfireFrame,
) {
    context.clearRect(0, 0, width, height);
    const scale = Math.min(width, height);
    const fireX = frame.fire.x * width;
    const fireY = frame.fire.y * height;
    const fireRadius = frame.fire.radius * scale * frame.fire.breath;

    context.save();
    context.globalCompositeOperation = 'screen';

    for (const [radius, alpha] of [[0.37, 0.032], [0.25, 0.052], [0.15, 0.075]] as const) {
        context.strokeStyle = `rgba(255, 216, 117, ${alpha})`;
        context.lineWidth = 1;
        context.beginPath();
        context.ellipse(fireX, fireY, radius * width, radius * height * 0.48, 0, 0, Math.PI * 2);
        context.stroke();
    }

    drawGlow(
        context,
        fireX,
        fireY,
        fireRadius * 3.4,
        'rgba(255, 216, 117, 0.24)',
        'rgba(255, 143, 200, 0)',
    );
    drawGlow(
        context,
        fireX,
        fireY,
        fireRadius,
        'rgba(255, 249, 233, 0.92)',
        'rgba(255, 143, 200, 0.04)',
    );

    context.fillStyle = 'rgba(255, 216, 117, 0.44)';
    context.beginPath();
    context.moveTo(fireX, fireY - fireRadius * 1.22);
    context.bezierCurveTo(
        fireX + fireRadius * 0.78,
        fireY - fireRadius * 0.45,
        fireX + fireRadius * 0.58,
        fireY + fireRadius * 0.72,
        fireX,
        fireY + fireRadius,
    );
    context.bezierCurveTo(
        fireX - fireRadius * 0.58,
        fireY + fireRadius * 0.72,
        fireX - fireRadius * 0.72,
        fireY - fireRadius * 0.36,
        fireX,
        fireY - fireRadius * 1.22,
    );
    context.fill();

    for (const ember of frame.embers) {
        context.globalAlpha = ember.alpha;
        drawGlow(
            context,
            ember.x * width,
            ember.y * height,
            ember.radius * scale * 2.5,
            'rgba(255, 216, 117, 0.88)',
            'rgba(255, 143, 200, 0)',
        );
    }
    context.globalAlpha = 1;

    for (const listener of frame.listeners) {
        const color = listener.band === 'near'
            ? 'rgba(255, 216, 117, 0.72)'
            : listener.band === 'middle'
                ? 'rgba(255, 143, 200, 0.54)'
                : 'rgba(124, 234, 255, 0.43)';
        drawGlow(
            context,
            listener.x * width,
            listener.y * height,
            listener.radius * scale * 4.5,
            color,
            'rgba(124, 234, 255, 0)',
        );
        context.fillStyle = color;
        context.beginPath();
        context.arc(
            listener.x * width,
            listener.y * height,
            Math.max(1.5, listener.radius * scale),
            0,
            Math.PI * 2,
        );
        context.fill();
    }

    drawGlow(
        context,
        frame.self.x * width,
        frame.self.y * height,
        frame.self.radius * scale * 5,
        'rgba(124, 234, 255, 0.66)',
        'rgba(124, 234, 255, 0)',
    );
    context.fillStyle = 'rgba(255, 249, 233, 0.84)';
    context.beginPath();
    context.arc(
        frame.self.x * width,
        frame.self.y * height,
        Math.max(1.8, frame.self.radius * scale),
        0,
        Math.PI * 2,
    );
    context.fill();
    context.restore();
}

export default function CosmicCampfire({ fixture }: { fixture: ListenerCampfireFixture }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) return;

        const reducedMotion = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const saveData = Boolean((navigator as NavigatorWithConnection).connection?.saveData);
        const motion = !reducedMotion && !saveData;
        let animationFrame: number | null = null;
        let lastFrameAt = -FRAME_INTERVAL_MS;
        let startAt = performance.now();

        const render = (now: number) => {
            const bounds = canvas.getBoundingClientRect();
            const ratio = Math.min(window.devicePixelRatio || 1, MAX_DEVICE_PIXEL_RATIO);
            const width = Math.max(1, Math.round(bounds.width * ratio));
            const height = Math.max(1, Math.round(bounds.height * ratio));
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }
            drawCampfireFrame(context, width, height, buildCampfireFrame(fixture, now - startAt, motion));
        };

        const tick = (now: number) => {
            if (now - lastFrameAt >= FRAME_INTERVAL_MS) {
                lastFrameAt = now;
                render(now);
            }
            animationFrame = window.requestAnimationFrame(tick);
        };

        const start = () => {
            if (!motion || document.visibilityState === 'hidden' || animationFrame !== null) return;
            startAt = performance.now();
            animationFrame = window.requestAnimationFrame(tick);
        };
        const stop = () => {
            if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
            animationFrame = null;
        };
        const handleVisibility = () => {
            if (document.visibilityState === 'hidden') stop();
            else {
                render(performance.now());
                start();
            }
        };

        const observer = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => render(performance.now()))
            : null;
        observer?.observe(canvas);
        window.addEventListener('resize', handleVisibility, { passive: true });
        document.addEventListener('visibilitychange', handleVisibility);
        render(startAt);
        start();

        return () => {
            stop();
            observer?.disconnect();
            window.removeEventListener('resize', handleVisibility);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [fixture]);

    return (
        <div
            className="listener-campfire"
            data-fixture={fixture}
            data-testid="listener-campfire"
            aria-hidden="true"
        >
            <canvas ref={canvasRef} />
        </div>
    );
}
