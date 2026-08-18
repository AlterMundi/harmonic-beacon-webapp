import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    PUBLIC_CYCLE_SESSION_IDS,
    isPublicCycleSession,
} from '@/lib/public-cycle';

describe('public four-Saturday cycle', () => {
    it('recognizes exactly the four published room ids', () => {
        expect(PUBLIC_CYCLE_SESSION_IDS).toHaveLength(4);
        for (const id of PUBLIC_CYCLE_SESSION_IDS) {
            expect(isPublicCycleSession(id)).toBe(true);
        }
        expect(isPublicCycleSession('10000000-0000-4000-8000-000000000001')).toBe(false);
    });

    it('creates four new Saturday rooms at the advertised 14:00 UTC', () => {
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260818030000_four_saturday_public_cycle/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );

        for (const date of ['2026-08-22', '2026-08-29', '2026-09-05', '2026-09-12']) {
            expect(migration).toContain(`'${date} 14:00:00'::timestamp`);
        }
        expect(migration).toContain("'SCHEDULED'::\"ScheduledSessionStatus\"");
        expect(migration).toContain('FROM "users"');
        expect(migration).toContain("'FACILITATOR'::\"StaffRole\"");
        expect(migration).toContain('target_count <> source_count * 4');
        expect(migration).not.toMatch(/UPDATE\s+"scheduled_sessions"/i);
    });
});
