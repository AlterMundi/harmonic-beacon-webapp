'use client';

import { useCallback, useEffect, useRef } from 'react';

import type { HarmonicAnalysisFrame } from '@/lib/listener/analysis/types';

import { drawMinimalReactivePulse, drawReactiveCampfire } from './draw';
import {
    advanceReactiveFrame,
    createReactiveFrameState,
    recordReactiveFrame,
} from './frame-state';
import styles from './ReactiveCampfire.module.css';
import { resolveReactiveRenderPolicy } from './render-policy';
import {
    buildReactiveCampfireScene,
    type ReactiveTrailHistory,
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

export function ReactiveCampfireCanvas({
    frame = null,
    subscribeFrames,
    mode,
    settings: candidateSettings = DEFAULT_REACTIVE_CAMPFIRE_SETTINGS,
    className,
    onRendererError,
}: ReactiveCampfireCanvasProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const modeRef = useRef(mode);
    const settingsRef = useRef(validateReactiveCampfireSettings(candidateSettings));
    const frameStateRef = useRef(createReactiveFrameState());
    const stoppedAtRef = useRef<number | null>(null);
    const wakeRef = useRef<(() => void) | null>(null);
    const onRendererErrorRef = useRef(onRendererError);

    useEffect(() => {
        onRendererErrorRef.current = onRendererError;
    }, [onRendererError]);

    const recordFrame = useCallback((nextFrame: HarmonicAnalysisFrame | null) => {
        if (settingsRef.current.visualizationMode === 'minimal-pulse') {
            frameStateRef.current.currentFrame = nextFrame;
            wakeRef.current?.();
            return;
        }
        recordReactiveFrame(frameStateRef.current, nextFrame, settingsRef.current);
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
        if (!context) {
            onRendererErrorRef.current?.(new Error('Canvas 2D context unavailable'));
            return;
        }

        const reducedMotion = typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const saveData = Boolean((navigator as NavigatorWithConnection).connection?.saveData);
        const policy = resolveReactiveRenderPolicy({ reducedMotion, saveData });
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
            if (settingsRef.current.visualizationMode === 'minimal-pulse') {
                drawMinimalReactivePulse(
                    context,
                    width,
                    height,
                    frameStateRef.current.currentFrame,
                    settingsRef.current,
                    decay,
                );
                return;
            }
            const intervalMs = policy.frameIntervalMs;
            const renderingFrame = advanceReactiveFrame(
                frameStateRef.current,
                now,
                intervalMs,
                settingsRef.current,
            );
            const scene = buildReactiveCampfireScene(
                renderingFrame,
                settingsRef.current,
                frameStateRef.current.history as ReactiveTrailHistory,
                decay,
                frameStateRef.current.lastActivatedAtMs,
            );
            drawReactiveCampfire(context, width, height, scene, settingsRef.current);
        };

        const tick = (now: number) => {
            animationFrame = null;
            if (document.visibilityState === 'hidden' || rendererFailed) return;
            const intervalMs = settingsRef.current.visualizationMode === 'minimal-pulse'
                ? 500
                : policy.frameIntervalMs;
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
