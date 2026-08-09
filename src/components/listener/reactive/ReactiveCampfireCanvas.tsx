'use client';

import { useCallback, useEffect, useRef } from 'react';

import type { HarmonicAnalysisFrame } from '@/lib/listener/analysis/types';

import { drawReactiveCampfire } from './draw';
import styles from './ReactiveCampfire.module.css';
import { resolveReactiveRenderPolicy } from './render-policy';
import {
    buildReactiveCampfireScene,
    type HarmonicTrailSample,
    type ReactiveTrailHistory,
    selectHarmonicIndexes,
    smoothVisualDb,
} from './scene';
import {
    DEFAULT_REACTIVE_CAMPFIRE_SETTINGS,
    type ReactiveCampfireSettings,
    validateReactiveCampfireSettings,
} from './settings';

type NavigatorWithConnection = Navigator & {
    connection?: { saveData?: boolean };
};

export type ReactiveCampfireMode = 'active' | 'stopped';

export type ReactiveCampfireCanvasProps = {
    frame?: HarmonicAnalysisFrame | null;
    subscribeFrames?: (
        listener: (frame: HarmonicAnalysisFrame | null) => void,
    ) => (() => void);
    mode: ReactiveCampfireMode;
    settings?: Partial<ReactiveCampfireSettings>;
    className?: string;
    onRendererError?: (error: unknown) => void;
};

const STOP_DECAY_MS = 1_200;
const MAX_TRAIL_SAMPLES = 120;

function smoothFrame(
    previous: HarmonicAnalysisFrame | null,
    target: HarmonicAnalysisFrame | null,
    elapsedMs: number,
    settings: ReactiveCampfireSettings,
): HarmonicAnalysisFrame | null {
    if (!target) return null;
    if (!previous || previous.harmonicAbsoluteDb.length !== target.harmonicAbsoluteDb.length) {
        return target;
    }
    const absolute = new Float32Array(target.harmonicAbsoluteDb.length);
    const delta = new Float32Array(target.harmonicDeltaDb.length);
    for (let index = 0; index < absolute.length; index += 1) {
        absolute[index] = smoothVisualDb(
            previous.harmonicAbsoluteDb[index],
            target.harmonicAbsoluteDb[index],
            elapsedMs,
            settings.attackMs,
            settings.releaseMs,
        );
    }
    for (let index = 0; index < delta.length; index += 1) {
        delta[index] = smoothVisualDb(
            previous.harmonicDeltaDb[index],
            target.harmonicDeltaDb[index],
            elapsedMs,
            settings.attackMs,
            settings.releaseMs,
        );
    }
    return {
        ...target,
        overallDb: smoothVisualDb(
            previous.overallDb,
            target.overallDb,
            elapsedMs,
            settings.attackMs,
            settings.releaseMs,
        ),
        harmonicAbsoluteDb: absolute,
        harmonicDeltaDb: delta,
    };
}

function appendFrameToHistory(
    history: Map<number, HarmonicTrailSample[]>,
    frame: HarmonicAnalysisFrame,
    maxAgeMs: number,
    settings: ReactiveCampfireSettings,
) {
    const indexes = selectHarmonicIndexes(
        frame.harmonicAbsoluteDb.length,
        settings.density,
        settings.highDetail,
    );
    const retained = new Set(indexes);
    for (const existing of history.keys()) {
        if (!retained.has(existing)) history.delete(existing);
    }
    for (const index of indexes) {
        if (index < 38) continue;
        const samples = history.get(index) ?? [];
        samples.push({
            capturedAtMs: frame.capturedAtMs,
            absoluteDb: frame.harmonicAbsoluteDb[index],
            deltaDb: frame.harmonicDeltaDb[index] ?? 0,
        });
        const earliest = frame.capturedAtMs - maxAgeMs;
        while (samples.length > MAX_TRAIL_SAMPLES || samples[0]?.capturedAtMs < earliest) {
            samples.shift();
        }
        history.set(index, samples);
    }
}

