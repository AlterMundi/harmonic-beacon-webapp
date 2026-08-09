import { describe, expect, it, vi } from 'vitest';

import type { HarmonicAnalysisFrame } from '@/lib/listener/analysis/types';

import { buildClothRibbonPoints, drawMinimalReactivePulse } from '../draw';
import { DEFAULT_REACTIVE_CAMPFIRE_SETTINGS } from '../settings';

const geometry = {
    start: [10, 20] as const,
    control: [60, 5] as const,
    end: [110, 80] as const,
    startWidth: 2,
    endWidth: 8,
    harmonicIndex: 23,
};

describe('reactive cloth ribbons', () => {
    it('pins the inner edge while the free edge dances continuously', () => {
        const first = buildClothRibbonPoints({
            ...geometry,
            timeSeconds: 10,
            activity: 0.7,
            wiggle: 0.4,
        });
        const next = buildClothRibbonPoints({
            ...geometry,
            timeSeconds: 10.02,
            activity: 0.7,
            wiggle: 0.4,
        });

        expect(first[0]).toMatchObject({ centerX: 10, centerY: 20 });
        expect(first[0].halfWidth).toBeGreaterThan(0);
        expect(next[0]).toEqual(first[0]);
        expect(next.at(-1)).not.toEqual(first.at(-1));
        expect(Math.hypot(
            next.at(-1)!.centerX - first.at(-1)!.centerX,
            next.at(-1)!.centerY - first.at(-1)!.centerY,
        )).toBeLessThan(2);
    });

    it('keeps a gentle ambient drift and amplifies it for an active harmonic', () => {
        const quiet = buildClothRibbonPoints({
            ...geometry,
            timeSeconds: 17,
            activity: 0,
            wiggle: 0,
        });
        const active = buildClothRibbonPoints({
            ...geometry,
            timeSeconds: 17,
            activity: 1,
            wiggle: 1,
        });
        const baseEnd = geometry.end;
        const quietDistance = Math.hypot(
            quiet.at(-1)!.centerX - baseEnd[0],
            quiet.at(-1)!.centerY - baseEnd[1],
        );
        const activeDistance = Math.hypot(
            active.at(-1)!.centerX - baseEnd[0],
            active.at(-1)!.centerY - baseEnd[1],
        );

        expect(quietDistance).toBeGreaterThan(0);
        expect(activeDistance).toBeGreaterThan(quietDistance * 3);
    });
});

describe('minimal reactive pulse', () => {
    it('draws one fixed measured-level halo without harmonic scene geometry', () => {
        const gradient = { addColorStop: vi.fn() };
        const context = {
            clearRect: vi.fn(),
            createRadialGradient: vi.fn(() => gradient),
            fillRect: vi.fn(),
            fillStyle: '',
        } as unknown as CanvasRenderingContext2D;
        const frame = {
            overallDb: -24,
            confidence: 1,
        } as HarmonicAnalysisFrame;

        drawMinimalReactivePulse(
            context,
            400,
            300,
            frame,
            { ...DEFAULT_REACTIVE_CAMPFIRE_SETTINGS, zoomPercent: 100 },
        );

        expect(context.clearRect).toHaveBeenCalledWith(0, 0, 400, 300);
        expect(context.createRadialGradient).toHaveBeenCalledWith(
            200,
            144,
            0,
            200,
            144,
            expect.any(Number),
        );
        expect(gradient.addColorStop).toHaveBeenCalledTimes(3);
        expect(context.fillRect).toHaveBeenCalledOnce();
    });
});
