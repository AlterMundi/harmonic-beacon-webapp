import pg from 'pg';

import { assertSafeFixtureDatabaseUrl } from './database-url';

const PUBLIC_CYCLE_SESSION_IDS = [
    '50000000-0000-4000-8000-202608220001',
    '50000000-0000-4000-8000-202608290001',
    '50000000-0000-4000-8000-202609050001',
    '50000000-0000-4000-8000-202609120001',
] as const;

/**
 * Keep the reviewed four-event landing fixture deterministic as wall-clock
 * time advances through the real 2026 cycle. The browser gate uses a
 * disposable database restored immediately before Playwright; marking these
 * four rows LIVE keeps their canonical dates/copy intact while satisfying the
 * same discovery rule used for a currently open event.
 */
export default async function stabilizePublicCycle(): Promise<void> {
    const databaseUrl = process.env.E2E_DATABASE_URL;
    if (!databaseUrl) {
        throw new Error('E2E_DATABASE_URL is required to stabilize the public cycle fixture');
    }
    assertSafeFixtureDatabaseUrl(databaseUrl);

    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const result = await client.query<{ id: string }>(
            `update scheduled_sessions
                set status = 'LIVE', started_at = now(), ended_at = null
              where id = any($1::uuid[])
          returning id`,
            [PUBLIC_CYCLE_SESSION_IDS],
        );
        if (result.rowCount !== PUBLIC_CYCLE_SESSION_IDS.length) {
            throw new Error(
                `expected ${PUBLIC_CYCLE_SESSION_IDS.length} public cycle fixtures, updated ${result.rowCount ?? 0}`,
            );
        }
    } finally {
        await client.end();
    }
}
