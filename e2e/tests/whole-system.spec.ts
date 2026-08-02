import type { Page } from '@playwright/test';

import { loginAttendeeWithTicket, loginViaDashboard } from '../fixtures/auth';
import {
    requireDirectDb,
    withPreservedFixtureStaff,
    withResetSessionLifecycle,
} from '../fixtures/db';
import { expect, stackTest } from '../fixtures/stack';
import { ROUTES, SESSION_EN, SESSION_ES, STAFF, TICKETS } from '../fixtures/test-data';

async function closeCockpitDrawer(staff: Page): Promise<void> {
    const drawer = staff.getByRole('dialog');
    await drawer.getByRole('button', {
        name: /Return to the live room|Volver a la sala en vivo/i,
    }).click();
    await expect(drawer).toBeHidden();
}

/**
 * Phase-B acceptance for #69.
 *
 * One FACILITATOR_OP identity runs two complete, consecutive rehearsals:
 * waiting room → doors → room → hand → invitation → decline/accept → return
 * → terminate. The same login also performs the real admission lookup,
 * health refresh and LiveKit reconciliation actions from the cockpit.
 */
stackTest('FACILITATOR_OP completes two consecutive event lifecycles without switching identity', async ({
    browser,
}, testInfo) => {
    stackTest.slow();
    const db = requireDirectDb(testInfo);
    const staffContext = await browser.newContext();
    const staff = await staffContext.newPage();
    let staffLoggedIn = false;

    try {
        await withPreservedFixtureStaff(db, STAFF.facilitator.email, async () => {
            const rehearsals = [
                { session: SESSION_ES, invitationDecision: 'decline' },
                { session: SESSION_EN, invitationDecision: 'accept' },
            ] as const;

            for (const [index, { session, invitationDecision }] of rehearsals.entries()) {
                await withResetSessionLifecycle(db, session.id, async () => {
                    if (!staffLoggedIn) {
                        await loginViaDashboard(
                            staff,
                            'FACILITATOR_OP',
                            'Lifecycle Conductor',
                            ROUTES.opsSession(session.id),
                        );
                        staffLoggedIn = true;
                    } else {
                        await staff.goto(ROUTES.opsSession(session.id));
                    }

                    await expect(staff.getByTestId('conductor-cockpit')).toBeVisible();
                    await expect(staff.getByRole('heading', { name: session.title })).toBeVisible();
                    await expect(staff.getByText('Lifecycle Conductor').first()).toBeVisible();
                    await expect(staff.getByText(
                        /Facilitación y operaciones|Facilitator and operations/i,
                    ).first())
                        .toBeVisible();

                    const attendeeContext = await browser.newContext();
                    const attendee = await attendeeContext.newPage();
                    const attendeeName = `Lifecycle Attendee ${index + 1}`;

                    try {
                        if (session.id === SESSION_ES.id) {
                            await loginViaDashboard(
                                attendee,
                                'ATTENDEE',
                                attendeeName,
                                ROUTES.session(session.id),
                            );
                        } else {
                            await loginAttendeeWithTicket(attendee, {
                                name: attendeeName,
                                email: 'lifecycle-attendee-2@e2e.altermundi.net',
                                code: TICKETS.enIssuedB,
                            });
                            await attendee.waitForURL(`**${ROUTES.session(session.id)}`);
                        }
                        await expect(attendee.getByText(
                            /doors are (?:still closed|not open yet)|puertas todavía están cerradas/i,
                        )).toBeVisible({ timeout: 10_000 });

                        await staff.locator('[data-signal="door"]').click();
                        const doors = staff.getByRole('dialog');
                        const reason = doors.getByLabel(/Operational reason|Motivo operativo/i);
                        if (await reason.isVisible()) {
                            await reason.fill(`E2E lifecycle ${index + 1}`);
                        }
                        await doors.getByRole('button', { name: /Open doors|Abrir puertas/i }).click();
                        await expect(doors.getByRole('status')).toContainText(/Doors are open|Las puertas están abiertas/i);
                        await closeCockpitDrawer(staff);

                        await expect(attendee.getByTestId('connection-state')).toHaveAttribute(
                            'data-state',
                            'connected',
                            { timeout: 25_000 },
                        );

                        // The composite role uses global operational tools in
                        // the same authenticated cockpit, without a mode or
                        // account switch.
                        await staff.locator('[data-tool="admission"]').click();
                        const admission = staff.getByRole('dialog');
                        await admission.getByPlaceholder(
                            'Attendee email, code last four, or entitlement ID',
                        ).fill(session.id === SESSION_ES.id ? 'TESD' : 'TEND');
                        await admission.getByRole('button', { name: 'Look up' }).click();
                        await expect(admission.getByText('Last four:')).toBeVisible();
                        await expect(admission.getByText(
                            session.id === SESSION_ES.id ? 'TESD' : 'TEND',
                            { exact: true },
                        )).toBeVisible();
                        await closeCockpitDrawer(staff);

                        await staff.locator('[data-signal="health"]').click();
                        const health = staff.getByRole('dialog');
                        await health.getByRole('button', { name: 'Refresh now' }).click();
                        const healthSummary = health.locator('p').filter({
                            hasText: /Watching session.*signed in as FACILITATOR_OP/i,
                        });
                        await expect(healthSummary).toBeVisible({ timeout: 15_000 });
                        await expect(healthSummary).toContainText(session.title);
                        await closeCockpitDrawer(staff);

                        await staff.locator('[data-signal="hands"]').click();
                        const scene = staff.getByRole('dialog');
                        await scene.getByRole('button', { name: /Reconcile grants|Reconciliar permisos/i }).click();
                        await expect(scene.getByRole('status')).toContainText(
                            /Reconciliation finished|Reconciliación terminada/i,
                        );

                        await attendee.getByRole('button', {
                            name: /Raise hand|Levantar la mano/i,
                        }).click();
                        const queueRow = scene.locator('li').filter({ hasText: attendeeName });
                        await expect(queueRow.getByRole('button', { name: /Give floor|Dar la palabra/i })).toBeEnabled({
                            timeout: 10_000,
                        });
                        await queueRow.getByRole('button', { name: /Give floor|Dar la palabra/i }).click();

                        const invitation = attendee.getByRole('dialog', {
                            name: /invited into the scene|invitan a entrar en escena/i,
                        });
                        await expect(invitation).toBeVisible({ timeout: 10_000 });

                        if (invitationDecision === 'decline') {
                            await invitation.getByRole('button', { name: /Not now|Ahora no/i }).click();
                            await expect(attendee.getByRole('button', {
                                name: /Raise hand|Levantar la mano/i,
                            })).toBeVisible({ timeout: 10_000 });
                        } else {
                            await invitation.getByRole('button', {
                                name: /Accept and join|Aceptar y entrar/i,
                            }).click();
                            await expect(attendee.getByRole('button', {
                                name: /Turn camera off|Apagar (?:la )?cámara/i,
                            })).toBeVisible({ timeout: 15_000 });
                            const stageRow = scene.locator('li').filter({ hasText: attendeeName });
                            await expect(stageRow.getByRole('button', { name: /Take floor|Quitar la palabra/i })).toBeVisible({
                                timeout: 10_000,
                            });
                            await stageRow.getByRole('button', { name: /Take floor|Quitar la palabra/i }).click();
                            await expect(attendee.getByRole('button', {
                                name: /Turn camera off|Apagar (?:la )?cámara/i,
                            })).toHaveCount(0, { timeout: 10_000 });
                        }

                        await closeCockpitDrawer(staff);
                        await staff.locator('[data-signal="door"]').click();
                        const closePanel = staff.getByRole('dialog');
                        await closePanel.getByRole('button', { name: /Close event|Cerrar evento/i }).click();
                        await closePanel.getByRole('button', {
                            name: /End & disconnect everyone|Finalizar y desconectar/i,
                        }).click();
                        await expect(closePanel.getByRole('status')).toContainText(/Event ended now|Evento finalizado/i);
                        await expect(attendee.getByRole('heading', {
                            name: /Session ended|La sesión terminó/i,
                        })).toBeVisible({ timeout: 15_000 });
                    } finally {
                        await attendeeContext.close();
                    }
                });
            }
        });
    } finally {
        await staffContext.close();
    }
});
