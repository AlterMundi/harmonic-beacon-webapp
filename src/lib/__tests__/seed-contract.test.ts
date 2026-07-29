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
        WEEKEND_SATURDAY_EVENT_JSON: JSON.stringify({
            id: '10000000-0000-4000-8000-000000000001',
            title: 'Saturday',
            roomName: 'saturday',
            scheduledAt: '2026-08-01T18:00:00.000Z',
            maxPublishers: 999,
        }),
        WEEKEND_SUNDAY_EVENT_JSON: JSON.stringify({
            id: '10000000-0000-4000-8000-000000000002',
            title: 'Sunday',
            roomName: 'sunday',
            scheduledAt: '2026-08-02T18:00:00.000Z',
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
        expect(contract.events.map(({ language }) => language)).toEqual(['ENGLISH', 'SPANISH']);
        expect(WEEKEND_ATTENDEE_CAP).toBe(150);
        expect(WEEKEND_MAX_PUBLISHERS).toBe(6);
        expect(contract.events[0]).not.toHaveProperty('maxPublishers');
    });

    it.each([
        'STAFF_FACILITATOR_PASSWORD_DIGEST',
        'STAFF_OPERATOR_ONE_PASSWORD_DIGEST',
        'STAFF_OPERATOR_TWO_PASSWORD_DIGEST',
        'STAFF_ADMIN_PASSWORD_DIGEST',
        'WEEKEND_SATURDAY_EVENT_JSON',
        'WEEKEND_SUNDAY_EVENT_JSON',
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
});
