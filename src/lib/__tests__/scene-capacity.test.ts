import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_SCENE_CAPACITY,
    SCENE_CAPACITIES,
    isSceneCapacity,
    parseSceneCapacity,
} from '../scene-capacity';

describe('scene capacity contract', () => {
    it('supports only 6, 9, and 12 with six as the compatibility default', () => {
        expect(SCENE_CAPACITIES).toEqual([6, 9, 12]);
        expect(DEFAULT_SCENE_CAPACITY).toBe(6);
        for (const value of [6, 9, 12]) expect(isSceneCapacity(value)).toBe(true);
        for (const value of [0, 5, 7, 10, 13, '12', null]) {
            expect(isSceneCapacity(value)).toBe(false);
        }
    });

    it('fails closed instead of trusting arbitrary persisted or JSON capacity values', () => {
        expect(parseSceneCapacity(9)).toBe(9);
        expect(() => parseSceneCapacity(10)).toThrow(/6, 9, or 12/);
        expect(() => parseSceneCapacity('12')).toThrow(/6, 9, or 12/);
    });

    it('adds an independent constrained scene_capacity column without touching the legacy fixed-six column', () => {
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260916010000_configurable_scene_capacity/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );

        expect(migration).toContain('ADD COLUMN "scene_capacity" INTEGER NOT NULL DEFAULT 6');
        expect(migration).toContain('CHECK ("scene_capacity" IN (6, 9, 12))');
        expect(migration).not.toMatch(/\b(?:COMMENT|DROP|UPDATE|DELETE)\b/i);
        expect(migration).not.toContain('"max_publishers"');
    });
});
