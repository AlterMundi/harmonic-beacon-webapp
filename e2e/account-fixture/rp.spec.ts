import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import pg from 'pg';
import { accountSessionRow, authorizeViaAccountFixture, loginViaAccountFixture, requireAccountFixture } from './browser';
import { FIXTURE_PASSWORD } from './protocol';
import { SESSION_ES } from '../fixtures/test-data';
import { withSessionStatus, withReconciledPublicationGrant } from '../fixtures/db';

test('Account RP observes landing and waiting room with an existing authenticated cookie', async ({ page }) => {
    requireAccountFixture();
    await authorizeViaAccountFixture(page, 'ATTENDEE');
    const original = await accountSessionRow(page);
    for (const [path, surface] of [['/', 'landing'], [`/session/${SESSION_ES.id}`, 'session']]) {
        await withSessionStatus(process.env.E2E_DATABASE_URL!, SESSION_ES.id, 'SCHEDULED', async () => {
            const observation = page.waitForResponse(r =>
                new URL(r.url()).pathname === '/api/cohort-visits' &&
                r.request().postDataJSON()?.surface === surface);
            await page.goto(path);
            const response = await observation;
            expect(response.status()).toBe(202);
            expect(response.headers()['cache-control']).toContain('no-store');
            const body = await response.json();
            expect(body.accepted).toBe(true);
            expect(typeof body.observed).toBe('boolean');
            expect((await accountSessionRow(page)).id).toBe(original.id);
            if (body.observed) {
                const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
                await db.connect();
                try {
                    const rows = await db.query(`SELECT metadata FROM audit_logs
                        WHERE action='pmp_cohort_authenticated_visit_v2'
                        AND metadata->>'issuer'=$1 AND metadata->>'subject'=$2
                        AND metadata->>'surface'=$3 AND created_at >= $4`,
                    [process.env.E2E_ACCOUNT_ISSUER, original.account_subject, surface, '2026-09-23T21:00:00Z']);
                    expect(rows.rows.length).toBeGreaterThan(0);
                    expect(Object.keys(rows.rows[0].metadata).sort()).toEqual(['issuer', 'subject', 'surface']);
                } finally { await db.end(); }
            }
        });
    }
});

async function currentAccountSession(page: Parameters<typeof authorizeViaAccountFixture>[0], db: pg.Client) {
    const token = (await page.context().cookies()).find(cookie => cookie.name === 'hb_session')?.value;
    expect(token).toBeTruthy();
    const result = await db.query<{ id: string; account_subject: string }>(`
        select id, account_subject from web_sessions where token_digest = $1
    `, [createHash('sha256').update(token!).digest('hex')]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].account_subject).toBe('fixture-attendee');
    return result.rows[0];
}

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

