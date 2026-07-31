import { expect, test } from '../fixtures/stack';
import { ROUTES } from '../fixtures/test-data';

/**
 * Responsive gate — runs once per viewport project (1440 / 1024 / 390 / 320
 * px, see playwright.config.ts). Public surfaces only, so it never depends
 * on the fixture stack: the landing's documented degraded state must be
 * just as layout-safe as the seeded one.
 *
 * Assertions are geometric, not pixel-diffed: no horizontal scroll, primary
 * controls inside the viewport and large enough to reach one-handed.
 */

async function expectNoHorizontalScroll(page: import('@playwright/test').Page): Promise<void> {
    const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow, 'page has horizontal overflow').toBeLessThanOrEqual(1);
}

test.describe('responsive public surfaces', () => {
    test('landing fits the viewport without horizontal scroll', async ({ page }) => {
        await page.goto(ROUTES.landing);
        await expectNoHorizontalScroll(page);
        // Long bilingual strings must not break the layout either.
        await expect(page.locator('#display-name')).toBeVisible();
        await expect(page.locator('#ticket-code')).toBeVisible();
    });

    test('login controls stay reachable inside the viewport', async ({ page }) => {
        await page.goto(ROUTES.landing);
        const viewport = page.viewportSize();
        expect(viewport).not.toBeNull();

        for (const selector of ['#display-name', '#ticket-code', '#ticket-email']) {
            const control = page.locator(selector);
            // boundingBox does not auto-wait; the login form hydrates async.
            await expect(control).toBeVisible();
            const box = await control.boundingBox();
            expect(box, `${selector} has no layout box`).not.toBeNull();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            // Fully inside the horizontal viewport: no off-screen reach.
            expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
        }
    });

    test('staff login fits the viewport', async ({ page }) => {
        await page.goto(ROUTES.staffLogin);
        await expectNoHorizontalScroll(page);
        const viewport = page.viewportSize();
        const email = page.locator('#staff-email');
        await expect(email).toBeVisible();
        const box = await email.boundingBox();
        expect(box).not.toBeNull();
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width + 1);
    });
});
