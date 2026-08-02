import { createHmac } from 'node:crypto';
import pg from 'pg';
import { RoomServiceClient } from 'livekit-server-sdk';

import { expect, stackTest } from '../fixtures/stack';
import { loginAttendeeWithTicket, loginViaDashboard } from '../fixtures/auth';
import { requireDirectDb, withSessionStatus } from '../fixtures/db';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';

const CAMPAIGN_LABEL = 'E2E controlled invitation';
const PROMO_CODE = 'E2EPROMO';
const PROMO_EMAIL = 'promo-guest@example.invalid';

async function cleanupCampaign(databaseUrl: string): Promise<void> {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        await client.query('begin');
        const { rows } = await client.query<{ ticket_entitlement_id: string }>(`
            select pr.ticket_entitlement_id
            from promo_redemptions pr
            join promo_invitations pi on pi.id = pr.promo_invitation_id
            where pi.label = $1
        `, [CAMPAIGN_LABEL]);
        const entitlementIds = rows.map((row) => row.ticket_entitlement_id);
        if (entitlementIds.length > 0) {
            await client.query('delete from web_sessions where ticket_entitlement_id = any($1::uuid[])', [entitlementIds]);
            await client.query('delete from session_participants where ticket_entitlement_id = any($1::uuid[])', [entitlementIds]);
        }
        await client.query('delete from promo_invitations where label = $1', [CAMPAIGN_LABEL]);
        if (entitlementIds.length > 0) {
            await client.query('delete from ticket_entitlements where id = any($1::uuid[])', [entitlementIds]);
        }
        await client.query('commit');
    } catch (error) {
        await client.query('rollback');
        throw error;
    } finally {
        await client.end();
    }
}

async function participantIdentityForCampaign(databaseUrl: string): Promise<string> {
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    try {
        const { rows } = await client.query<{ participant_identity: string }>(`
            select sp.participant_identity
            from session_participants sp
            join promo_redemptions pr on pr.ticket_entitlement_id = sp.ticket_entitlement_id
            join promo_invitations pi on pi.id = pr.promo_invitation_id
            where pi.label = $1 and sp.left_at is null
            order by sp.joined_at desc
            limit 1
        `, [CAMPAIGN_LABEL]);
        if (!rows[0]) throw new Error('promotion participant did not join the fixture session');
        return rows[0].participant_identity;
    } finally {
        await client.end();
    }
}

function roomService(): RoomServiceClient {
    const livekitUrl = (process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880')
        .replace(/^ws:/, 'http:')
        .replace(/^wss:/, 'https:');
    return new RoomServiceClient(
        livekitUrl,
        process.env.E2E_LIVEKIT_API_KEY ?? 'devkey',
        process.env.E2E_LIVEKIT_API_SECRET ?? 'secret',
    );
}

function bedIdentity(stageIdentity: string): string {
    const secret = process.env.E2E_LIVEKIT_API_SECRET ?? 'secret';
    const digest = createHmac('sha256', secret)
        .update(`bed:${stageIdentity}`)
        .digest('base64url')
        .slice(0, 32);
    return `bed-${digest}`;
}

function localDateTimeInput(value: Date): string {
    const localTime = new Date(value.getTime() - value.getTimezoneOffset() * 60_000);
    return localTime.toISOString().slice(0, 16);
}

stackTest('controlled invitation becomes normal access, replays, then revokes and disconnects', async ({
    browser,
}, testInfo) => {
    stackTest.slow();
    const databaseUrl = requireDirectDb(testInfo);
    await cleanupCampaign(databaseUrl);

    try {
        await withSessionStatus(databaseUrl, SESSION_ES.id, 'LIVE', async () => {
            const staffContext = await browser.newContext();
            const firstGuestContext = await browser.newContext();
            const returningGuestContext = await browser.newContext();
            const staff = await staffContext.newPage();
            const firstGuest = await firstGuestContext.newPage();
            const returningGuest = await returningGuestContext.newPage();

            try {
                await loginViaDashboard(staff, 'ADMIN', 'Invitation Admin', ROUTES.opsAdmission);
                await staff.getByRole('button', { name: 'Load invitations' }).click();
                await expect(staff.getByRole('status')).toContainText('Public redemption is ON');
                await staff.getByLabel(/Internal label/).fill(CAMPAIGN_LABEL);
                await staff.getByLabel(/Human code/).fill(PROMO_CODE);
                await staff.getByLabel(/Expires/).fill(
                    localDateTimeInput(new Date(Date.now() + 6 * 60 * 60 * 1000)),
                );
                await staff.getByLabel(/Redemption capacity/).fill('1');
                await staff.getByRole('button', { name: 'Create invitation' }).click();
                const campaign = staff.locator('article').filter({ hasText: CAMPAIGN_LABEL });
                await expect(campaign).toContainText('0/1 redeemed');

                await loginAttendeeWithTicket(firstGuest, {
                    name: 'Promotion Guest',
                    email: PROMO_EMAIL,
                    code: PROMO_CODE,
                });
                await expect(firstGuest).toHaveURL(new RegExp(`${ROUTES.session(SESSION_ES.id)}$`));
                await expect(firstGuest.getByTestId('connection-state')).toHaveAttribute(
                    'data-state',
                    'connected',
                    { timeout: 20_000 },
                );
                await firstGuest.reload();
                await expect(firstGuest.getByTestId('connection-state')).toHaveAttribute(
                    'data-state',
                    'connected',
                    { timeout: 20_000 },
                );
                await firstGuestContext.close();

                // Same campaign + same normalized email replays the one redemption
                // into a fresh browser session even though its capacity is full.
                await loginAttendeeWithTicket(returningGuest, {
                    name: 'Returning Promotion Guest',
                    email: PROMO_EMAIL.toUpperCase(),
                    code: PROMO_CODE.toLowerCase(),
                });
                await expect(returningGuest).toHaveURL(new RegExp(`${ROUTES.session(SESSION_ES.id)}$`));
                await expect(returningGuest.getByTestId('connection-state')).toHaveAttribute(
                    'data-state',
                    'connected',
                    { timeout: 20_000 },
                );
                const participantIdentity = await participantIdentityForCampaign(databaseUrl);

                await staff.getByRole('button', { name: 'Refresh' }).click();
                await expect(campaign).toContainText('1/1 redeemed');
                await campaign.getByPlaceholder(/Disable reason/).fill('Synthetic campaign complete');
                await campaign.getByRole('checkbox', { name: /Also revoke every entitlement/ }).check();
                await campaign.getByRole('button', { name: 'Disable invitation' }).click();
                await expect(campaign).toContainText('DISABLED');
                await expect(staff.getByText(/1 derived access grant\(s\) revoked/)).toBeVisible();

                await expect.poll(async () => {
                    const response = await returningGuest.request.get(
                        `/api/scheduled-sessions/${SESSION_ES.id}/entry`,
                    );
                    return response.status();
                }, { timeout: 10_000 }).toBe(401);
                const livekit = roomService();
                await expect.poll(async () => ({
                    stage: (await livekit.listParticipants(SESSION_ES.roomName)).map(({ identity }) => identity),
                    bed: (await livekit.listParticipants('beacon')).map(({ identity }) => identity),
                }), { timeout: 10_000 }).toEqual({
                    stage: expect.not.arrayContaining([participantIdentity]),
                    bed: expect.not.arrayContaining([bedIdentity(participantIdentity)]),
                });
            } finally {
                await Promise.allSettled([
                    staffContext.close(),
                    firstGuestContext.close(),
                    returningGuestContext.close(),
                ]);
            }
        });
    } finally {
        await cleanupCampaign(databaseUrl);
    }
});
