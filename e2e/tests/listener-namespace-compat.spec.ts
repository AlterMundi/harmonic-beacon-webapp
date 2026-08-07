import { expect, test } from '@playwright/test';

import { EARLY_BIRD_INVITATION_COOKIE } from '../../src/lib/early-birds/invitation-cookie';
import {
    deleteSyntheticListenerEmails,
    signInSyntheticListener,
} from '../fixtures/listener-boundary';
import { requireDirectDb } from '../fixtures/db';

const INVITATION = `ebi_v1.${'a'.repeat(32)}.${'b'.repeat(32)}.${'c'.repeat(32)}`;

// The fixture bearer and cookies must never enter a retained browser trace.
test.use({ trace: 'off' });

test.describe('Listener namespace compatibility', () => {
    test('keeps a legacy invitation cookie and Listener session through canonical refresh and redemption', async ({ browser }, testInfo) => {
        test.skip(testInfo.project.name !== 'chromium', 'one browser proves the namespace/session contract');
        requireDirectDb(testInfo);
        const baseURL = new URL(String(testInfo.project.use.baseURL));
        if (!['localhost', '127.0.0.1', '[::1]'].includes(baseURL.hostname)) {
            throw new Error('refusing to run Listener namespace E2E against a non-local application');
        }

        const email = `namespace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@e2e.invalid`;
        const context = await browser.newContext();
        try {
            await signInSyntheticListener(context.request, email);
            const sessionCookie = (await context.cookies()).find((cookie) => (
                cookie.name !== EARLY_BIRD_INVITATION_COOKIE
                && cookie.name.includes('session')
            ));
            expect(sessionCookie).toBeDefined();

            await context.addCookies([{
                name: EARLY_BIRD_INVITATION_COOKIE,
                value: INVITATION,
                domain: baseURL.hostname,
                path: '/',
                httpOnly: true,
                secure: true,
                sameSite: 'Lax',
            }]);

            const page = await context.newPage();
            await page.goto('/listener');
            await page.getByRole('link', { name: /Activar mi invitación|Activate my invitation/ }).click();
            await expect(page).toHaveURL(/\/listener\/redeem$/);
            await page.reload();
            await expect(page.getByRole('button', { name: /Activar invitación|Activate invitation/ })).toBeVisible();

            let canonicalRedemption = 0;
            await page.route('**/api/listener/free/redeem', async (route) => {
                canonicalRedemption += 1;
                await route.fulfill({
                    status: 200,
                    contentType: 'application/json',
                    headers: {
                        'set-cookie': `${EARLY_BIRD_INVITATION_COOKIE}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Path=/; HttpOnly; Secure; SameSite=Lax`,
                    },
                    body: JSON.stringify({ ok: true, landing: '/listener', replayed: false }),
                });
            });
            await page.getByRole('button', { name: /Activar invitación|Activate invitation/ }).click();

            await expect(page).toHaveURL(/\/listener$/);
            await expect(page.getByRole('button', { name: /Cerrar sesión|Sign out/ })).toBeVisible();
            expect(canonicalRedemption).toBe(1);
            const cookies = await context.cookies();
            expect(cookies.find((cookie) => cookie.name === EARLY_BIRD_INVITATION_COOKIE)).toBeUndefined();
            expect(cookies.find((cookie) => cookie.name === sessionCookie!.name)?.value)
                .toBe(sessionCookie!.value);
        } finally {
            await context.close();
            await deleteSyntheticListenerEmails(testInfo, [email]);
        }
    });
});
