import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { BrowserContext, TestInfo } from '@playwright/test';
import pg from 'pg';

import { requireDirectDb } from './db';

export const LISTENER_ACCOUNT_COOKIE = '__Host-hb_listener_account';
const ACCOUNT_ISSUER = 'https://account.harmonicbeacon.com';

export type ListenerAccountSwitchFixture = {
    accountId: string;
    token: string;
};

export type ListenerAccountSwitchPair = {
    founder: ListenerAccountSwitchFixture;
    free: ListenerAccountSwitchFixture;
    accountIds: readonly [string, string];
};

export type ListenerAccountSwitchSessionState = {
    present: boolean;
    accountId: string | null;
    issuer: string | null;
    expired: boolean | null;
    remainingSeconds: number | null;
    synthetic: boolean | null;
};

function digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

/**
 * Seed two non-synthetic RP sessions directly into the throwaway E2E database.
 * No public login hook is added: the fixture can run only with the local
 * direct-database guard already shared by the browser suite.
 */
export async function createListenerAccountSwitchPair(
    testInfo: TestInfo,
): Promise<ListenerAccountSwitchPair> {
    const databaseUrl = requireDirectDb(testInfo);
    const client = new pg.Client({ connectionString: databaseUrl });
    const nonce = `${Date.now()}-${randomUUID()}`;
    const founderAccountId = `account-switch-founder-${nonce}`;
    const freeAccountId = `account-switch-free-${nonce}`;
    const founderSubject = `account-switch-founder-sub-${nonce}`;
    const freeSubject = `account-switch-free-sub-${nonce}`;
    const founderToken = randomBytes(32).toString('base64url');
    const freeToken = randomBytes(32).toString('base64url');
    await client.connect();
    try {
        await client.query('BEGIN');
        for (const [accountId, subject, token, name] of [
            [founderAccountId, founderSubject, founderToken, 'Founder A'],
            [freeAccountId, freeSubject, freeToken, 'Free B'],
        ] as const) {
            await client.query(
                `insert into early_bird_users
                    (id, name, email, email_verified, security_revision, created_at, updated_at)
                 values ($1, $2, $3, true, 1, now(), now())`,
                [accountId, name, `${digest(accountId)}@e2e.invalid`],
            );
            await client.query(
                `insert into beacon_profiles
                    (account_id, display_name, revision, created_at, updated_at)
                 values ($1, $2, 1, now(), now())
                 on conflict (account_id) do update set
                    display_name = excluded.display_name,
                    revision = greatest(beacon_profiles.revision, excluded.revision),
                    updated_at = excluded.updated_at`,
                [accountId, name],
            );
            await client.query(
                `insert into listener_account_subjects
                    (account_id, issuer, subject, created_at)
                 values ($1, $2, $3, now())`,
                [accountId, ACCOUNT_ISSUER, subject],
            );
            await client.query(
                `insert into listener_account_sessions
                    (id, token_digest, account_id, issuer, subject, sid, expires_at,
                     last_checked_at, synthetic, created_at)
                 values ($1, $2, $3, $4, $5, $6,
                         now() + interval '1 hour', now(), false, now())`,
                [
                    randomUUID(), digest(token), accountId, ACCOUNT_ISSUER, subject,
                    `account-switch-sid-${randomUUID()}`,
                ],
            );
        }

        await client.query(
            `insert into early_bird_membership_projections (
                id, account_id, revision, command_hash, state, source, offer_code,
                offer_revision, effective_at, paid_through, provider, amount_minor,
                currency, reason_code, synthetic, founder_continuity_episode_id,
                founder_continuity_revision, founder_continuity_state,
                founder_continuity_offer_code, founder_continuity_offer_revision,
                founder_continuity_currency, founder_continuity_amount_minor,
                founder_continuity_billing_period, founder_continuity_activated_at,
                founder_continuity_service_through, created_at, updated_at
             ) values (
                $1, $2, 1, $3, 'ACTIVE', 'PAYPAL', 'EARLY_BIRDS_FOUNDERS_V1',
                1, now(), now() + interval '31 days', 'paypal', 500, 'USD',
                'SUBSCRIPTION_ACTIVATED', false,
                $4, 1, 'ACTIVE', 'EARLY_BIRDS_FOUNDERS_V1', 1, 'USD', 500,
                'MONTHLY', now(), now() + interval '31 days', now(), now()
             )`,
            [randomUUID(), founderAccountId, digest(`command-${nonce}`), randomUUID()],
        );
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        await client.end();
    }

    return {
        founder: { accountId: founderAccountId, token: founderToken },
        free: { accountId: freeAccountId, token: freeToken },
        accountIds: [founderAccountId, freeAccountId],
    };
}

export async function useListenerAccount(
    context: BrowserContext,
    baseURL: string,
    fixture: ListenerAccountSwitchFixture,
): Promise<void> {
    const host = new URL(baseURL).hostname;
    // The production cookie is Secure+__Host and browsers correctly refuse to
    // store it from an http response. Seed the exact cookie against the secure
    // localhost origin; Chromium sends Secure cookies to trustworthy localhost
    // while every request still reaches Playwright's plain-http local server.
    await context.clearCookies();
    await context.addCookies([{
        name: LISTENER_ACCOUNT_COOKIE,
        value: fixture.token,
        url: `https://${host}`,
        expires: Math.floor(Date.now() / 1_000) + 3_600,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax',
    }]);
}

export async function listenerAccountSwitchSessionState(
    testInfo: TestInfo,
    fixture: ListenerAccountSwitchFixture,
): Promise<ListenerAccountSwitchSessionState> {
    const databaseUrl = requireDirectDb(testInfo);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const result = await client.query<{
            account_id: string;
            issuer: string;
            expired: boolean;
            remaining_seconds: string;
            synthetic: boolean;
        }>(
            `select account_id, issuer, expires_at <= now() as expired, synthetic,
                    extract(epoch from (expires_at - now()))::text as remaining_seconds
               from listener_account_sessions
              where token_digest = $1`,
            [digest(fixture.token)],
        );
        const row = result.rows[0];
        return row ? {
            present: true,
            accountId: row.account_id,
            issuer: row.issuer,
            expired: row.expired,
            remainingSeconds: Math.round(Number(row.remaining_seconds)),
            synthetic: row.synthetic,
        } : {
            present: false,
            accountId: null,
            issuer: null,
            expired: null,
            remainingSeconds: null,
            synthetic: null,
        };
    } finally {
        await client.end();
    }
}

export async function deleteListenerAccountSwitchPair(
    testInfo: TestInfo,
    accountIds: readonly string[],
): Promise<void> {
    const databaseUrl = requireDirectDb(testInfo);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        for (const accountId of accountIds) {
            if (!/^account-switch-(founder|free)-/.test(accountId)) {
                throw new Error('refusing to delete a non-fixture Listener account');
            }
            await client.query('delete from early_bird_users where id = $1', [accountId]);
        }
    } finally {
        await client.end();
    }
}
