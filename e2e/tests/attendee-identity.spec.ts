import { expect, stackTest } from '../fixtures/stack';
import { loginAttendeeWithTicket, loginViaDashboard } from '../fixtures/auth';
import { requireDirectDb, withSessionStatus } from '../fixtures/db';
import { ROUTES, SESSION_ES, TICKETS } from '../fixtures/test-data';

stackTest('an unconfirmed attendee alias blocks LiveKit until it is corrected, then survives refresh', async ({
    browser,
}, testInfo) => {
    const db = requireDirectDb(testInfo);
    await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
        const context = await browser.newContext();
        const page = await context.newPage();
        try {
            await loginViaDashboard(
                page,
                'ATTENDEE',
                'Participante',
                ROUTES.session(SESSION_ES.id),
                { nameConfirmed: false },
            );

            const input = page.getByRole('textbox', { name: /Tu nombre visible|Your visible name/i });
            await expect(input).toBeVisible();
            await expect(page.getByTestId('connection-state')).toHaveCount(0);
            await input.fill('Anahí 李');
            await page.getByRole('button', { name: /Confirmar y continuar|Confirm and continue/i }).click();

            await expect(page.getByTestId('connection-state')).toHaveAttribute(
                'data-state',
                'connected',
                { timeout: 20_000 },
            );
            await expect(page.getByTestId('viewer-identity')).toContainText('Anahí 李');

            await page.reload();
            await expect(page.getByTestId('connection-state')).toHaveAttribute(
                'data-state',
                'connected',
                { timeout: 20_000 },
            );
            await expect(input).toHaveCount(0);
            await expect(page.getByTestId('viewer-identity')).toContainText('Anahí 李');
        } finally {
            await context.close();
        }
    });
});

stackTest('a second device can correct the stable event alias used by the hand queue', async ({
    browser,
}, testInfo) => {
    stackTest.slow();
    const db = requireDirectDb(testInfo);
    await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
        const firstContext = await browser.newContext();
        const secondContext = await browser.newContext();
        const staffContext = await browser.newContext();
        const first = await firstContext.newPage();
        const second = await secondContext.newPage();
        const staff = await staffContext.newPage();
        try {
            await loginAttendeeWithTicket(first, {
                name: 'Primer nombre',
                email: TICKETS.esBound.email,
                code: TICKETS.esBound.code,
            });
            await expect(first.getByTestId('viewer-identity')).toContainText('Primer nombre', {
                timeout: 20_000,
            });

            await loginAttendeeWithTicket(second, {
                name: 'Anahí 李',
                email: TICKETS.esBound.email,
                code: TICKETS.esBound.code,
            });
            await expect(second.getByTestId('viewer-identity')).toContainText('Anahí 李', {
                timeout: 20_000,
            });

            await loginViaDashboard(
                staff,
                'OPERATOR',
                'Identity Operator',
                ROUTES.opsSession(SESSION_ES.id),
            );
            await staff.locator('[data-signal="hands"]').click();
            await second.getByRole('button', { name: /Levantar la mano|Raise hand/i }).click();

            const queue = staff
                .getByRole('heading', { name: /Fila de manos|Hand queue/i })
                .locator('..');
            const correctedHand = queue.locator('li').filter({ hasText: 'Anahí 李' });
            await expect(correctedHand).toHaveCount(1, {
                timeout: 10_000,
            });
            await expect(queue.locator('li').filter({ hasText: 'Primer nombre' })).toHaveCount(0);
        } finally {
            await firstContext.close();
            await secondContext.close();
            await staffContext.close();
        }
    });
});
