import { AxeBuilder } from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

import { expect, stackTest, test } from '../fixtures/stack';
import { loginViaDashboard } from '../fixtures/auth';
import { requireDirectDb, withSessionStatus } from '../fixtures/db';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';

/**
 * Accessibility gate (issue #69, epic #64 rubric §6 "Reach").
 *
 * axe runs WCAG 2.0/2.1 A+AA on each key surface. The gate fails on any
 * `critical` or `serious` violation; `moderate`/`minor` findings are
 * attached to the test report as evidence without failing, so the gate is
 * strict where it protects people and informative elsewhere.
 *
 * No WCAG AA rule is excluded. In particular, translucent nocturnal surfaces
 * are measured in their rendered context by axe's color-contrast rule.
 */

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

async function assertAccessible(page: Page, surface: string, testInfo: TestInfo): Promise<void> {
    const results = await new AxeBuilder({ page })
        .withTags(WCAG_TAGS)
        .analyze();

    const blocking = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    const advisory = results.violations.filter(
        (v) => v.impact === 'moderate' || v.impact === 'minor',
    );

    await testInfo.attach(`${surface}-axe-advisory`, {
        body: JSON.stringify(advisory, null, 2),
        contentType: 'application/json',
    });

    expect(
        blocking,
        `${surface} has ${blocking.length} critical/serious axe violation(s):\n` +
            blocking
                .map(
                    (v) =>
                        `- [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s)) — ${v.helpUrl}`,
                )
                .join('\n'),
    ).toEqual([]);
}

test.describe('public surfaces', () => {
    test('landing is accessible', async ({ page }, testInfo) => {
        await page.goto(ROUTES.landing);
        await assertAccessible(page, 'landing', testInfo);
    });

    test('landing is accessible under reduced motion', async ({ browser }, testInfo) => {
        const context = await browser.newContext({ reducedMotion: 'reduce' });
        const page = await context.newPage();
        await page.goto(ROUTES.landing);
        // The emulation must actually reach the page, then axe re-runs.
        const prefersReduced = await page.evaluate(() =>
            window.matchMedia('(prefers-reduced-motion: reduce)').matches,
        );
        expect(prefersReduced).toBe(true);
        const motion = await page.locator('.animate-portal-orbit').first().evaluate((element) => {
            const style = getComputedStyle(element);
            return { animationName: style.animationName, transitionDuration: style.transitionDuration };
        });
        expect(motion.animationName).toBe('none');
        const transitionMs = motion.transitionDuration.endsWith('ms')
            ? Number.parseFloat(motion.transitionDuration)
            : Number.parseFloat(motion.transitionDuration) * 1_000;
        expect(transitionMs).toBeLessThanOrEqual(0.01);
        await assertAccessible(page, 'landing-reduced-motion', testInfo);
        await context.close();
    });

    test('staff login is accessible', async ({ page }, testInfo) => {
        await page.goto(ROUTES.staffLogin);
        await assertAccessible(page, 'staff-login', testInfo);
    });
});

stackTest.describe('role surfaces', () => {
    stackTest('attendee session shell is accessible', async ({ page }, testInfo) => {
        // Doors open so the attendee reaches the real shell; without LiveKit
        // the deterministic connection-error card is checked instead.
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
            await assertAccessible(page, 'attendee-session', testInfo);
        });
    });

    stackTest('operator admission console is accessible', async ({ page }, testInfo) => {
        await loginViaDashboard(page, 'OPERATOR', 'E2E Operator', ROUTES.opsAdmission);
        await assertAccessible(page, 'ops-admission', testInfo);
    });

    stackTest('facilitator session console is accessible', async ({ page }, testInfo) => {
        await loginViaDashboard(
            page,
            'FACILITATOR',
            'E2E Facilitator',
            ROUTES.opsSession(SESSION_ES.id),
        );
        await expect(page.getByText(SESSION_ES.title)).toBeVisible();
        await assertAccessible(page, 'ops-session-console', testInfo);

        for (const [name, selector] of [
            ['doors', '[data-signal="door"]'],
            ['scene', '[data-signal="hands"]'],
            ['tapestry', '[data-tool="tapestry"]'],
            ['admission', '[data-tool="admission"]'],
            ['health', '[data-signal="health"]'],
        ] as const) {
            await page.locator(selector).click();
            await expect(page.getByRole('dialog')).toBeVisible();
            await assertAccessible(page, `ops-session-${name}-drawer`, testInfo);
            await page.keyboard.press('Escape');
            await expect(page.getByRole('dialog')).toBeHidden();
        }
    });
});
