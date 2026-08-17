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

const ROLE_COPY: Record<UiLocale, Record<StaffDashboardRole, {
    label: string;
    description: string;
}>> = {
    es: {
        FACILITATOR: {
            label: 'Facilitador/a',
            description: 'Conduce y publica únicamente en los eventos que tiene asignados. Puede consultar entradas y estado técnico, pero no administrar accesos.',
        },
        FACILITATOR_OP: {
            label: 'Facilitación y operaciones',
            description: 'Opera todos los eventos. Sólo en su evento asignado actúa como facilitación y puede publicar; fuera de él conserva acceso operativo sin publicación.',
        },
        OPERATOR: {
            label: 'Operaciones',
            description: 'Opera todos los eventos y resuelve admisión y accesos. No publica cámara o micrófono como facilitación.',
        },
        ADMIN: {
            label: 'Administración',
            description: 'Administra el sistema, los eventos y los accesos globalmente. No publica cámara o micrófono como facilitación.',
        },
    },
    en: {
        FACILITATOR: {
            label: 'Facilitator',
            description: 'Conducts and publishes only in assigned events. Can inspect admission and system health, but cannot administer access.',
        },
        FACILITATOR_OP: {
            label: 'Facilitator and operations',
            description: 'Operates every event. Acts as facilitator and may publish only in the assigned event; elsewhere retains operational access without publication.',
        },
        OPERATOR: {
            label: 'Operations',
            description: 'Operates every event and supports admission and access. Does not publish camera or microphone as facilitator.',
        },
        ADMIN: {
            label: 'Administration',
            description: 'Administers the system, events, and access globally. Does not publish camera or microphone as facilitator.',
        },
    },
};

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

async function expectStaffIdentity(
    page: Page,
    role: StaffDashboardRole,
    name: string,
    locale: UiLocale,
): Promise<void> {
    const copy = ROLE_COPY[locale][role];
    const identity = page.locator('nav details');
    await expect(identity.locator('summary')).toContainText(name);
    await expect(identity.locator('summary')).toContainText(copy.label);
    await identity.locator('summary').click();
    await expect(identity).toContainText(copy.description);
    await expect(page.locator('body')).not.toContainText(role);

    const operationsNavigation = page.getByRole('navigation', {
        name: locale === 'es' ? 'Operaciones de eventos' : 'Event operations',
    });
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
                        await expectStaffIdentity(page, role, name, locale);

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
                    code: TICKETS.esIssuedA,
                },
                capability: 'Participante · tu cámara y micrófono quedan bajo tu control; sólo entrás en escena después de aceptar una invitación.',
            },
            {
                session: SESSION_EN,
                credentials: {
                    name: 'E2E Attendee EN',
                    email: 'lifecycle-attendee-2@e2e.altermundi.net',
                    code: TICKETS.enIssuedB,
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
