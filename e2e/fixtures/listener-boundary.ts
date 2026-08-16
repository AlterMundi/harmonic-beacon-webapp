import { randomUUID } from 'node:crypto';

import type { APIRequestContext, TestInfo } from '@playwright/test';
import pg from 'pg';

import { requireDirectDb } from './db';

export type SyntheticListener = {
    accountId: string;
    email: string;
};

function localStartMinute(date: Date): number {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
}

export function minuteOffset(date: Date, offset: number): number {
    return (localStartMinute(date) + offset + 1_440) % 1_440;
}

/**
 * Create an auth-only Listener session through the production-shaped,
 * local-E2E-only seam. The credential is read from process env and is never
 * returned, logged or stored in browser storage by this helper.
 */
export async function signInSyntheticListener(
    request: APIRequestContext,
    email: string,
): Promise<void> {
    // This value is the committed local fixture credential already used by
    // playwright.config.ts. It authorizes no deployed environment and is
    // never written to logs, browser storage or test attachments.
    const secret = process.env.EARLY_BIRDS_TEST_LOGIN_SECRET
        ?? 'early-birds-e2e-login-secret-not-for-production';
    const response = await request.post('/api/early-birds/test-login', {
        headers: {
            authorization: `Bearer ${secret}`,
            'x-forwarded-proto': 'https',
        },
        data: { email, name: 'Boundary Listener', authOnly: true },
    });
    if (!response.ok()) throw new Error(`synthetic Listener login failed with ${response.status()}`);
}

export async function syntheticListenerByEmail(
    testInfo: TestInfo,
    email: string,
): Promise<SyntheticListener> {
    const databaseUrl = requireDirectDb(testInfo);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const result = await client.query<{ id: string }>(
            'select id from early_bird_users where email = $1',
            [email],
        );
        if (result.rows.length !== 1) throw new Error('synthetic Listener account was not created');
        return { accountId: result.rows[0].id, email };
    } finally {
        await client.end();
    }
}

export async function putSyntheticFreeSchedule(
    testInfo: TestInfo,
    listener: SyntheticListener,
    startMinute: number,
): Promise<void> {
    const databaseUrl = requireDirectDb(testInfo);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const now = new Date();
        await client.query(
            `insert into early_bird_free_schedules (
                account_id, time_zone, local_start_minute, selected_at,
                change_allowed_at, selection_request_id, revision, updated_at
            ) values ($1, 'UTC', $2, $3, $3, $4, 1, $3)
            on conflict (account_id) do update set
                local_start_minute = excluded.local_start_minute,
                selection_request_id = excluded.selection_request_id,
                revision = early_bird_free_schedules.revision + 1,
                updated_at = excluded.updated_at`,
            [listener.accountId, startMinute, now, randomUUID()],
        );
    } finally {
        await client.end();
    }
}

/** Delete only the unique @e2e.invalid identities created by this test. */
export async function deleteSyntheticListenerEmails(
    testInfo: TestInfo,
    emails: readonly string[],
): Promise<void> {
    const databaseUrl = requireDirectDb(testInfo);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        for (const email of emails) {
            if (!email.endsWith('@e2e.invalid')) {
                throw new Error('refusing to delete a non-synthetic Listener');
            }
            await client.query(
                'delete from early_bird_users where email = $1',
                [email],
            );
        }
    } finally {
        await client.end();
    }
}
