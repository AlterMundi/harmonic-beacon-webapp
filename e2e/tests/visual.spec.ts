import { expect, stackTest } from '../fixtures/stack';
import { ROUTES } from '../fixtures/test-data';

/**
 * Visual regression gate — intentional screenshot baselines at 1440 / 1024 /
 * 390 / 320 px (the viewport projects in playwright.config.ts).
 *
 * Only static public surfaces are screenshotted, against the seeded test
 * fixture, so baselines contain deterministic fixture data — never real
 * participant data or imagery — and no time-based content. Animations are
 * disabled and a 1% pixel tolerance absorbs font rasterization noise on a
 * single runner (see `expect.toHaveScreenshot` in playwright.config.ts).
 *
 * Baselines are blessed intentionally: regenerate with
 * `npm run test:e2e:update-snapshots` on the reference environment and
 * review the diff before committing. See e2e/README.md.
 */

stackTest.describe('visual baselines', () => {
    stackTest('landing', async ({ page }) => {
        await page.goto(ROUTES.landing);
        await expect(page.locator('#ticket-code')).toBeVisible();
        await expect(page).toHaveScreenshot('landing.png', { fullPage: true });
    });

    stackTest('staff login', async ({ page }) => {
        await page.goto(ROUTES.staffLogin);
        await expect(page.locator('#staff-email')).toBeVisible();
        await expect(page).toHaveScreenshot('staff-login.png');
    });
});
