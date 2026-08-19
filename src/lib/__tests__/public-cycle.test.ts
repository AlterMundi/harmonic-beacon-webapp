import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
    PUBLIC_CYCLE_SESSION_IDS,
    isAnonymousPublicCycleAccess,
    isPublicCycleSession,
} from '@/lib/public-cycle';

describe('public four-Saturday cycle', () => {
    it('recognizes exactly the four reviewed room ids', () => {
        expect(PUBLIC_CYCLE_SESSION_IDS).toHaveLength(4);
        for (const id of PUBLIC_CYCLE_SESSION_IDS) expect(isPublicCycleSession(id)).toBe(true);
        expect(isPublicCycleSession('10000000-0000-4000-8000-000000000001')).toBe(false);
    });

    it('keeps the final migration contract at the advertised 14:00 UTC', () => {
        const migration = readFileSync(
            new URL(
                '../../../prisma/migrations/20260818163000_ensure_four_saturday_public_cycle/migration.sql',
                import.meta.url,
            ),
            'utf8',
        );

        for (const date of ['2026-08-22', '2026-08-29', '2026-09-05', '2026-09-12']) {
            expect(migration).toContain(`'${date} 14:00:00'::timestamp`);
        }
        expect(migration).toContain('"public_access" = EXCLUDED."public_access"');
        expect(migration).toContain('target_count <> 4');
    });

    it('recognizes only an entirely anonymous COMP entitlement for a reviewed public room', () => {
        const candidate = {
            staffUser: null,
            accountIssuer: null,
            accountSubject: null,
            accountSessionId: null,
            accountValidatedAt: null,
            ticketEntitlement: {
                scheduledSessionId: PUBLIC_CYCLE_SESSION_IDS[0],
                tier: 'COMP',
                codeLastFour: 'FREE',
                boundEmail: 'public-opaque@anonymous.harmonicbeacon.invalid',
                accountId: null,
                accountIssuer: null,
                scheduledSession: { publicAccess: true, isTest: false },
            },
        };

        expect(isAnonymousPublicCycleAccess(candidate)).toBe(true);
        expect(isAnonymousPublicCycleAccess({
            ...candidate,
            accountSubject: 'opaque-account',
        })).toBe(false);
        expect(isAnonymousPublicCycleAccess({
            ...candidate,
            ticketEntitlement: {
                ...candidate.ticketEntitlement,
                scheduledSessionId: '10000000-0000-4000-8000-000000000001',
            },
        })).toBe(false);
    });
});
