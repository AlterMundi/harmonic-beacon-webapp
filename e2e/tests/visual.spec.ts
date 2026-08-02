import { expect, stackTest } from '../fixtures/stack';
import { loginViaDashboard } from '../fixtures/auth';
import { requireDirectDb, withSessionStatus } from '../fixtures/db';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';

const NOMINAL_CHECK = { status: 'green', detail: 'Nominal fixture', latencyMs: 1 } as const;
const NOMINAL_HEALTH = {
    status: 'green',
    checkedAt: '2026-08-01T14:00:00.000Z',
    session: { id: SESSION_ES.id, title: SESSION_ES.title, status: 'SCHEDULED' },
    checks: {
        postgres: NOMINAL_CHECK,
        livekit: NOMINAL_CHECK,
        stageRoom: NOMINAL_CHECK,
        publisherGrants: NOMINAL_CHECK,
        bedPublisher: NOMINAL_CHECK,
        tapestry: NOMINAL_CHECK,
    },
};

/**
 * Visual regression gate — intentional screenshot baselines at 1440 / 1024 /
 * 390 / 320 px (the viewport projects in playwright.config.ts).
 *
 * Public and fixture-only role surfaces are captured. Baselines contain no
 * real participant data or imagery. Animations are disabled and a 1% pixel
 * tolerance absorbs font rasterization noise on a single runner (see
 * `expect.toHaveScreenshot` in playwright.config.ts).
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

    stackTest('attendee audio prompt', async ({ page }, testInfo) => {
        const db = requireDirectDb(testInfo);
        await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
            await loginViaDashboard(
                page,
                'ATTENDEE',
                'E2E Attendee',
                ROUTES.session(SESSION_ES.id),
            );
            await expect(page.getByTestId('connection-state')).toHaveAttribute(
                'data-state',
                'connected',
                { timeout: 20_000 },
            );
            await expect(page.getByRole('button', { name: /Start audio|Iniciar audio/i })).toBeVisible();
            // Camera acquisition is asynchronous. Wait for the complete
            // mobile camera control instead of snapshotting an intermediate
            // state that races between "share" and "stop/switch" controls.
            await expect(page.getByRole('button', {
                name: /Switch to rear camera|Cambiar a cámara trasera/i,
            })).toBeVisible();
            await expect(page).toHaveScreenshot('attendee-audio-prompt.png', {
                mask: [page.getByTestId('connection-state').locator('..')],
                maskColor: '#07120f',
            });
        });
    });

    stackTest('conductor cockpit', async ({ page }) => {
        await page.route('**/api/ops/health**', (route) => route.fulfill({ json: NOMINAL_HEALTH }));
        await loginViaDashboard(
            page,
            'FACILITATOR',
            'E2E Facilitator',
            ROUTES.opsSession(SESSION_ES.id),
        );
        await expect(page.getByTestId('conductor-cockpit')).toBeVisible();
        await expect(page.locator('[data-signal="stage"]')).toHaveAttribute('data-loaded', 'true');
        await expect(page.locator('[data-signal="health"]')).toContainText('green', { timeout: 15_000 });
        await expect(page).toHaveScreenshot('conductor-cockpit.png', {
            fullPage: true,
            mask: [
                page
                    .frameLocator('iframe[data-testid="persistent-room"]')
                    .getByTestId('connection-state')
                    .locator('..'),
            ],
            maskColor: '#07120f',
        });
    });
});
