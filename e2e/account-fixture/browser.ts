import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import pg from 'pg';
import { createHash } from 'node:crypto';
import { assertSafeFixtureDatabaseUrl } from '../fixtures/database-url';
import { SESSION_ES } from '../fixtures/test-data';
import { FIXTURE_PASSWORD, FIXTURE_CLIENT_ID, FIXTURE_CLIENT_SECRET } from './protocol';

export function accountFixtureEnabled() { return process.env.E2E_ACCOUNT_FIXTURE === '1'; }
export function requireAccountFixture() {
    if (!accountFixtureEnabled()) throw new Error('Account sign-out requires the isolated external identity simulation: e2e/account-fixture/README.md (not BEACON_ACCOUNT_ENABLED alone)');
    const issuer = new URL(process.env.E2E_ACCOUNT_ISSUER!);
    const live = new URL(process.env.E2E_BASE_URL!);
    if (issuer.protocol !== 'https:' || live.protocol !== 'https:' || ![issuer, live].every(url => ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Account fixture must use loopback HTTPS');
    assertSafeFixtureDatabaseUrl(process.env.E2E_DATABASE_URL);
}

/** Actual RP browser flow. No WebSession/validatedAt/cookie synthesis. */
export async function loginViaAccountFixture(page: Page, role: 'ATTENDEE' | 'OPERATOR' | 'FACILITATOR' | 'ADMIN', name: string, landing: string) {
    requireAccountFixture();
    const flow = role === 'ATTENDEE' ? 'attendee' : 'staff';
    await page.goto(`/api/account/login?${new URLSearchParams({ flow, next: '/' })}`);
    await expect(page.getByRole('heading', { name: 'External identity simulation' })).toBeVisible();
    await page.getByLabel('Fixture username').fill(role.toLowerCase());
    await page.getByLabel('Fixture password').fill(FIXTURE_PASSWORD);
    const callback = page.waitForResponse(r => new URL(r.url()).pathname === '/api/account/callback');
    await page.getByRole('button', { name: 'Sign in to simulation', exact: true }).click();
    expect((await callback).status()).toBe(303);
    await expect(page).toHaveURL(new URL(flow === 'staff' ? '/ops/events' : '/', process.env.E2E_BASE_URL!).href);
    if (role === 'ATTENDEE') {
        // Production entry resolves the account-owned public entitlement; the
        // name-confirmation endpoint, not direct database writes, binds alias.
        const entry = await page.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/entry`);
        expect(entry.ok()).toBe(true);
        const confirmed = await page.request.patch(`/api/scheduled-sessions/${SESSION_ES.id}/entry`, { data: { displayName: name } });
        expect(confirmed.ok()).toBe(true);
    }
    await page.goto(landing);
}

/** Read back the exact local RP row for revocation evidence. Never mutates it. */
export async function accountSessionRow(page: Page) {
    requireAccountFixture();
    const token = (await page.context().cookies()).find(cookie => cookie.name === 'hb_session')?.value;
    if (!token) throw new Error('Real RP did not issue hb_session');
    const digest = createHash('sha256').update(token).digest('hex');
    const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
    await db.connect();
    try {
        const result = await db.query('select id, account_issuer, account_subject, account_session_id, account_validated_at, revoked_at from web_sessions where token_digest = $1', [digest]);
        expect(result.rows).toHaveLength(1);
        const row = result.rows[0];
        expect(row.account_issuer).toBe(process.env.E2E_ACCOUNT_ISSUER);
        expect(row.account_subject).toMatch(/^fixture-/);
        expect(row.account_session_id).toBeTruthy();
        expect(row.account_validated_at.getTime()).toBeLessThanOrEqual(Date.now());
        expect(row.revoked_at).toBeNull();
        return row as { id: string; account_session_id: string; account_subject: string };
    } finally { await db.end(); }
}

export async function expectCentralSessionInactive(page: Page, row: { account_session_id: string; account_subject: string }) {
    requireAccountFixture();
    const response = await page.request.post(`${process.env.E2E_ACCOUNT_ISSUER}/api/account/session-status`, {
        headers: { authorization: `Basic ${Buffer.from(`${FIXTURE_CLIENT_ID}:${FIXTURE_CLIENT_SECRET}`).toString('base64')}` },
        form: { sid: row.account_session_id, sub: row.account_subject },
    });
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual({ active: false });
}

export async function expectAccountSessionRevoked(id: string) {
    requireAccountFixture();
    const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
    await db.connect();
    try {
        const result = await db.query('select revoked_at from web_sessions where id = $1', [id]);
        expect(result.rows).toHaveLength(1);
        expect(result.rows[0].revoked_at).not.toBeNull();
    } finally { await db.end(); }
}
