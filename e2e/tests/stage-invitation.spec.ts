import { randomUUID } from 'node:crypto';
import { expect, stackTest } from '../fixtures/stack';
import { loginViaDashboard } from '../fixtures/auth';
import { requireDirectDb, withSessionStatus } from '../fixtures/db';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';

/**
 * Complete consent journey with two real browser identities and real LiveKit:
 * hand → staff invitation → decline, then hand → invite → reload → accept →
 * return. The reload reproduces a fresh LiveKit connection holding a durable
 * grant: it must remain pending rather than becoming a phantom stage member.
 * Device access is only expected after the attendee's explicit accept click.
 */
stackTest('a fresh connection stays invited until the attendee accepts the stage invitation', async ({
    browser,
}, testInfo) => {
    stackTest.slow();
    const db = requireDirectDb(testInfo);
    const attendeeName = `Participante de prueba ${randomUUID().slice(0, 6)}`;
    await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
        const attendeeContext = await browser.newContext();
        const staffContext = await browser.newContext();
        const attendee = await attendeeContext.newPage();
        const staff = await staffContext.newPage();

        try {
            await loginViaDashboard(
                attendee,
                'ATTENDEE',
                attendeeName,
                ROUTES.session(SESSION_ES.id),
            );
            await expect(attendee.getByTestId('connection-state')).toHaveAttribute(
                'data-state',
                'connected',
                { timeout: 20_000 },
            );

            await loginViaDashboard(
                staff,
                'OPERATOR',
                'Journey Operator',
                ROUTES.opsSession(SESSION_ES.id),
            );
            await staff.locator('[data-signal="hands"]').click();
            const drawer = staff.locator('.hb-staff-tools > aside');

            const raiseHand = attendee.getByRole('button', { name: /Raise hand|Levantar la mano/i });
            await raiseHand.click();
            const queueRow = drawer.locator('li').filter({ hasText: attendeeName });
            await expect(queueRow.getByRole('button', { name: /Give floor|Dar la palabra/i })).toBeEnabled({
                timeout: 10_000,
            });
            await queueRow.getByRole('button', { name: /Give floor|Dar la palabra/i }).scrollIntoViewIfNeeded();
            await staff.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
            await testInfo.attach('facilitator-hands', { body: await staff.screenshot({ fullPage: true }), contentType: 'image/png' });
            await attendee.setViewportSize({ width: 390, height: 844 });
            await testInfo.attach('participant-hand-camera-mobile', { body: await attendee.locator('.hb-room-controls').screenshot(), contentType: 'image/png' });
            await queueRow.getByRole('button', { name: /Give floor|Dar la palabra/i }).click();

            const invitation = attendee.getByRole('dialog', {
                name: /invited into the scene|invitan a entrar en escena/i,
            });
            await expect(invitation).toBeVisible({ timeout: 10_000 });
            await expect(attendee.getByRole('button', { name: /^(?:Turn camera off|Apagar (?:la )?cámara)$/i }))
                .toHaveCount(0);
            await invitation.getByRole('button', { name: /Not now|Ahora no/i }).click();
            await expect(invitation).toBeHidden();
            await expect(raiseHand).toBeVisible({ timeout: 10_000 });

            await raiseHand.click();
            await expect(queueRow.getByRole('button', { name: /Give floor|Dar la palabra/i })).toBeEnabled({
                timeout: 10_000,
            });
            await queueRow.getByRole('button', { name: /Give floor|Dar la palabra/i }).click();
            await expect(invitation).toBeVisible({ timeout: 10_000 });

            const pendingRow = drawer.locator('li').filter({ hasText: attendeeName });
            await expect(pendingRow.getByRole('button', { name: /Cancel invitation|Cancelar invitación/i })).toBeVisible({
                timeout: 10_000,
            });
            await expect(pendingRow.getByRole('button', { name: /Take floor|Quitar la palabra/i })).toHaveCount(0);

            await attendee.reload();
            await expect(attendee.getByTestId('connection-state')).toHaveAttribute(
                'data-state',
                'connected',
                { timeout: 20_000 },
            );
            await expect(invitation).toBeVisible({ timeout: 10_000 });
            await expect(pendingRow.getByRole('button', { name: /Cancel invitation|Cancelar invitación/i })).toBeVisible({
                timeout: 10_000,
            });
            await expect(pendingRow.getByRole('button', { name: /Take floor|Quitar la palabra/i })).toHaveCount(0);

            await invitation.getByRole('button', { name: /Accept and join|Aceptar y entrar/i }).click();

            await expect(
                attendee.getByRole('button', { name: /^(?:Turn camera off|Apagar (?:la )?cámara)$/i }),
            ).toBeVisible({ timeout: 15_000 });
            await expect(
                attendee.getByRole('button', { name: /Mute microphone|Silenciar micrófono/i }),
            ).toBeVisible();

            // The published camera track must be replaceable in place. This
            // exercises the real LiveKit SDK and fake capture device: the
            // attendee remains in the same room and the microphone stays on.
            await attendee.getByRole('button', {
                name: /Switch to rear camera|Cambiar a cámara trasera/i,
            }).click();
            await expect(attendee.getByRole('button', {
                name: /Switch to front camera|Cambiar a cámara frontal/i,
            })).toBeVisible({ timeout: 15_000 });
            await expect(
                attendee.getByRole('button', { name: /Mute microphone|Silenciar micrófono/i }),
            ).toBeVisible();
            await expect(attendee.getByTestId('connection-state')).toHaveAttribute(
                'data-state',
                'connected',
            );

            await staff.getByRole('tab', { name: /^(?:Escena|Stage)$/ }).click();
            const stageRow = drawer.locator('li').filter({ hasText: attendeeName });
            await expect(stageRow.getByRole('button', { name: /Take floor|Quitar la palabra/i })).toBeVisible({
                timeout: 10_000,
            });
            for (const width of [1440, 390, 320]) {
                await staff.setViewportSize({ width, height: 900 });
                expect(await staff.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
                const tools = staff.locator('.hb-staff-tools > aside');
                expect(await tools.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
                if (width > 900) {
                    const box = await tools.boundingBox();
                    expect(box!.height).toBeLessThanOrEqual(650);
                } else {
                    // On phones the panel follows the room in one page flow,
                    // without a second scrolling region. Its stage action must
                    // remain reachable through ordinary page scrolling.
                    expect(await tools.evaluate(element => getComputedStyle(element).overflowY)).toBe('visible');
                    const remove = stageRow.getByRole('button', { name: /Take floor|Quitar la palabra/i });
                    await remove.scrollIntoViewIfNeeded();
                    await expect(remove).toBeInViewport({ ratio: 1 });
                    expect((await remove.boundingBox())!.height).toBeGreaterThanOrEqual(44);
                }
            }
            await staff.setViewportSize({ width: 1440, height: 900 });
            await stageRow.getByRole('button', { name: /Take floor|Quitar la palabra/i }).scrollIntoViewIfNeeded();
            await staff.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
            await testInfo.attach('facilitator-stage', { body: await staff.screenshot({ fullPage: true }), contentType: 'image/png' });

            // The attendee owns the return transition. It revokes publishing
            // without leaving the page or requiring a new audio activation.
            // Grant fencing renews the transports; session exit is separate.
            await attendee.getByRole('button', { name: /Leave the scene|Salir de la escena/i }).click();
            const leaveConfirmation = attendee.getByRole('alertdialog', {
                name: /Return to the audience|volver al público/i,
            });
            await expect(leaveConfirmation).toContainText(/stay in the room|seguir en la sala/i);
            await leaveConfirmation.getByRole('button', {
                name: /Yes, leave the scene|Sí, dejar la escena/i,
            }).click();

            await expect(
                attendee.getByRole('button', { name: /^(?:Turn camera off|Apagar (?:la )?cámara)$/i }),
            ).toHaveCount(0, { timeout: 10_000 });
            await expect(attendee.getByTestId('connection-state')).toHaveAttribute(
                'data-state',
                'connected',
            );
            await expect(attendee.getByRole('button', { name: /Raise hand|Levantar la mano/i })).toBeVisible({
                timeout: 10_000,
            });
            await expect(stageRow.getByRole('button', { name: /Take floor|Quitar la palabra/i })).toHaveCount(0, {
                timeout: 10_000,
            });
        } finally {
            await attendeeContext.close();
            await staffContext.close();
        }
    });
});
