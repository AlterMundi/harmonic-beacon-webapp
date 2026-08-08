import { describe, expect, it } from 'vitest';

import { buildCampfireFrame, CAMPFIRE_FIXTURE_LISTENERS } from '../cosmic-campfire-scene';

describe('cosmic campfire deterministic fixtures', () => {
    it('keeps presence fixtures cumulative, bounded and anonymous', () => {
        expect(Object.fromEntries(Object.entries(CAMPFIRE_FIXTURE_LISTENERS).map(
            ([fixture, listeners]) => [
                fixture,
                listeners.map(({ id, band }) => `${id}:${band}`),
            ],
        ))).toMatchInlineSnapshot(`
          {
            "empty": [],
            "far": [
              "near-west:near",
              "near-east:near",
              "middle-west:middle",
              "middle-east:middle",
              "middle-north:middle",
              "far-west:far",
              "far-east:far",
              "far-north-west:far",
              "far-north-east:far",
            ],
            "middle": [
              "near-west:near",
              "near-east:near",
              "middle-west:middle",
              "middle-east:middle",
              "middle-north:middle",
            ],
            "near": [
              "near-west:near",
              "near-east:near",
            ],
          }
        `);

        for (const listeners of Object.values(CAMPFIRE_FIXTURE_LISTENERS)) {
            for (const listener of listeners) {
                expect(listener.x).toBeGreaterThanOrEqual(0);
                expect(listener.x).toBeLessThanOrEqual(1);
                expect(listener.y).toBeGreaterThanOrEqual(0);
                expect(listener.y).toBeLessThanOrEqual(1);
                expect(listener).not.toHaveProperty('name');
                expect(listener).not.toHaveProperty('location');
            }
        }
    });

    it('renders a stable static frame for reduced-motion and Save-Data paths', () => {
        const first = buildCampfireFrame('far', 0, false);
        const later = buildCampfireFrame('far', 600_000, false);
        const signature = [
            `fire:${Object.values(first.fire).join(',')}`,
            `self:${Object.values(first.self).join(',')}`,
            `listeners:${first.listeners.map(({ id, band, x, y, radius }) => (
                [id, band, x, y, radius].join(',')
            )).join('|')}`,
            `embers:${first.embers.map(({ x, y, radius, alpha }) => (
                [x.toFixed(3), y.toFixed(3), radius, alpha].join(',')
            )).join('|')}`,
        ];

        expect(later).toEqual(first);
        expect(signature).toMatchInlineSnapshot(`
          [
            "fire:0.5,0.55,0.074,1",
            "self:0.5,0.87,0.0075",
            "listeners:near-west,near,0.42,0.64,0.007|near-east,near,0.58,0.63,0.007|middle-west,middle,0.29,0.7,0.0055|middle-east,middle,0.72,0.69,0.0055|middle-north,middle,0.52,0.37,0.0055|far-west,far,0.12,0.54,0.0045|far-east,far,0.88,0.49,0.0045|far-north-west,far,0.25,0.24,0.0045|far-north-east,far,0.78,0.23,0.0045",
            "embers:0.482,0.494,0.006,0.48|0.522,0.467,0.004,0.48|0.464,0.438,0.003,0.48|0.509,0.405,0.0035,0.48",
          ]
        `);
    });

    it('keeps every fixture point in bounds across the review viewports', () => {
        const viewports = [
            { width: 320, height: 720 },
            { width: 390, height: 844 },
            { width: 768, height: 1024 },
            { width: 1024, height: 768 },
            { width: 1440, height: 900 },
        ];

        for (const fixture of ['empty', 'near', 'middle', 'far'] as const) {
            const frame = buildCampfireFrame(fixture, 0, false);
            for (const viewport of viewports) {
                for (const point of [frame.fire, frame.self, ...frame.listeners, ...frame.embers]) {
                    expect(point.x * viewport.width).toBeGreaterThanOrEqual(0);
                    expect(point.x * viewport.width).toBeLessThanOrEqual(viewport.width);
                    expect(point.y * viewport.height).toBeGreaterThanOrEqual(0);
                    expect(point.y * viewport.height).toBeLessThanOrEqual(viewport.height);
                }
            }
        }
    });
});