test('Account RP incomplete profile gates new entry, preserves active presence, and retains participation through same-account OIDC', async ({ page }) => {
    requireAccountFixture();
    await withSessionStatus(process.env.E2E_DATABASE_URL!, SESSION_ES.id, 'LIVE', async () => {
        const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
        await db.connect();
        let originalSessionId: string | undefined;
        let originalProfileComplete: boolean | null | undefined;
        let createdPresenceId: string | undefined;
        try {
            await authorizeViaAccountFixture(page, 'ATTENDEE');
            const original = await currentAccountSession(page, db);
            originalSessionId = original.id;
            const bare = await db.query<{
                account_profile_complete: boolean | null;
                ticket_entitlement_id: string | null;
            }>(`
                select account_profile_complete, ticket_entitlement_id
                from web_sessions where id = $1
            `, [original.id]);
            expect(bare.rows).toHaveLength(1);
            expect(bare.rows[0].ticket_entitlement_id).toBeNull();
            originalProfileComplete = bare.rows[0].account_profile_complete;

            await db.query('update web_sessions set account_profile_complete = false where id = $1', [original.id]);
            const denied = await page.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/entry`);
            expect(denied.status()).toBe(428);
            expect(await denied.json()).toEqual({ error: 'profile_required' });
            expect((await db.query(
                'select ticket_entitlement_id from web_sessions where id = $1',
                [original.id],
            )).rows[0].ticket_entitlement_id).toBeNull();

            // Establish the ordinary participant and heartbeat only while the
            // fixture profile is complete; after this point the same false
            // snapshot represents an active attendee, not a new entrant.
            await db.query('update web_sessions set account_profile_complete = true where id = $1', [original.id]);
            expect((await page.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/entry`)).ok()).toBe(true);
            const alias = 'RP fixture attendee';
            expect((await page.request.patch(`/api/scheduled-sessions/${SESSION_ES.id}/entry`, {
                data: { displayName: alias },
            })).ok()).toBe(true);
            expect((await page.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/token`)).ok()).toBe(true);

            const participation = await db.query<{
                ticket_entitlement_id: string;
                display_name: string;
                display_name_confirmed_at: Date;
                participant_id: string;
            }>(`
                select w.ticket_entitlement_id, w.display_name, w.display_name_confirmed_at,
                       p.id as participant_id
                from web_sessions w
                join session_participants p
                  on p.ticket_entitlement_id = w.ticket_entitlement_id
                 and p.scheduled_session_id = $2
                where w.id = $1
            `, [original.id, SESSION_ES.id]);
            expect(participation.rows).toHaveLength(1);
            expect(participation.rows[0]).toMatchObject({ display_name: alias });
            expect(participation.rows[0].display_name_confirmed_at).toBeInstanceOf(Date);
            const existingOpen = await db.query(
                'select id from live_presence_intervals where participant_id = $1 and ended_at is null',
                [participation.rows[0].participant_id],
            );
            expect(existingOpen.rows).toHaveLength(0);

            const heartbeat = await page.request.post(`/api/scheduled-sessions/${SESSION_ES.id}/presence`, {
                data: { state: 'connected' },
            });
            expect(heartbeat.status()).toBe(202);
            const openPresence = await db.query<{ id: string }>(`
                select id from live_presence_intervals
                where participant_id = $1 and ended_at is null
            `, [participation.rows[0].participant_id]);
            expect(openPresence.rows).toHaveLength(1);
            createdPresenceId = openPresence.rows[0].id;

            await db.query('update web_sessions set account_profile_complete = false where id = $1', [original.id]);
            const activeEntry = await page.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/entry`);
            expect(activeEntry.ok()).toBe(true);
            expect(await activeEntry.json()).toMatchObject({
                state: 'READY',
                identity: { kind: 'attendee', displayName: alias, confirmed: true },
            });
            const activeToken = await page.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/token`);
            expect(activeToken.ok()).toBe(true);
            expect(await activeToken.json()).toMatchObject({ displayName: alias, principalKind: 'ticket' });

            await authorizeViaAccountFixture(page, 'ATTENDEE');
            const replacement = await currentAccountSession(page, db);
            expect(replacement.id).not.toBe(original.id);
            const rotated = await db.query<{
                id: string;
                ticket_entitlement_id: string | null;
                display_name: string | null;
                display_name_confirmed_at: Date | null;
                account_profile_complete: boolean | null;
            }>(`
                select id, ticket_entitlement_id, display_name,
                       display_name_confirmed_at, account_profile_complete
                from web_sessions where id = any($1::uuid[])
                order by id
            `, [[original.id, replacement.id]]);
            expect(rotated.rows).toHaveLength(2);
            const oldRow = rotated.rows.find(row => row.id === original.id)!;
            const newRow = rotated.rows.find(row => row.id === replacement.id)!;
            expect(newRow).toMatchObject({
                ticket_entitlement_id: participation.rows[0].ticket_entitlement_id,
                display_name: alias,
                account_profile_complete: true,
            });
            expect(newRow.display_name_confirmed_at).toEqual(participation.rows[0].display_name_confirmed_at);
            expect(oldRow.ticket_entitlement_id).toBe(participation.rows[0].ticket_entitlement_id);
            expect((await db.query('select revoked_at from web_sessions where id = $1', [original.id])).rows[0].revoked_at).toBeInstanceOf(Date);
        } finally {
            if (createdPresenceId) {
                await db.query('delete from live_presence_intervals where id = $1', [createdPresenceId]);
            }
            if (originalSessionId && originalProfileComplete !== undefined) {
                await db.query(
                    'update web_sessions set account_profile_complete = $2 where id = $1',
                    [originalSessionId, originalProfileComplete],
                );
            }
            await db.end();
        }
    });
});
