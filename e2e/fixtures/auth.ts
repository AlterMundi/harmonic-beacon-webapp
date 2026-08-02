import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/**
 * Login helpers covering the three real authentication paths:
 * - `loginViaDashboard` uses the E2E_DASHBOARD_ENABLED=1-gated shortcut
 *   (`POST /api/test-login`) to impersonate any role without going through
 *   ticket codes or staff passwords.
 * - `loginAttendeeWithTicket` / `loginStaffWithPassword` drive the real UI
 *   forms, so the smoke suite exercises what attendees and staff actually do.
 */

export type DashboardRole = 'ATTENDEE' | 'FACILITATOR' | 'FACILITATOR_OP' | 'OPERATOR' | 'ADMIN';

export async function loginViaDashboard(
    page: Page,
    role: DashboardRole,
    name: string,
    landing: string,
): Promise<void> {
    const response = await page.request.post('/api/test-login', {
        data: { name, role, landing },
    });
    expect(
        response.ok(),
        `test-dashboard login as ${role} failed with ${response.status()} — is E2E_DASHBOARD_ENABLED=1 and the fixture loaded?`,
    ).toBe(true);

    // The production cookie is correctly Secure. Chromium accepts it from
    // Playwright's HTTP request context for localhost, while Linux WebKit does
    // not transfer it to an HTTP page context. Mirror only this E2E-gated,
    // synthetic cookie as non-Secure so the same browser suite can exercise
    // WebKit without weakening production cookie attributes.
    const setCookie = response.headers()['set-cookie'] ?? '';
    const session = /(?:^|,\s*)hb_session=([^;]+)/.exec(setCookie)?.[1];
    if (session) {
        await page.context().addCookies([{
            name: 'hb_session',
            value: session,
            url: new URL(response.url()).origin,
            httpOnly: true,
            secure: false,
            sameSite: 'Lax',
        }]);
    }
    await page.goto(landing);
}

export async function loginAttendeeWithTicket(
    page: Page,
    credentials: { name: string; email: string; code: string },
): Promise<void> {
    await page.goto('/');
    await page.locator('#display-name').fill(credentials.name);
    await page.locator('#ticket-code').fill(credentials.code);
    await page.locator('#ticket-email').fill(credentials.email);
    await page.getByRole('button', { name: /enter|entrar/i }).click();
}

export async function loginStaffWithPassword(
    page: Page,
    credentials: { email: string; password: string },
): Promise<void> {
    await page.goto('/staff/login');
    await page.locator('#staff-email').fill(credentials.email);
    await page.locator('#staff-password').fill(credentials.password);
    await page.getByRole('button', { name: /sign in|iniciar|ingresar|entrar/i }).click();
}
