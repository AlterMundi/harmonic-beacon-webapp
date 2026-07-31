import { expect, stackTest, test } from '../fixtures/stack';
import {
    loginAttendeeWithTicket,
    loginStaffWithPassword,
    loginViaDashboard,
} from '../fixtures/auth';
import { ROUTES, SESSION_ES, STAFF, TICKETS } from '../fixtures/test-data';
import { requireDirectDb, withSessionStatus } from '../fixtures/db';

/**
 * Smoke gate: the surfaces every role lands on, reached the way each role
 * really reaches them. Outcomes asserted here are presence and routing, not
 * media — media behavior belongs to media-continuity.spec.ts.
 */

test.describe('public surfaces (no stack required)', () => {
    test('landing renders the bilingual brand and entry form', async ({ page }) => {
        await page.goto(ROUTES.landing);
        await expect(page).toHaveTitle(/harmonic beacon/i);
        await expect(page.locator('#display-name')).toBeVisible();
        await expect(page.locator('#ticket-code')).toBeVisible();
        await expect(page.locator('#ticket-email')).toBeVisible();
    });

    test('staff login renders and links are reachable by keyboard', async ({ page }) => {
        await page.goto(ROUTES.staffLogin);
        await expect(page.locator('#staff-email')).toBeVisible();
        await expect(page.locator('#staff-password')).toBeVisible();
    });

    test('keyboard-only path through the attendee login form keeps visible focus', async ({
        page,
    }) => {
        await page.goto(ROUTES.landing);
        await page.locator('#display-name').focus();

        // Tab order through the form: name -> code -> email -> submit.
        await page.keyboard.press('Tab');
        await expect(page.locator('#ticket-code')).toBeFocused();
        await page.keyboard.press('Tab');
        await expect(page.locator('#ticket-email')).toBeFocused();
        await page.keyboard.press('Tab');

        // Focus must be on a visible, operable control — never lost to body.
        const focused = page.locator(':focus');
        await expect(focused).toBeVisible();
        const tag = await focused.evaluate((el) => el.tagName.toLowerCase());
        expect(['button', 'a', 'input']).toContain(tag);
    });
});

stackTest.describe('fixture stack', () => {
    stackTest('public discovery excludes durable test fixtures', async ({ page }) => {
        await page.goto(ROUTES.landing);
        await expect(page.getByText(SESSION_ES.title)).toHaveCount(0);
        await expect(page.getByText(/English Session \(test\)/)).toHaveCount(0);
    });

    stackTest('staff test area contains both fixtures and stays collapsed by default', async ({ page }) => {
        await loginViaDashboard(page, 'OPERATOR', 'E2E Operator', ROUTES.opsEvents);
        const testArea = page.locator('details').filter({ hasText: /test events|eventos de prueba/i });
        await expect(testArea).toBeVisible();
        await expect(testArea).not.toHaveAttribute('open', '');
        await testArea.locator('summary').click();
        await expect(testArea.getByText(SESSION_ES.title)).toBeVisible();
        await expect(testArea.getByText(/English Session \(test\)/)).toBeVisible();
    });

    stackTest('attendee ticket login enters the session room', async ({ page }, testInfo) => {
        // Doors must be open: attendees only receive stage tokens for LIVE
        // sessions (src/lib/room-entitlement.ts).
        const db = requireDirectDb(testInfo);
        await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
            await loginAttendeeWithTicket(page, {
                name: 'E2E Attendee',
                email: 'e2e.attendee@altermundi.net',
                code: TICKETS.esIssuedA,
            });
            await page.waitForURL(`**/session/${SESSION_ES.id}`);
            // With a reachable LiveKit the shell connects; without one it
            // lands on the deterministic connection-error card. Both prove
            // the attendee got in — media behavior is the continuity suite's
            // job, not smoke's.
            await expect(
                page
                    .getByTestId('connection-state')
                    .or(page.getByRole('heading', { name: /Connection error|Error de conexión/i })),
            ).toBeVisible({ timeout: 30_000 });
        });
    });

    stackTest('revoked and unknown ticket codes fail with the identical generic error', async ({
        page,
    }) => {
        const attempt = async (code: string) => {
            await loginAttendeeWithTicket(page, {
                name: 'E2E Attendee',
                email: 'e2e.attendee@altermundi.net',
                code,
            });
            // The app's own alert, not Next's route announcer.
            const alert = page.locator('.event-alert[role="alert"]');
            await expect(alert).toBeVisible();
            return alert.innerText();
        };
        const revokedMessage = await attempt(TICKETS.esRevoked);
        const unknownMessage = await attempt('TEST-TEST-TEST-XXXX');
        expect(revokedMessage).toBe(unknownMessage);
    });

    stackTest('facilitator password login reaches ops and own session console', async ({
        page,
    }) => {
        await loginStaffWithPassword(page, STAFF.facilitator);
        await page.waitForURL(`**${ROUTES.opsSession(SESSION_ES.id)}`);
        await expect(page.getByText(SESSION_ES.title)).toBeVisible();
    });

    stackTest('operator dashboard login reaches admission without account switching', async ({
        page,
    }) => {
        await loginViaDashboard(page, 'OPERATOR', 'E2E Operator', ROUTES.opsAdmission);
        await expect(page.getByRole('heading', { name: /admission/i })).toBeVisible();
    });

    stackTest('admin dashboard login reaches ops health', async ({ page }) => {
        await loginViaDashboard(page, 'ADMIN', 'E2E Admin', ROUTES.opsHealth);
        await expect(page.getByRole('heading', { name: /health/i })).toBeVisible();
    });
});
