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
                await expect(audience.locator('hb-global-nav')).toHaveCount(0);
                await expect(audience.getByRole('tab')).toHaveCount(2);
                await expect(audience.getByRole('tab', { name: /^(?:Chat|Participantes \d+|Participants \d+)$/ })).toHaveCount(2);
                await expect(audience.locator('.hb-staff-tools')).toHaveCount(0);
                await expect(audience.getByRole('button', { name: /Subir a la escena|Join the stage/ })).toHaveCount(0);
                await loginViaDashboard(staff, 'OPERATOR', 'Equipo de prueba', ROUTES.opsSession(SESSION_ES.id));
                await expect(staff.locator('hb-global-nav')).toHaveCount(0);
                await expect(staff.getByRole('navigation', { name: /Event operations|Operaciones de eventos/ })).toHaveCount(0);
                const room = staff.frameLocator('[data-testid="persistent-room"]');
                await expect(room.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
                const staffToken = await staff.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/token`);
                expect(staffToken.ok()).toBe(true);
                const { displayName: staffName } = await staffToken.json();
                expect(staffName).toEqual(expect.stringMatching(/\S/));
                // Every tool has one entry, in the sidebar. Tab changes retain
                // the existing room and the user's in-progress message.
                for (const signal of ['hands', 'stage', 'door', 'health']) {
                    await expect(staff.locator(`[data-signal="${signal}"]`)).toHaveCount(1);
                    await expect(staff.locator(`.hb-staff-tools [data-signal="${signal}"]`)).toHaveCount(1);
                }
                await expect(staff.locator('[data-signal="primary"]')).toHaveCount(0);
                await staff.locator('[data-tool="contributions"]').click();
                await expect(staff.getByRole('tab', { name: 'Chat', exact: true })).toHaveAttribute('aria-selected', 'true');
                await staff.getByRole('textbox').fill('Borrador que conservo');
                await staff.getByRole('tab', { name: /Manos|Hands/ }).click();
                await staff.getByRole('tab', { name: /^(?:Escena|Stage)$/ }).click();
                await staff.getByRole('tab', { name: 'Chat', exact: true }).click();
                await expect(staff.getByRole('textbox')).toHaveValue('Borrador que conservo');
                await staff.getByRole('textbox').fill('');
                const before = await mediaProbeSnapshot(audience);
                await audience.getByRole('textbox').fill('Una pregunta de prueba compartida');
                await audience.getByRole('button', { name: /^Compartir$|^Share$/ }).click();
                await expect(staff.getByTestId('contributions-feed').first()).toContainText('Una pregunta de prueba compartida', { timeout: 15_000 });
                await staff.getByRole('textbox').fill('Una respuesta del equipo');
                await staff.getByRole('button', { name: /^Compartir$|^Share$/ }).click();
                await expect(audience.getByTestId('contributions-feed')).toContainText('Una respuesta del equipo', { timeout: 15_000 });
                await expect(audience.getByTestId('contributions-feed')).toContainText(`${staffName} · Operaciones`);

                await audience.getByRole('tab', { name: /Participantes|Participants/ }).click();
                await audience.getByRole('searchbox').fill(staffName);
                await expect(audience.getByRole('tabpanel', { name: /Participantes|Participants/ })).toContainText(staffName);
                await audience.getByRole('tab', { name: /Participantes|Participants/ }).press('Home');
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
                    await expect(audience.getByRole('button', { name: /Salir de la escena|Leave the scene/ })).toBeDisabled();
                    await expect(audience.getByRole('button', { name: /^(?:Salir de la sala|Leave room)$/ })).toBeEnabled();
                    await expect(audience.getByRole('button', { name: /Activar micrófono|Unmute microphone/ })).toBeDisabled();
                }
                await staff.setViewportSize({ width: 320, height: 844 });
                const beforeStaffJump = await room.getByTestId('connection-state').getAttribute('data-state');
                const staffFrame = await staff.locator('[data-testid="persistent-room"]').boundingBox();
                const staffTools = await staff.locator('.hb-staff-tools').boundingBox();
                expect(staffFrame!.y).toBeLessThan(staffTools!.y);
                await staff.getByRole('link', { name: /Ir al panel del equipo|Go to the staff panel/ }).click();
                await expect(staff.getByRole('tab', { name: 'Chat', exact: true })).toBeInViewport();
                await expect(staff.getByRole('alertdialog')).toHaveCount(0);
                await expect(room.getByTestId('connection-state')).toHaveAttribute('data-state', beforeStaffJump!);
                expect(await staff.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(321);
                await staff.getByRole('link', { name: /Volver a mis controles|Back to my controls/ }).click();
                await expect(staff.locator('[data-testid="persistent-room"]')).toBeInViewport();
                await staff.setViewportSize({ width: 1440, height: 1000 });
                await audience.getByRole('button', { name: /Levantar la mano|Raise hand/ }).click();
                await staff.getByRole('tab', { name: /Manos|Hands/ }).click();
                await expect(staff.locator('.hb-spotlight')).toContainText('Ana de prueba', { timeout: 15_000 });
                await testInfo.attach('operator-hands', { body: await staff.screenshot({ fullPage: true }), contentType: 'image/png' });
                await staff.getByRole('tab', { name: /^(?:Escena|Stage)$/ }).click();
                await testInfo.attach('operator-stage', { body: await staff.screenshot({ fullPage: true }), contentType: 'image/png' });
                await staff.setViewportSize({ width: 320, height: 844 });
                await staff.getByRole('link', { name: /Ir al panel del equipo|Go to the staff panel/ }).click();
                await expect(staff.getByRole('tab', { name: /^(?:Escena|Stage)$/ })).toBeInViewport();
                await staff.locator('.hb-staff-tools').scrollIntoViewIfNeeded();
                await testInfo.attach('operator-mobile-tools', { body: await staff.screenshot(), contentType: 'image/png' });
                await staff.setViewportSize({ width: 1440, height: 1000 });
                await staff.getByRole('tab', { name: 'Chat', exact: true }).click();
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

for (const role of ['OPERATOR', 'FACILITATOR'] as const) stackTest(`${role} can enter and leave the stage without automatic capture or losing the room`, async ({ page }, testInfo) => {
    const client = new pg.Client({ connectionString: requireDirectDb(testInfo) });
    await client.connect();
    const eventId = randomUUID();
    const title = 'Staff publication proof';
    try {
        const staffName = role === 'FACILITATOR' ? 'Facilitadora de prueba' : 'Operadora de prueba';
        await loginViaDashboard(page, role, staffName, '/profile');
        const configuration = await page.request.get('/api/ops/events');
        const { facilitators } = await configuration.json();
        const created = await page.request.post('/api/ops/events', {
            headers: { host: 'live-staging.harmonicbeacon.com', origin: 'https://live-staging.harmonicbeacon.com' },
            data: { id: eventId, title, language: 'SPANISH', eventTimeZone: 'UTC',
                scheduledAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
                facilitatorId: (role === 'FACILITATOR' ? facilitators.find((person: { name: string }) => person.name === staffName) : facilitators[0]).id, publicAccess: true, isPublished: false },
        });
        expect(created.status()).toBe(200);
        await client.query("update scheduled_sessions set status='LIVE', started_at=now() where id=$1 and title=$2", [eventId, title]);
        await installMediaProbe(page);
        // Even an operator gets the participant presentation on the public
        // room route: queue the hand without granting publication or capture.
        if (role === 'OPERATOR') {
            await page.goto(`/session/${eventId}`);
            await expect(page.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
            await expect(page.getByRole('tab')).toHaveCount(2);
            await expect(page.locator('.hb-staff-tools')).toHaveCount(0);
            // The separately configured tapestry camera keeps its existing
            // default-on policy. Queueing must not acquire stage devices.
            await expect(page.getByRole('button', { name: /Cambiar a cámara trasera|Switch to rear camera/ })).toBeVisible();
            const beforeHand = await mediaProbeSnapshot(page);
            const [raised] = await Promise.all([
                page.waitForResponse(response => response.url().endsWith(`/api/scheduled-sessions/${eventId}/hand`) && response.request().method() === 'POST'),
                page.getByRole('button', { name: /Levantar la mano|Raise hand/ }).click(),
            ]);
            expect(raised.status()).toBe(200);
            expect(await raised.json()).toMatchObject({ raised: true, canPublish: false });
            await expect(page.getByRole('button', { name: /Activar micrófono|Unmute microphone/i })).toBeDisabled();
            const afterHand = await mediaProbeSnapshot(page);
            expect(afterHand.captureAttempts).toBe(beforeHand.captureAttempts);
            expect(afterHand.audioCaptureAttempts).toBe(0);
            await page.getByRole('button', { name: /Bajar la mano|Lower hand/ }).click();
            await page.getByRole('button', { name: /^(?:Salir de la sala|Leave room)$/ }).click();
            await page.getByRole('alertdialog').getByRole('button', { name: /^(?:Salir de la sala|Leave the room)$/ }).click();
            await expect(page).toHaveURL(new URL('/', page.url()).href);
        }
        await page.goto(`/ops/events/${eventId}`);
        await expect(page.getByTestId('persistent-room')).toBeVisible();
        const room = (await (await page.locator('[data-testid="persistent-room"]').elementHandle())?.contentFrame())!;
        expect(room).not.toBeNull();
        await expect(room.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
        const before = await mediaProbeSnapshot(room);
        if (role === 'OPERATOR') {
            const [grant] = await Promise.all([
                page.waitForResponse(response => response.url().endsWith(`/api/ops/sessions/${eventId}/stage`) && response.request().method() === 'POST'),
                room.getByRole('button', { name: /Habilitar mis controles de equipo|Enable my staff controls/ }).click(),
            ]);
            expect(grant.status()).toBe(200);
        }
        const mic = room.getByRole('button', { name: /Activar micrófono|Unmute microphone/i });
        await expect(mic).toBeVisible();
        await expect(room.getByRole('button', { name: /Encender cámara|Turn camera on/i })).toBeVisible();
        const after = await mediaProbeSnapshot(room);
        expect(after.captureAttempts).toBe(before.captureAttempts);
        expect(after.peerConnectionsClosed).toBe(before.peerConnectionsClosed);
        const token = await page.request.get(`/api/scheduled-sessions/${eventId}/token`);
        const publishingIdentity = await token.json();
        expect(publishingIdentity).toMatchObject({ canPublish: true, isAssignedFacilitator: role === 'FACILITATOR' });
        await mic.click();
        await expect(room.getByRole('button', { name: /Silenciar micrófono|Mute microphone/i })).toBeVisible();
        const leaveStage = room.getByRole('button', { name: /Salir de la escena|Leave the scene/ });
        await expect(leaveStage).toBeEnabled();
        const beforeExit = await mediaProbeSnapshot(room);
        await leaveStage.click();
        const confirmation = room.getByRole('alertdialog');
        await confirmation.getByRole('button', { name: /Sí, dejar la escena|Yes, leave the scene/ }).click();
        await expect(leaveStage).toBeDisabled();
        await expect(mic).toBeDisabled();
        await expect(room.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected');
        // Revocation deliberately fences the old identity and its transports.
        // The page and session remain; transport renewal must not reacquire a device.
        await expect.poll(async () => (await mediaProbeSnapshot(room)).peerConnectionsClosed).toBeGreaterThan(beforeExit.peerConnectionsClosed);
        const audienceToken = await page.request.get(`/api/scheduled-sessions/${eventId}/token`);
        const audienceIdentity = await audienceToken.json();
        expect(audienceIdentity).toMatchObject({ canPublish: false });
        expect(audienceIdentity.identity).not.toBe(publishingIdentity.identity);
        await expect(room.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected');
        expect((await mediaProbeSnapshot(room)).captureAttempts).toBe(beforeExit.captureAttempts);
        await room.getByRole('button', { name: /Habilitar mis controles de equipo|Enable my staff controls/ }).click();
        await expect(mic).toBeEnabled();
    } finally {
        await page.goto('about:blank');
        await client.query('delete from scheduled_sessions where id=$1 and title=$2', [eventId, title]);
        await client.end();
    }
});
