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

type FixtureSessionLifecycle = {
    status: 'SCHEDULED' | 'LIVE' | 'ENDED' | 'CANCELLED';
    started_at: Date | null;
    ended_at: Date | null;
};

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

/**
 * Treat the fixture's preexisting publisher as a post-migration, reconciled
 * participant for tests that target current token behavior rather than the
 * separately covered legacy-upgrade path.
 */
export async function withReconciledPublicationGrant<T>(
    databaseUrl: string,
    sessionId: string,
    run: () => Promise<T>,
): Promise<T> {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const { rows } = await client.query<{ id: string; previous: boolean }>(`
            select id, grant_reconcile_needed as previous
            from session_participants
            where scheduled_session_id = $1
              and staff_user_id is not null
              and publish_granted_at is not null
              and publish_revoked_at is null
        `, [sessionId]);
        if (rows.length !== 1) {
            throw new Error(`fixture session ${sessionId} lacks one publisher grant`);
        }
        await client.query(`
            update session_participants
            set grant_reconcile_needed = false
            where id = $1
        `, [rows[0].id]);
        try {
            return await run();
        } finally {
            await client.query(`
                update session_participants
                set grant_reconcile_needed = $2
                where id = $1
            `, [rows[0].id, rows[0].previous]);
        }
    } finally {
        await client.end();
    }
}

/**
 * Delete a session's contributions before and after `run`, so chat tests
 * never leak messages into surfaces asserted by other specs (the visual
 * baselines capture the attendee room — and its contributions panel — with
 * the fixture's empty feed).
 */
export async function withoutContributions<T>(
    databaseUrl: string,
    sessionId: string,
    run: () => Promise<T>,
): Promise<T> {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        await client.query('delete from session_contributions where scheduled_session_id = $1', [sessionId]);
        try {
            return await run();
        } finally {
            await client.query('delete from session_contributions where scheduled_session_id = $1', [sessionId]);
        }
    } finally {
        await client.end();
    }
}

/**
 * Clear a fixture session's raised hands before and after `run`.
 *
 * Hand-flow specs exercise the real persistent queue. Keeping this cleanup
 * close to those specs prevents their state from leaking into later cockpit
 * screenshots while still allowing the product endpoints to own every
 * transition under test.
 */
export async function withoutRaisedHands<T>(
    databaseUrl: string,
    sessionId: string,
    run: () => Promise<T>,
): Promise<T> {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        await client.query(
            'update session_participants set raised_at = null where scheduled_session_id = $1',
            [sessionId],
        );
        try {
            return await run();
        } finally {
            await client.query(
                'update session_participants set raised_at = null where scheduled_session_id = $1',
                [sessionId],
            );
        }
    } finally {
        await client.end();
    }
}

/** Replace fixture event titles for a layout test, then restore them exactly. */
export async function withSessionTitles<T>(
    databaseUrl: string,
    titles: ReadonlyArray<{ id: string; title: string }>,
    run: () => Promise<T>,
): Promise<T> {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const ids = titles.map(({ id }) => id);
        const { rows } = await client.query<{ id: string; title: string }>(
            'select id, title from scheduled_sessions where id = any($1::uuid[])',
            [ids],
        );
        if (rows.length !== ids.length) {
            throw new Error('one or more fixture sessions were not found');
        }
        for (const fixture of titles) {
            await client.query('update scheduled_sessions set title = $1 where id = $2', [
                fixture.title,
                fixture.id,
            ]);
        }
        try {
            return await run();
        } finally {
            for (const original of rows) {
                await client.query('update scheduled_sessions set title = $1 where id = $2', [
                    original.title,
                    original.id,
                ]);
            }
        }
    } finally {
        await client.end();
    }
}

/**
 * Exercise a complete doors-open/doors-closed journey from a known baseline,
 * then put the shared fixture back exactly as it was. Unlike
 * `withSessionStatus`, this also preserves the lifecycle timestamps mutated
 * by the product's real transition endpoint.
 */
export async function withResetSessionLifecycle<T>(
    databaseUrl: string,
    sessionId: string,
    run: () => Promise<T>,
): Promise<T> {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const { rows } = await client.query<FixtureSessionLifecycle>(
            'select status, started_at, ended_at from scheduled_sessions where id = $1',
            [sessionId],
        );
        const original = rows[0];
        if (!original) {
            throw new Error(`fixture session ${sessionId} not found`);
        }

        await client.query(
            "update scheduled_sessions set status = 'SCHEDULED', started_at = null, ended_at = null where id = $1",
            [sessionId],
        );
        try {
            return await run();
        } finally {
            await client.query(
                'update scheduled_sessions set status = $1, started_at = $2, ended_at = $3 where id = $4',
                [original.status, original.started_at, original.ended_at, sessionId],
            );
        }
    } finally {
        await client.end();
    }
}

type FixtureStaffSnapshot = {
    name: string;
    role: 'FACILITATOR' | 'FACILITATOR_OP' | 'OPERATOR' | 'ADMIN';
    disabled_at: Date | null;
};

/** Preserve the shared facilitator row while the E2E dashboard upgrades it to FACILITATOR_OP. */
export async function withPreservedFixtureStaff<T>(
    databaseUrl: string,
    email: string,
    run: () => Promise<T>,
): Promise<T> {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const { rows } = await client.query<FixtureStaffSnapshot>(
            'select name, role, disabled_at from users where email = $1',
            [email],
        );
        const original = rows[0];
        if (!original) {
            throw new Error(`fixture staff ${email} not found`);
        }
        try {
            return await run();
        } finally {
            await client.query(
                'update users set name = $1, role = $2, disabled_at = $3 where email = $4',
                [original.name, original.role, original.disabled_at, email],
            );
        }
    } finally {
        await client.end();
    }
}

/**
 * Temporarily change one synthetic staff identity's role, preserving the row.
 *
 * This lets the browser matrix exercise an unassigned facilitator and an
 * unassigned FACILITATOR_OP without adding production-only impersonation
 * behavior to the E2E dashboard route.
 */
export async function withFixtureStaffRole<T>(
    databaseUrl: string,
    email: string,
    role: FixtureStaffSnapshot['role'],
    run: () => Promise<T>,
): Promise<T> {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const { rows } = await client.query<FixtureStaffSnapshot>(
            'select name, role, disabled_at from users where email = $1',
            [email],
        );
        const original = rows[0];
        if (!original) {
            throw new Error(`fixture staff ${email} not found`);
        }
        await client.query('update users set role = $1 where email = $2', [role, email]);
        try {
            return await run();
        } finally {
            await client.query(
                'update users set name = $1, role = $2, disabled_at = $3 where email = $4',
                [original.name, original.role, original.disabled_at, email],
            );
        }
    } finally {
        await client.end();
    }
}
