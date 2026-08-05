import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    WEEKEND_ATTENDEE_CAP,
    WEEKEND_MAX_PUBLISHERS,
    loadSeedContract,
} from '../../../prisma/seed-contract';

function digestFor(seed: number): string {
    return `scrypt$${Buffer.alloc(16, seed).toString('base64url')}$${Buffer.alloc(32, seed + 10).toString('base64url')}`;
}

function validEnvironment(): NodeJS.ProcessEnv {
    return {
        NODE_ENV: 'test',
        SESSION_COOKIE_TTL_SECONDS: '604800',
        STAFF_FACILITATOR_NAME: 'Facilitator',
        STAFF_FACILITATOR_EMAIL: 'FACILITATOR@example.invalid',
        STAFF_FACILITATOR_PASSWORD_DIGEST: digestFor(1),
        STAFF_OPERATOR_ONE_NAME: 'Operator One',
        STAFF_OPERATOR_ONE_EMAIL: 'operator-one@example.invalid',
        STAFF_OPERATOR_ONE_PASSWORD_DIGEST: digestFor(2),
        STAFF_OPERATOR_TWO_NAME: 'Operator Two',
        STAFF_OPERATOR_TWO_EMAIL: 'operator-two@example.invalid',
        STAFF_OPERATOR_TWO_PASSWORD_DIGEST: digestFor(3),
        STAFF_ADMIN_NAME: 'Admin',
        STAFF_ADMIN_EMAIL: 'admin@example.invalid',
        STAFF_ADMIN_PASSWORD_DIGEST: digestFor(4),
        WEEKEND_SESSION_1_EVENT_JSON: JSON.stringify({
            id: '10000000-0000-4000-8000-000000000001',
            title: 'Saturday',
            roomName: 'saturday',
            scheduledAt: '2026-08-08T18:00:00.000Z',
            maxPublishers: 999,
        }),
        WEEKEND_SESSION_2_EVENT_JSON: JSON.stringify({
            id: '10000000-0000-4000-8000-000000000002',
            title: 'Session 2',
            roomName: 'session-2',
            scheduledAt: '2026-08-08T18:00:00.000Z',
        }),
    };
}

