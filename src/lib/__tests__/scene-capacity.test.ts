import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    DEFAULT_SCENE_CAPACITY,
    SCENE_CAPACITIES,
    isSceneCapacity,
    parseSceneCapacity,
} from '../scene-capacity';

describe('scene capacity contract', () => {
    it('supports only 6, 9, and 12 with twelve as the default for new sessions', () => {
        expect(SCENE_CAPACITIES).toEqual([6, 9, 12]);
        expect(DEFAULT_SCENE_CAPACITY).toBe(12);
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

    it('changes only the future database default to twelve and preserves existing rows', () => {
        const schema = readFileSync(
            new URL('../../../prisma/schema.prisma', import.meta.url),
            'utf8',
        );
        const migrationUrl = new URL(
            '../../../prisma/migrations/20260917211500_default_scene_capacity_12/migration.sql',
            import.meta.url,
        );

        expect(schema).toContain('maxPublishers Int                    @default(12) @map("scene_capacity")');
        expect(existsSync(migrationUrl)).toBe(true);
        if (!existsSync(migrationUrl)) return;

        const migration = readFileSync(migrationUrl, 'utf8');
        expect(migration).toContain(
            'ALTER COLUMN "scene_capacity" SET DEFAULT 12',
        );
        expect(migration).not.toMatch(/\b(?:UPDATE|DELETE|DROP COLUMN)\b/i);
        expect(migration).not.toContain('"max_publishers"');
    });
});
