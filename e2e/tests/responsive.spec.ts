import { expect, stackTest, test } from '../fixtures/stack';
import { loginViaDashboard } from '../fixtures/auth';
import { requireDirectDb, withSessionStatus, withSessionTitles } from '../fixtures/db';
import { ROUTES, SESSION_EN, SESSION_ES } from '../fixtures/test-data';

const LONG_ES_TITLE = 'Viaje colectivo hacia el bosque interior y las imágenes que todavía nos acompañan';
const LONG_EN_TITLE = 'A collective journey through the inner forest and the images that still travel with us';

/**
 * Responsive gate — runs once per viewport project (1440 / 1024 / 768 / 390 / 320
 * px, see playwright.config.ts). Public surfaces only, so it never depends
 * on the fixture stack: the landing's documented degraded state must be
 * just as layout-safe as the seeded one.
 *
 * Assertions are geometric, not pixel-diffed: no horizontal scroll, primary
 * controls inside the viewport and large enough to reach one-handed.
 */

async function expectNoHorizontalScroll(page: import('@playwright/test').Page): Promise<void> {
    const viewport = page.viewportSize();
    expect(viewport, 'page has no configured viewport').not.toBeNull();
    const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(documentWidth, 'document expands beyond the configured viewport')
        .toBeLessThanOrEqual(viewport!.width + 1);
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

stackTest.describe('responsive live surfaces', () => {
    stackTest('event health keeps long operational paths in the viewport', async ({ page }) => {
        const check = { status: 'green', detail: 'Nominal fixture', latencyMs: 1 } as const;
        await page.route('**/api/ops/health**', (route) => route.fulfill({
            json: {
                status: 'yellow',
                checkedAt: '2026-08-01T14:00:00.000Z',
                session: null,
                checks: {
                    postgres: check,
                    livekit: check,
                    stageRoom: check,
                    publisherGrants: check,
                    bedPublisher: check,
                    tapestry: check,
                },
            },
        }));
        await loginViaDashboard(page, 'FACILITATOR_OP', 'E2E Conductor', ROUTES.opsHealth);
        await expect(page.getByText('docs/ops/WEEKEND_EVENT_RUNBOOK.md')).toBeVisible();
        await expectNoHorizontalScroll(page);
    });

    stackTest('attendee shell never overflows and keeps room controls reachable', async ({ page }, testInfo) => {
        const db = requireDirectDb(testInfo);
        await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
            await loginViaDashboard(
                page,
                'ATTENDEE',
                'E2E Attendee',
                ROUTES.session(SESSION_ES.id),
            );
            await expect(
                page
                    .getByTestId('connection-state')
                    .or(page.getByRole('heading', { name: /Connection error|Error de conexión/i })),
            ).toBeVisible({ timeout: 30_000 });
            await expectNoHorizontalScroll(page);

            const startAudio = page.getByRole('button', { name: /Start audio|Iniciar audio/i });
            if (await startAudio.count()) {
                const box = await startAudio.boundingBox();
                expect(box).not.toBeNull();
                expect(box!.height).toBeGreaterThanOrEqual(44);
                expect(box!.x).toBeGreaterThanOrEqual(0);
                expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
            }

            const stopTapestry = page.getByRole('button', {
                name: /Stop sharing your camera with the tapestry|Dejar de compartir la cámara con el tapiz/i,
            });
            if (await stopTapestry.count()) {
                await stopTapestry.click();
                const optIn = page.getByRole('button', {
                    name: /Share a camera snapshot|Compartir una imagen de cámara/i,
                });
                await expect(optIn).toBeVisible();
                const optInBox = await optIn.boundingBox();
                expect(optInBox).not.toBeNull();
                expect(optInBox!.height).toBeGreaterThanOrEqual(44);
            }
        });
    });

    stackTest('long ES/EN event titles remain complete and in-bounds', async ({ page }, testInfo) => {
        const db = requireDirectDb(testInfo);
        await withSessionTitles(db, [
            { id: SESSION_ES.id, title: LONG_ES_TITLE },
            { id: SESSION_EN.id, title: LONG_EN_TITLE },
        ], async () => {
            await loginViaDashboard(page, 'OPERATOR', 'E2E Operator', ROUTES.opsEvents);
            await page
                .locator('details')
                .filter({ hasText: /Eventos de prueba|Test events/i })
                .locator('summary')
                .click();
            await expectNoHorizontalScroll(page);

            for (const title of [LONG_ES_TITLE, LONG_EN_TITLE]) {
                const heading = page.getByRole('heading', { name: title });
                await expect(heading).toBeVisible();
                await expect(heading).toHaveCSS('text-overflow', 'clip');
                const box = await heading.boundingBox();
                expect(box, `${title} has no layout box`).not.toBeNull();
                expect(box!.x).toBeGreaterThanOrEqual(0);
                expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
            }
        });
    });

    stackTest('conductor cockpit keeps all five signals in-bounds and touchable', async ({ page }) => {
        await loginViaDashboard(
            page,
            'FACILITATOR',
            'E2E Facilitator',
            ROUTES.opsSession(SESSION_ES.id),
        );
        await expect(page.getByTestId('conductor-cockpit')).toBeVisible();
        await expectNoHorizontalScroll(page);

        for (const signal of ['door', 'hands', 'stage', 'primary', 'health']) {
            const control = page.locator(`[data-signal="${signal}"]`);
            await control.scrollIntoViewIfNeeded();
            const box = await control.boundingBox();
            expect(box, `${signal} has no layout box`).not.toBeNull();
            expect(box!.height).toBeGreaterThanOrEqual(44);
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
            expect(box!.y).toBeGreaterThanOrEqual(0);
            expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
        }

        for (const selector of [
            '[data-signal="door"]',
            '[data-signal="hands"]',
            '[data-tool="tapestry"]',
            '[data-tool="admission"]',
            '[data-tool="contributions"]',
            '[data-signal="health"]',
        ]) {
            await page.locator(selector).click();
            const dialog = page.getByRole('dialog');
            await expect(dialog).toBeVisible();
            const box = await dialog.boundingBox();
            expect(box, `${selector} drawer has no layout box`).not.toBeNull();
            expect(box!.x).toBeGreaterThanOrEqual(0);
            expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);

            const buttons = dialog.locator('button:visible');
            for (let index = 0; index < await buttons.count(); index += 1) {
                const buttonBox = await buttons.nth(index).boundingBox();
                expect(buttonBox, `${selector} button ${index} has no layout box`).not.toBeNull();
                expect(buttonBox!.height).toBeGreaterThanOrEqual(44);
                expect(buttonBox!.x).toBeGreaterThanOrEqual(0);
                expect(buttonBox!.x + buttonBox!.width)
                    .toBeLessThanOrEqual(page.viewportSize()!.width + 1);
            }
            await page.keyboard.press('Escape');
            await expect(dialog).toBeHidden();
        }
    });
});