describe('weekend seed contract', () => {
    it('defines exactly four staff and the two pinned event languages', () => {
        const contract = loadSeedContract(validEnvironment());

        expect(contract.staff.map(({ role }) => role)).toEqual([
            'FACILITATOR',
            'OPERATOR',
            'OPERATOR',
            'ADMIN',
        ]);
        expect(contract.staff[0].email).toBe('facilitator@example.invalid');
        expect(contract.events.map(({ language }) => language)).toEqual(['SPANISH', 'ENGLISH']);
        expect(WEEKEND_ATTENDEE_CAP).toBe(150);
        expect(WEEKEND_MAX_PUBLISHERS).toBe(6);
        expect(contract.events[0]).not.toHaveProperty('maxPublishers');
    });

    it('allows an explicit composite facilitator role without changing the default', () => {
        const defaultContract = loadSeedContract(validEnvironment());
        const compositeEnvironment = validEnvironment();
        compositeEnvironment.STAFF_FACILITATOR_ROLE = 'FACILITATOR_OP';
        const compositeContract = loadSeedContract(compositeEnvironment);

        expect(defaultContract.staff[0].role).toBe('FACILITATOR');
        expect(compositeContract.staff[0].role).toBe('FACILITATOR_OP');
    });

    it('rejects any unsupported facilitator seed role', () => {
        const env = validEnvironment();
        env.STAFF_FACILITATOR_ROLE = 'ADMIN';

        expect(() => loadSeedContract(env)).toThrow(
            'STAFF_FACILITATOR_ROLE must be FACILITATOR or FACILITATOR_OP',
        );
    });

    it.each([
        'STAFF_FACILITATOR_PASSWORD_DIGEST',
        'STAFF_OPERATOR_ONE_PASSWORD_DIGEST',
        'STAFF_OPERATOR_TWO_PASSWORD_DIGEST',
        'STAFF_ADMIN_PASSWORD_DIGEST',
        'WEEKEND_SESSION_1_EVENT_JSON',
        'WEEKEND_SESSION_2_EVENT_JSON',
    ])('fails closed when %s is missing', (name) => {
        const env = validEnvironment();
        const removedValue = env[name];
        delete env[name];

        expect(() => loadSeedContract(env)).toThrow(name);
        try {
            loadSeedContract(env);
        } catch (error) {
            expect(String(error)).not.toContain(String(removedValue));
        }
    });

    it('pins six publishers in the database migration as well as the seed', () => {
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260728120000_weekend_mvp/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );

        expect(migration).toContain('"max_publishers" INTEGER NOT NULL DEFAULT 6');
        expect(migration).toContain('CHECK ("max_publishers" = 6)');
    });

    it('ships FACILITATOR_OP as an additive enum migration with an audit role snapshot', () => {
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260731234500_facilitator_op/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );

        expect(migration).toContain(`ALTER TYPE "StaffRole" ADD VALUE 'FACILITATOR_OP'`);
        expect(migration).toContain('ADD COLUMN "actor_role" "StaffRole"');
    });

    it('marks production and fixture events explicitly without title inference', () => {
        expect(loadSeedContract(validEnvironment()).events.every((event) => event.isTest === false))
            .toBe(true);
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260801010000_scheduled_session_is_test/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );
        expect(migration).toContain('"is_test" BOOLEAN NOT NULL DEFAULT false');
        expect(migration).toContain('10000000-0000-4000-8000-000000000101');
        expect(migration).toContain('10000000-0000-4000-8000-000000000102');
        expect(migration).not.toMatch(/(?:lower\s*\()?"?title"?\)?\s+(?:like|ilike)/i);
    });

    it('creates fresh paid sessions for August 8 without repurposing historical rows', () => {
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260804100000_hmp_august_8_paid_sessions/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );

        expect(migration).toContain('20000000-0000-4000-8000-202608080001');
        expect(migration).toContain('20000000-0000-4000-8000-202608080002');
        expect(migration).toContain("'2026-08-08 14:30:00'::timestamp");
        expect(migration).toContain("'2026-08-08 20:00:00'::timestamp");
        expect(migration).toContain("'SCHEDULED'::\"ScheduledSessionStatus\"");
        expect(migration).toContain('historical_source_count NOT IN (0, 2)');
        expect(migration).toContain('target_count <> historical_source_count');
        expect(migration).not.toMatch(/UPDATE\s+"scheduled_sessions"/i);
    });

    it('creates the August 11 English session from the reviewed English facilitator', () => {
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260805180000_hmp_august_11_english_session/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );

        expect(migration).toContain('20000000-0000-4000-8000-202608110001');
        expect(migration).toContain('20000000-0000-4000-8000-202608080002');
        expect(migration).toContain("'2026-08-11 22:00:00'::timestamp");
        expect(migration).toContain("'ENGLISH'::\"SessionLanguage\"");
        expect(migration).toContain("'SCHEDULED'::\"ScheduledSessionStatus\"");
        expect(migration).toContain('source_count NOT IN (0, 1)');
        expect(migration).toContain('target_count <> source_count');
        expect(migration).not.toMatch(/UPDATE\s+"scheduled_sessions"/i);
    });

    it('cancels the mistaken August 11 row and creates a fresh August 9 session', () => {
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260805230000_move_english_session_to_august_9/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );

        expect(migration).toContain('20000000-0000-4000-8000-202608110001');
        expect(migration).toContain('20000000-0000-4000-8000-202608090001');
        expect(migration).toContain("'CANCELLED'::\"ScheduledSessionStatus\"");
        expect(migration).toContain("'SCHEDULED'::\"ScheduledSessionStatus\"");
        expect(migration).toContain("'2026-08-09 22:00:00'::timestamp");
        expect(migration).toContain("'hmp-2026-08-09-en'");
        expect(migration).toContain('old_count NOT IN (0, 1)');
        expect(migration).toContain('new_count <> old_count');
    });
});
