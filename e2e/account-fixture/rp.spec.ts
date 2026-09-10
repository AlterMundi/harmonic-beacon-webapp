import { test, expect } from '@playwright/test';
import pg from 'pg';
import { accountSessionRow, loginViaAccountFixture, requireAccountFixture } from './browser';
import { FIXTURE_PASSWORD } from './protocol';
import { SESSION_ES } from '../fixtures/test-data';
import { withSessionStatus, withReconciledPublicationGrant } from '../fixtures/db';

for (const role of ['ATTENDEE', 'OPERATOR', 'FACILITATOR'] as const) {
    test(`Account RP ${role}: real callback, entitlement, stale identity revalidation and fail-closed binding`, async ({ page }) => {
        requireAccountFixture();
        await withSessionStatus(process.env.E2E_DATABASE_URL!, SESSION_ES.id, 'LIVE', async () => {
            await withReconciledPublicationGrant(process.env.E2E_DATABASE_URL!, SESSION_ES.id, async () => {
                await loginViaAccountFixture(page, role, 'RP fixture attendee', '/');
                const row = await accountSessionRow(page);
                const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
                await db.connect();
                try {
                    // Expire, NEVER future-date, the real RP validation so this
                    // token transition must reach the authenticated backchannel.
                    await db.query("update web_sessions set account_validated_at = now() - interval '16 minutes' where id = $1", [row.id]);
                    const response = await page.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/token`);
                    expect(response.ok()).toBe(true);
                    const principal = await response.json();
                    expect(principal.canPublish).toBe(role === 'FACILITATOR');
                    const refreshed = await accountSessionRow(page);
                    expect(refreshed.id).toBe(row.id);
                    const fresh = await db.query('select account_validated_at from web_sessions where id = $1', [row.id]);
                    expect(Date.now() - fresh.rows[0].account_validated_at.getTime()).toBeLessThan(15_000);
                    if (role === 'ATTENDEE') {
                        const owned = await db.query('select t.account_id, t.account_issuer from ticket_entitlements t join web_sessions w on w.ticket_entitlement_id = t.id where w.id = $1', [row.id]);
                        expect(owned.rows).toEqual([{ account_id: row.account_subject, account_issuer: process.env.E2E_ACCOUNT_ISSUER }]);
                        await db.query("update ticket_entitlements set account_id = 'fixture-wrong-owner' where id = (select ticket_entitlement_id from web_sessions where id = $1)", [row.id]);
                        try { expect((await page.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/token`)).status()).toBe(403); }
                        finally { await db.query('update ticket_entitlements set account_id = $2 where id = (select ticket_entitlement_id from web_sessions where id = $1)', [row.id, row.account_subject]); }
                    } else {
                        await db.query('update staff_account_bindings set disabled_at = now() where account_issuer = $1 and account_subject = $2', [process.env.E2E_ACCOUNT_ISSUER, row.account_subject]);
                        try { expect((await page.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/token`)).status()).toBe(403); }
                        finally { await db.query('update staff_account_bindings set disabled_at = null where account_issuer = $1 and account_subject = $2', [process.env.E2E_ACCOUNT_ISSUER, row.account_subject]); }
                    }
                } finally { await db.end(); }
            });
        });
    });
}

test('Account RP rejects a correctly authenticated but unbound staff identity', async ({ page }) => {
    await page.goto('/api/account/login?flow=staff');
    await page.getByLabel('Fixture username').fill('unbound');
    await page.getByLabel('Fixture password').fill(FIXTURE_PASSWORD);
    const callback = page.waitForResponse(r => new URL(r.url()).pathname === '/api/account/callback');
    await page.getByRole('button', { name: 'Sign in to simulation' }).click();
    expect((await callback).status()).toBe(303);
    await expect(page).toHaveURL(/account_error=1/);
    expect((await page.context().cookies()).filter(c => c.name === 'hb_session')).toHaveLength(0);
});
