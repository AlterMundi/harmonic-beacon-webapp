import { describe, expect, it } from 'vitest';

import { buildClothRibbonPoints, buildToroidMeridian } from '../draw';

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

describe('toroid harmonic meridians', () => {
    const toroid = {
        centerX: 400,
        centerY: 300,
        innerRadius: 70,
        outerRadius: 250,
        verticalScale: 0.62,
        harmonicIndex: 21,
        harmonicCount: 96,
    };

    it('keeps the inner anchor and camera fixed while activation fluctuates outward', () => {
        const quiet = buildToroidMeridian({
            ...toroid,
            timeSeconds: 12,
            activity: 0,
            wiggle: 0,
        });
        const active = buildToroidMeridian({
            ...toroid,
            timeSeconds: 12,
            activity: 1,
            wiggle: 1,
        });

        expect(active.start).toEqual(quiet.start);
        expect(active.depth).toBe(quiet.depth);
        expect(active.end).not.toEqual(quiet.end);
        expect(active.control).not.toEqual(quiet.control);
    });

    it('changes continuously rather than jumping between analysis frames', () => {
        const first = buildToroidMeridian({
            ...toroid,
            timeSeconds: 30,
            activity: 0.8,
            wiggle: 0.7,
        });
        const next = buildToroidMeridian({
            ...toroid,
            timeSeconds: 30.02,
            activity: 0.8,
            wiggle: 0.7,
        });

        expect(Math.hypot(
            next.end[0] - first.end[0],
            next.end[1] - first.end[1],
        )).toBeLessThan(2);
        expect(Math.abs(next.pulse - first.pulse)).toBeLessThan(0.1);
    });
});
