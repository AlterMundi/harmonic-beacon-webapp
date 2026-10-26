import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { AxeBuilder } from '@axe-core/playwright';
import { loginViaDashboard } from '../fixtures/auth';
import { requireDirectDb, withoutContributions, withSessionStatus } from '../fixtures/db';
import { expect, stackTest } from '../fixtures/stack';
import { SESSION_ES, ROUTES } from '../fixtures/test-data';
import { installMediaProbe, mediaProbeSnapshot, expectMediaContinuity } from '../helpers/media-probe';

stackTest('participant and operator share chat while panels preserve media and mobile layout', async ({ browser }, testInfo) => {
    stackTest.slow();
    const db = requireDirectDb(testInfo);
    await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
        await withoutContributions(db, SESSION_ES.id, async () => {
            const audienceContext = await browser.newContext({ locale: 'es-AR', viewport: { width: 390, height: 844 } });
            const staffContext = await browser.newContext({ locale: 'es-AR', viewport: { width: 1440, height: 1000 } });
            try {
                const audience = await audienceContext.newPage();
                const staff = await staffContext.newPage();
                await installMediaProbe(audience);
                await loginViaDashboard(audience, 'ATTENDEE', 'Ana de prueba', ROUTES.session(SESSION_ES.id));
                await expect(audience.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
                await loginViaDashboard(staff, 'OPERATOR', 'Equipo de prueba', ROUTES.opsSession(SESSION_ES.id));
                const room = staff.frameLocator('[data-testid="persistent-room"]');
                await expect(room.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
                const staffToken = await staff.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/token`);
                expect(staffToken.ok()).toBe(true);
                const { displayName: staffName } = await staffToken.json();
                expect(staffName).toEqual(expect.stringMatching(/\S/));
                await staff.locator('[data-tool="contributions"]').click();
                const before = await mediaProbeSnapshot(audience);
                await audience.getByRole('textbox').fill('Una pregunta de prueba compartida');
                await audience.getByRole('button', { name: /^Compartir$|^Share$/ }).click();
                await expect(staff.getByTestId('contributions-feed').first()).toContainText('Una pregunta de prueba compartida', { timeout: 15_000 });
                await staff.getByRole('textbox').fill('Una respuesta del equipo');
                await staff.getByRole('button', { name: /^Compartir$|^Share$/ }).click();
                await expect(audience.getByTestId('contributions-feed')).toContainText('Una respuesta del equipo', { timeout: 15_000 });
                await expect(audience.getByTestId('contributions-feed')).toContainText(`${staffName} · Operaciones`);

                await audience.getByRole('tab', { name: /Personas|People/ }).click();
                await audience.getByRole('searchbox').fill(staffName);
                await expect(audience.getByRole('tabpanel', { name: /Personas|People/ })).toContainText(staffName);
                await audience.getByRole('tab', { name: /Personas|People/ }).press('Home');
                await expect(audience.getByRole('tab', { name: 'Chat', exact: true })).toBeFocused();
                await expect(audience.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('aria-selected', 'true');
                expectMediaContinuity(before, await mediaProbeSnapshot(audience));
                for (const width of [390, 320]) {
                    await audience.setViewportSize({ width, height: 844 });
                    expect(await audience.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
                    const heading = await audience.locator('h1').boundingBox();
                    expect(heading!.width).toBeGreaterThan(200);
                    const controls = await audience.locator('.hb-room-controls').boundingBox();
                    const chat = await audience.locator('.hb-room-sidebar').boundingBox();
                    expect(controls!.y).toBeLessThan(chat!.y);
                }
                await audience.setViewportSize({ width: 390, height: 844 });
                await audience.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
                await staff.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));
                await testInfo.attach('participant-mobile', { body: await audience.screenshot({ fullPage: true }), contentType: 'image/png' });
                await testInfo.attach('operator-desktop', { body: await staff.screenshot({ fullPage: true }), contentType: 'image/png' });
                await audience.setViewportSize({ width: 1440, height: 1000 });
                await testInfo.attach('participant-desktop', { body: await audience.screenshot({ fullPage: true }), contentType: 'image/png' });
            } finally {
                await audienceContext.close(); await staffContext.close();
            }
        });
    });
});

stackTest('personal profile exposes real identity, role and event creation without inventing a plan', async ({ page }, testInfo) => {
    const databaseUrl = requireDirectDb(testInfo);
    const client = new pg.Client({ connectionString: databaseUrl });
    await client.connect();
    const eventId = randomUUID();
    const title = 'Encuentro compartido de prueba';
    try {
        await loginViaDashboard(page, 'OPERATOR', 'Perfil de prueba', '/profile');
        await expect(page.getByRole('heading', { level: 1 })).toContainText('Perfil de prueba');
        await expect(page.locator('.hb-profile-role')).toContainText(/Operaciones|Operations/);
        await expect(page.getByRole('link', { name: /Crear evento|Create event/ })).toHaveAttribute('href', '/ops/events/manage');
        await expect(page.getByRole('link', { name: /Abrir Beacon Listen|Open Beacon Listen/ })).toBeVisible();
        await expect(page.locator('.hb-profile')).not.toContainText('Plus');
        const configuration = await page.request.get('/api/ops/events');
        expect(configuration.ok()).toBe(true);
        const { facilitators } = await configuration.json();
        // Exercise the ordinary reverse-proxy Host/Origin boundary on the local
        // production build; this request stays on the guarded beacon_test stack.
        const created = await page.request.post('/api/ops/events', {
            headers: { host: 'live-staging.harmonicbeacon.com', origin: 'https://live-staging.harmonicbeacon.com' },
            data: { id: eventId, title, language: 'SPANISH', eventTimeZone: 'UTC',
                scheduledAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
                facilitatorId: facilitators[0].id, publicAccess: true, isPublished: true },
        });
        expect(created.status()).toBe(200);
        await page.reload();
        const event = page.locator('.hb-profile-event').filter({ has: page.getByRole('heading', { name: title }) });
        await expect(event).toBeVisible();
        await expect(event.getByRole('link', { name: /Abrir sala de equipo|Open staff room/ })).toHaveAttribute('href', `/ops/events/${eventId}`);
        await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
        await event.getByRole('button', { name: /Compartir enlace|Share link/ }).click();
        await expect(event.getByRole('button', { name: /Enlace copiado|Link copied/ })).toBeVisible();
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${new URL(page.url()).origin}/session/${eventId}`);
        const accessibility = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
        expect(accessibility.violations.filter(item => item.impact === 'critical' || item.impact === 'serious')).toEqual([]);
        await testInfo.attach('profile-desktop', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
        await page.setViewportSize({ width: 320, height: 844 });
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
        await testInfo.attach('profile-mobile', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
    } finally {
        await client.query('delete from scheduled_sessions where id=$1 and title=$2', [eventId, title]);
        await client.end();
    }
});

stackTest('an unassigned operator enables their own controls without automatic capture', async ({ page }, testInfo) => {
    const client = new pg.Client({ connectionString: requireDirectDb(testInfo) });
    await client.connect();
    const eventId = randomUUID();
    const title = 'Staff publication proof';
    try {
        await loginViaDashboard(page, 'OPERATOR', 'Operadora de prueba', '/profile');
        const configuration = await page.request.get('/api/ops/events');
        const { facilitators } = await configuration.json();
        const created = await page.request.post('/api/ops/events', {
            headers: { host: 'live-staging.harmonicbeacon.com', origin: 'https://live-staging.harmonicbeacon.com' },
            data: { id: eventId, title, language: 'SPANISH', eventTimeZone: 'UTC',
                scheduledAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
                facilitatorId: facilitators[0].id, publicAccess: true, isPublished: false },
        });
        expect(created.status()).toBe(200);
        await client.query("update scheduled_sessions set status='LIVE', started_at=now() where id=$1 and title=$2", [eventId, title]);
        await installMediaProbe(page);
        await page.goto(`/session/${eventId}`);
        await expect(page.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
        const before = await mediaProbeSnapshot(page);
        const [grant] = await Promise.all([
            page.waitForResponse(response => response.url().endsWith(`/api/ops/sessions/${eventId}/stage`) && response.request().method() === 'POST'),
            page.getByRole('button', { name: /Habilitar mi micrófono y cámara|Enable my microphone and camera/ }).click(),
        ]);
        expect(grant.status()).toBe(200);
        const mic = page.getByRole('button', { name: /Activar micrófono|Unmute microphone/i });
        await expect(mic).toBeVisible();
        await expect(page.getByRole('button', { name: /Encender cámara|Turn camera on/i })).toBeVisible();
        const after = await mediaProbeSnapshot(page);
        expect(after.captureAttempts).toBe(before.captureAttempts);
        expect(after.peerConnectionsClosed).toBe(before.peerConnectionsClosed);
        const token = await page.request.get(`/api/scheduled-sessions/${eventId}/token`);
        expect(await token.json()).toMatchObject({ canPublish: true, isAssignedFacilitator: false });
        await mic.click();
        await expect(page.getByRole('button', { name: /Silenciar micrófono|Mute microphone/i })).toBeVisible();
    } finally {
        await page.goto('about:blank');
        await client.query('delete from scheduled_sessions where id=$1 and title=$2', [eventId, title]);
        await client.end();
    }
});
