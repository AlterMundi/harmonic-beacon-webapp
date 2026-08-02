import { expect, stackTest } from '../fixtures/stack';
import { loginViaDashboard } from '../fixtures/auth';
import { requireDirectDb, withSessionStatus } from '../fixtures/db';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';

/**
 * The operational kill path against real browsers, the fixture database and
 * a real LiveKit server. This proves more than a durable ENDED flag: connected
 * Stage and Beacon clients are expelled and render the terminal state.
 */
stackTest('ending an event immediately disconnects every selected-session client', async ({
    browser,
}, testInfo) => {
    stackTest.slow();
    const db = requireDirectDb(testInfo);
    await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
        const attendeeContext = await browser.newContext();
        const operatorContext = await browser.newContext();
        const attendee = await attendeeContext.newPage();
        const operator = await operatorContext.newPage();

        try {
            await loginViaDashboard(
                attendee,
                'ATTENDEE',
                'Termination Attendee',
                ROUTES.session(SESSION_ES.id),
            );
            await expect(attendee.getByTestId('connection-state')).toHaveAttribute(
                'data-state',
                'connected',
                { timeout: 20_000 },
            );

            await loginViaDashboard(
                operator,
                'OPERATOR',
                'Termination Operator',
                ROUTES.opsSession(SESSION_ES.id),
            );
            const room = operator.frameLocator('[data-testid="persistent-room"]');
            await expect(room.getByTestId('connection-state')).toHaveAttribute(
                'data-state',
                'connected',
                { timeout: 20_000 },
            );

            await operator.locator('[data-signal="door"]').click();
            await operator.getByRole('button', { name: /Close event|Cerrar evento/i }).click();
            await expect(operator.getByRole('alertdialog')).toContainText(
                /Other events and the Beacon source stay online|Los demás eventos y la fuente del Beacon siguen en línea/i,
            );
            await operator.getByRole('button', {
                name: /End & disconnect everyone|Finalizar y desconectar/i,
            }).click();

            await expect(operator.getByRole('status')).toContainText(
                /Disconnected [1-9]\d* Stage and [1-9]\d* Beacon connections|Se desconectaron [1-9]\d* conexiones de Escena y [1-9]\d* del Beacon/i,
            );
            await expect(attendee.getByRole('heading', {
                name: /Session ended|La sesión terminó/i,
            })).toBeVisible({ timeout: 10_000 });
            await expect(room.getByRole('heading', {
                name: /Session ended|La sesión terminó/i,
            })).toBeVisible({ timeout: 10_000 });
        } finally {
            await attendeeContext.close();
            await operatorContext.close();
        }
    });
});
