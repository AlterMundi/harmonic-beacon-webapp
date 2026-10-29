import { loginViaDashboard } from '../fixtures/auth';
import { requireDirectDb, withSessionStatus } from '../fixtures/db';
import { expect, stackTest } from '../fixtures/stack';
import { SESSION_ES, ROUTES } from '../fixtures/test-data';

stackTest('waiting room offers device checks without the retired listening explanation', async ({ page }, testInfo) => {
    await withSessionStatus(requireDirectDb(testInfo), SESSION_ES.id, 'SCHEDULED', async () => {
        await loginViaDashboard(page, 'ATTENDEE', 'Waiting fixture', ROUTES.session(SESSION_ES.id));
        await expect(page.getByTestId('session-guidance')).toHaveCount(0);
        await expect(page.getByRole('link', { name: /Probar micrófono, cámara y sonido|Check microphone, camera and sound/ })).toHaveAttribute('href', `/devices?next=${encodeURIComponent(ROUTES.session(SESSION_ES.id))}`);
    });
});

stackTest('operator room sizes connected content and keeps the controls stable as the tapestry refreshes', async ({ page }, testInfo) => {
    await withSessionStatus(requireDirectDb(testInfo), SESSION_ES.id, 'LIVE', async () => {
        await loginViaDashboard(page, 'OPERATOR', 'Size fixture', ROUTES.opsSession(SESSION_ES.id));
        const frame = page.frameLocator('[data-testid="persistent-room"]');
        await expect(frame.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
        await expect(frame.getByTestId('session-guidance')).toHaveCount(0);
        await expect.poll(async () => page.locator('[data-testid="persistent-room"]').evaluate((element: HTMLIFrameElement) => {
            const content = element.contentDocument?.querySelector('.hb-room-shell');
            return content ? Math.abs(element.getBoundingClientRect().height - content.getBoundingClientRect().height) : 10000;
        })).toBeLessThan(2);
        const controls = frame.locator('.hb-room-controls');
        const before = await controls.boundingBox();
        await expect(frame.getByRole('img', { name: /Último tapiz|Latest tapestry/ })).toBeVisible({ timeout: 20_000 });
        const after = await controls.boundingBox();
        expect(after!.y).toBeCloseTo(before!.y, 0);
        expect(after!.height).toBeCloseTo(before!.height, 0);
    });
});
