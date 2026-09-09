import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    PUBLIC_CYCLE_SESSION_IDS,
    isPublicCycleSession,
} from '@/lib/public-cycle';

describe('public four-Saturday cycle', () => {
    it('recognizes exactly the four reviewed room ids', () => {
        expect(PUBLIC_CYCLE_SESSION_IDS).toHaveLength(4);
        for (const id of PUBLIC_CYCLE_SESSION_IDS) expect(isPublicCycleSession(id)).toBe(true);
        expect(isPublicCycleSession('10000000-0000-4000-8000-000000000001')).toBe(false);
    });

    it('keeps the final migration contract at the confirmed 16:00 UTC', () => {
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
});