export function ReactiveCampfireCanvas({
    frame = null,
    subscribeFrames,
    mode,
    settings: candidateSettings = DEFAULT_REACTIVE_CAMPFIRE_SETTINGS,
    className,
    onRendererError,
}: ReactiveCampfireCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef = useRef(frame);
    const modeRef = useRef(mode);
    const settingsRef = useRef(validateReactiveCampfireSettings(candidateSettings));
    const historyRef = useRef<Map<number, HarmonicTrailSample[]>>(new Map());
    const smoothedFrameRef = useRef<HarmonicAnalysisFrame | null>(null);
    const lastSmoothAtRef = useRef<number | null>(null);
    const previousCaptureRef = useRef<number | null>(null);
    const stoppedAtRef = useRef<number | null>(null);
    const wakeRef = useRef<(() => void) | null>(null);
    const onRendererErrorRef = useRef(onRendererError);

    useEffect(() => {
        onRendererErrorRef.current = onRendererError;
    }, [onRendererError]);

    const recordFrame = useCallback((nextFrame: HarmonicAnalysisFrame | null) => {
        frameRef.current = nextFrame;
        if (nextFrame && nextFrame.capturedAtMs !== previousCaptureRef.current) {
            previousCaptureRef.current = nextFrame.capturedAtMs;
            appendFrameToHistory(
                historyRef.current,
                nextFrame,
                Math.max(4_000, settingsRef.current.trailSeconds * 1_000),
                settingsRef.current,
            );
        }
        wakeRef.current?.();
    }, []);

    useEffect(() => {
        if (!subscribeFrames) recordFrame(frame);
    }, [frame, recordFrame, subscribeFrames]);

    useEffect(() => {
        if (!subscribeFrames) return;
        return subscribeFrames(recordFrame);
    }, [recordFrame, subscribeFrames]);

    useEffect(() => {
        settingsRef.current = validateReactiveCampfireSettings(candidateSettings);
        wakeRef.current?.();
    }, [candidateSettings]);

    useEffect(() => {
        if (modeRef.current !== mode) {
            stoppedAtRef.current = mode === 'stopped' ? performance.now() : null;
        }
        modeRef.current = mode;
        wakeRef.current?.();
    }, [mode]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        let context: CanvasRenderingContext2D | null = null;
        try {
            context = canvas.getContext('2d');
        } catch (error) {
            onRendererErrorRef.current?.(error);
            return;
        }
        if (!context) return;

        const reducedMotion = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const saveData = Boolean((navigator as NavigatorWithConnection).connection?.saveData);
        const policy = resolveReactiveRenderPolicy({ reducedMotion, saveData });
        const intervalMs = policy.frameIntervalMs;
        if (modeRef.current === 'stopped') stoppedAtRef.current = performance.now();
        let animationFrame: number | null = null;
        let lastPaintAt = Number.NEGATIVE_INFINITY;
        let rendererFailed = false;

        const paint = (now: number) => {
            const bounds = canvas.getBoundingClientRect();
            const ratio = Math.min(window.devicePixelRatio || 1, policy.maxDevicePixelRatio);
            const width = Math.max(1, Math.round(bounds.width * ratio));
            const height = Math.max(1, Math.round(bounds.height * ratio));
            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }

            const stoppedFor = stoppedAtRef.current === null ? 0 : now - stoppedAtRef.current;
            const decay = modeRef.current === 'active'
                ? 1
                : Math.max(0, 1 - stoppedFor / STOP_DECAY_MS);
            const elapsedSinceSmooth = lastSmoothAtRef.current === null
                ? intervalMs
                : Math.max(0, now - lastSmoothAtRef.current);
            smoothedFrameRef.current = smoothFrame(
                smoothedFrameRef.current,
                frameRef.current,
                elapsedSinceSmooth,
                settingsRef.current,
            );
            lastSmoothAtRef.current = now;
            const scene = buildReactiveCampfireScene(
                smoothedFrameRef.current,
                settingsRef.current,
                historyRef.current as ReactiveTrailHistory,
                decay,
            );
            drawReactiveCampfire(context, width, height, scene, settingsRef.current.palette);
        };

        const tick = (now: number) => {
            animationFrame = null;
            if (document.visibilityState === 'hidden' || rendererFailed) return;
            if (now - lastPaintAt >= intervalMs) {
                lastPaintAt = now;
                try {
                    paint(now);
                } catch (error) {
                    rendererFailed = true;
                    try {
                        context.clearRect(0, 0, canvas.width, canvas.height);
                    } catch {
                        // The visual layer is decorative; audio remains outside this component.
                    }
                    onRendererErrorRef.current?.(error);
                    return;
                }
            }

            const stoppedFor = stoppedAtRef.current === null ? 0 : now - stoppedAtRef.current;
            if (modeRef.current === 'active' || stoppedFor < STOP_DECAY_MS) {
                animationFrame = window.requestAnimationFrame(tick);
            }
        };

        const wake = () => {
            if (rendererFailed || document.visibilityState === 'hidden' || animationFrame !== null) return;
            animationFrame = window.requestAnimationFrame(tick);
        };
        wakeRef.current = wake;

        const handleVisibility = () => {
            if (document.visibilityState === 'hidden') {
                if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
                animationFrame = null;
                return;
            }
            lastPaintAt = Number.NEGATIVE_INFINITY;
            wake();
        };
        const observer = typeof ResizeObserver === 'function'
            ? new ResizeObserver(() => {
                lastPaintAt = Number.NEGATIVE_INFINITY;
                wake();
            })
            : null;
        observer?.observe(canvas);
        window.addEventListener('resize', wake, { passive: true });
        document.addEventListener('visibilitychange', handleVisibility);
        wake();

        return () => {
            wakeRef.current = null;
            if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
            observer?.disconnect();
            window.removeEventListener('resize', wake);
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, []);

    return (
        <div className={`${styles.viewport}${className ? ` ${className}` : ''}`}>
            <canvas
                ref={canvasRef}
                className={styles.canvas}
                aria-hidden="true"
                data-testid="reactive-campfire-canvas"
            />
        </div>
    );
}
