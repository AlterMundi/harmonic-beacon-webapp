import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    PUBLIC_FREE_SESSION_IDS,
    isPublicFreeSession,
} from '@/lib/public-cycle';

describe('public complimentary sessions', () => {
    it('recognizes the reviewed free room ids', () => {
        expect(PUBLIC_FREE_SESSION_IDS).toHaveLength(6);
        for (const id of PUBLIC_FREE_SESSION_IDS) expect(isPublicFreeSession(id)).toBe(true);
        expect(isPublicFreeSession('10000000-0000-4000-8000-000000000001')).toBe(false);
    });

    it('preserves the historical four-session correction at 16:00 UTC', () => {
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260821194000_correct_four_saturday_cycle_start/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );

        for (const date of ['2026-08-22', '2026-08-29', '2026-09-05', '2026-09-12']) {
            expect(migration).toContain(`'${date} 16:00:00'::timestamp`);
        }
        expect(migration).toContain('initialized_count = 0 AND corrected_count <> 0');
        expect(migration).toContain('initialized_count > 0 AND corrected_count <> 4');
        expect(migration).not.toContain('14:00:00');
    });

    it('moves only the two remaining sessions to 14:00 Argentina / 17:00 UTC', () => {
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260901180000_move_remaining_umbral_sessions_to_1400_argentina/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );

        expect(migration).toContain("'2026-09-05 17:00:00'::timestamp");
        expect(migration).toContain("'2026-09-12 17:00:00'::timestamp");
        expect(migration).not.toContain('2026-08-22 17:00:00');
        expect(migration).not.toContain('2026-08-29 17:00:00');
        expect(migration).toContain('corrected_count <> 2');
        expect(migration).toMatch(/BEGIN;[\s\S]*UPDATE[\s\S]*RAISE EXCEPTION[\s\S]*COMMIT;/);
    });

    it('moves only the final Umbral session to 10:00 Argentina / 13:00 UTC', () => {
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260908130000_move_final_umbral_to_1000_argentina/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );

        expect(migration).toContain('50000000-0000-4000-8000-202609120001');
        expect(migration).toContain("'2026-09-12 13:00:00'::timestamp");
        expect(migration).toContain('corrected_count <> 1');
        expect(migration).toContain('initialized_count = 0 AND corrected_count <> 0');
        expect(migration).not.toContain('202609050001');
        expect(migration).not.toContain("'2026-09-12 17:00:00'::timestamp");
    });

    it('creates an isolated non-public rehearsal for September 9 at 15:00 Argentina', () => {
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260908233000_create_sep9_internal_rehearsal/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );

        expect(migration).toContain('60000000-0000-4000-8000-202609090001');
        expect(migration).toContain('rehearsal-2026-09-09-1500-art');
        expect(migration).toContain("'2026-09-09 18:00:00'::timestamp");
        expect(migration).toContain('true,\n    true,\n    false,');
        expect(migration).toContain('ON CONFLICT ("id") DO NOTHING');
        expect(migration).toContain('related_count <> 0');
        expect(migration).toContain('50000000-0000-4000-8000-202609120001');
        expect(migration).not.toContain('INSERT INTO "ticket_entitlements"');
        expect(migration).not.toContain('INSERT INTO "session_participants"');
    });

    it('creates two isolated public Proyecciones Mito sessions for September 23', () => {
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260923120000_create_sep23_proyecciones_mito/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );

        for (const [id, room, scheduledAt] of [
            ['50000000-0000-4000-8000-202609230001', 'proyecciones-mito-2026-09-23-1000-art', '2026-09-23 13:00:00'],
            ['50000000-0000-4000-8000-202609230002', 'proyecciones-mito-2026-09-23-1800-art', '2026-09-23 21:00:00'],
        ]) {
            expect(migration).toContain(id);
            expect(migration).toContain(room);
            expect(migration).toContain(`'${scheduledAt}'::timestamp`);
        }
        expect(migration).toContain('false,\n    true,\n    true,');
        expect(migration).toContain('ON CONFLICT ("id") DO NOTHING');
        expect(migration).toContain('related_count <> 0');
        expect(migration).not.toContain('INSERT INTO "ticket_entitlements"');
        expect(migration).not.toContain('INSERT INTO "session_participants"');
    });
});
