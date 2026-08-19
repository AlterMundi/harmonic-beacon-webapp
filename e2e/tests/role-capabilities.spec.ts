import type { Browser, Page } from '@playwright/test';

import {
    loginAttendeeWithTicket,
    loginViaDashboard,
    type DashboardRole,
} from '../fixtures/auth';
import {
    requireDirectDb,
    withFixtureStaffRole,
    withPreservedFixtureStaff,
    withSessionStatus,
} from '../fixtures/db';
import { expect, stackTest } from '../fixtures/stack';
import { ROUTES, SESSION_EN, SESSION_ES, STAFF, TICKETS } from '../fixtures/test-data';

type StaffDashboardRole = Exclude<DashboardRole, 'ATTENDEE'>;
type UiLocale = 'es' | 'en';

const ROLE_NAMES: Record<StaffDashboardRole, string> = {
    FACILITATOR: 'E2E Fede',
    FACILITATOR_OP: 'E2E Conductor',
    OPERATOR: 'E2E Support',
    ADMIN: 'E2E Steward',
};

async function setLocale(page: Page, locale: UiLocale): Promise<void> {
    await page.goto(`/?lang=${locale}`);
    await page.waitForFunction((expectedLocale) => (
        document.documentElement.lang === expectedLocale
        && new URL(window.location.href).searchParams.has('lang') === false
    ), locale);
}

async function withPage<T>(browser: Browser, run: (page: Page) => Promise<T>): Promise<T> {
    const context = await browser.newContext();
    try {
        return await run(await context.newPage());
    } finally {
        await context.close();
    }
}

async function expectOperationsNavigation(
    page: Page,
    role: StaffDashboardRole,
    locale: UiLocale,
): Promise<void> {
    const operationsNavigation = page.getByRole('navigation', {
        name: locale === 'es' ? 'Operaciones de eventos' : 'Event operations',
    });
    await expect(operationsNavigation).toBeVisible();
    // Identity and sign-out now live only in the one canonical global user
    // menu. The ops strip must not recreate the removed second user circle.
    await expect(operationsNavigation.locator('details')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(role);

    for (const label of locale === 'es'
        ? ['Eventos', 'Estado técnico', 'Entradas']
        : ['Events', 'System health', 'Admission']) {
        await expect(operationsNavigation.getByRole('link', { name: label, exact: true })).toBeVisible();
    }
}

stackTest.describe('role capability contract', () => {
    stackTest('presents every staff role and its assigned-event authority in ES and EN', async ({
        browser,
    }, testInfo) => {
        stackTest.slow();
        const db = requireDirectDb(testInfo);
        const roles = [
            ['FACILITATOR', true],
            ['FACILITATOR_OP', true],
            ['OPERATOR', false],
            ['ADMIN', false],
        ] as const;

        await withPreservedFixtureStaff(db, STAFF.facilitator.email, async () => {
            for (const locale of ['es', 'en'] as const) {
                for (const [role, publishesInitially] of roles) {
                    await withPage(browser, async (page) => {
                        const name = `${ROLE_NAMES[role]} ${locale.toUpperCase()}`;
                        await setLocale(page, locale);
                        await loginViaDashboard(page, role, name, ROUTES.opsEvents);
                        await expect(page.locator('html')).toHaveAttribute('lang', locale);
                        await expectOperationsNavigation(page, role, locale);

                        const entry = await page.request.get(
                            `/api/scheduled-sessions/${SESSION_ES.id}/entry`,
                        );
                        expect(entry.status()).toBe(200);

                        const token = await page.request.get(
                            `/api/scheduled-sessions/${SESSION_ES.id}/token`,
                        );
                        expect(token.status()).toBe(200);
                        expect(await token.json()).toMatchObject({
                            role,
                            isAssignedFacilitator: publishesInitially,
                            canPublish: publishesInitially,
                            principalKind: 'staff',
                        });
                    });
                }
            }
        });
    });

    stackTest('keeps an unassigned facilitator out while FACILITATOR_OP operates subscribe-only', async ({
        browser,
    }, testInfo) => {
        const db = requireDirectDb(testInfo);
        const syntheticOperatorEmail = 'e2e-operator@altermundi.net';

        for (const role of ['FACILITATOR', 'FACILITATOR_OP'] as const) {
            await withPage(browser, async (page) => {
                await loginViaDashboard(page, 'OPERATOR', 'E2E Unassigned Staff', ROUTES.opsEvents);
                await withFixtureStaffRole(db, syntheticOperatorEmail, role, async () => {
                    const entry = await page.request.get(
                        `/api/scheduled-sessions/${SESSION_EN.id}/entry`,
                    );
                    expect(entry.status()).toBe(role === 'FACILITATOR' ? 403 : 200);

                    const token = await page.request.get(
                        `/api/scheduled-sessions/${SESSION_EN.id}/token`,
                    );
                    if (role === 'FACILITATOR') {
                        expect(token.status()).toBe(403);
                        await page.goto(ROUTES.opsSession(SESSION_EN.id));
                        await expect(page.getByRole('heading', {
                            name: /This event is unavailable|Este evento no está disponible/i,
                        })).toBeVisible();
                    } else {
                        expect(token.status()).toBe(200);
                        expect(await token.json()).toMatchObject({
                            role: 'FACILITATOR_OP',
                            isAssignedFacilitator: false,
                            canPublish: false,
                            principalKind: 'staff',
                        });
                    }
                });
            });
        }
    });

    stackTest('explains attendee control and consent in both event languages', async ({
        browser,
    }, testInfo) => {
        stackTest.slow();
        const db = requireDirectDb(testInfo);
        const cases = [
            {
                session: SESSION_ES,
                credentials: {
                    name: 'E2E Attendee ES',
                    email: 'e2e.attendee@altermundi.net',
                    code: TICKETS.esIssuedC,
                },
                capability: 'Participante · tu cámara y micrófono quedan bajo tu control; sólo entrás en escena después de aceptar una invitación.',
            },
            {
                session: SESSION_EN,
                credentials: {
                    name: 'E2E Attendee EN',
                    email: 'lifecycle-attendee-2@e2e.altermundi.net',
                    code: TICKETS.enIssuedC,
                },
                capability: 'Participant · your camera and microphone stay under your control; you enter the stage only after accepting an invitation.',
            },
        ] as const;

        for (const { session, credentials, capability } of cases) {
            await withSessionStatus(db, session.id, 'LIVE', async () => {
                await withPage(browser, async (page) => {
                    await loginAttendeeWithTicket(page, credentials);
                    await page.waitForURL(`**${ROUTES.session(session.id)}`);
                    await expect(page.getByTestId('viewer-identity')).toContainText(credentials.name, {
                        timeout: 30_000,
                    });
                    await expect(page.getByTestId('viewer-role-guidance')).toHaveText(capability);
                    await expect(page.getByTestId('viewer-identity')).not.toContainText('ATTENDEE');
                });
            });
        }
    });
});
