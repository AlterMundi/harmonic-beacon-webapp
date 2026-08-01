import pg from 'pg';
import type { TestInfo } from '@playwright/test';
import { isSafeFixtureDatabaseUrl } from './database-url';

/**
 * Direct access to the throwaway fixture database, for the rare cases where
 * a test must change fixture state the product UI deliberately cannot — e.g.
 * opening doors by flipping a session to LIVE (attendees only receive stage
 * tokens for LIVE sessions, see src/lib/room-entitlement.ts).
 *
 * Uses E2E_DATABASE_URL, the same database the managed web server runs
 * against (resolved in playwright.config.ts). Always restores what it
 * changes; never point this at anything but the fixture database.
 */

export function requireDirectDb(testInfo: TestInfo): string {
    const url = process.env.E2E_DATABASE_URL;
    testInfo.skip(
        !isSafeFixtureDatabaseUrl(url),
        'E2E_DATABASE_URL is absent or is not the local beacon_test database — refusing to mutate it (see e2e/README.md)',
    );
    return url as string;
}

export type FixtureSessionStatus = 'SCHEDULED' | 'LIVE';

/**
 * Flip a fixture session's status for the duration of `run`, restoring the
 * original status afterwards even when the callback throws.
 */
export async function withSessionStatus<T>(
    databaseUrl: string,
    sessionId: string,
    status: FixtureSessionStatus,
    run: () => Promise<T>,
): Promise<T> {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const { rows } = await client.query<{ status: FixtureSessionStatus }>(
            'update scheduled_sessions set status = $1 where id = $2 returning status',
            [status, sessionId],
        );
        if (rows.length !== 1) {
            throw new Error(`fixture session ${sessionId} not found`);
        }
        try {
            return await run();
        } finally {
            await client.query('update scheduled_sessions set status = $1 where id = $2', [
                'SCHEDULED',
                sessionId,
            ]);
        }
    } finally {
        await client.end();
    }
}
