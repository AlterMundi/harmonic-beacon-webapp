import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import { requireDirectDb } from '../fixtures/db';
import {
    createListenerAccountSwitchPair,
    deleteListenerAccountSwitchPair,
    LISTENER_ACCOUNT_COOKIE,
    listenerAccountSwitchSessionState,
    useListenerAccount,
} from '../fixtures/listener-account-switch';

async function accessKind(page: Page): Promise<string> {
    try {
        return await page.evaluate(async () => {
            const response = await fetch('/api/listener/access-state', {
                credentials: 'same-origin', cache: 'no-store',
            });
            if (response.status !== 200) return `status-${response.status}`;
            const payload = await response.json() as { access?: { kind?: unknown } };
            return String(payload.access?.kind ?? 'missing');
        });
    } catch (error) {
        if (error instanceof Error && /execution context was destroyed|because of a navigation/i
            .test(error.message)) return 'navigation-in-progress';
        throw error;
    }
}

async function expectFounder(page: Page): Promise<void> {
    await expect.poll(() => accessKind(page)).toBe('membership');
    await expect(page.locator('.listener-experience')).toBeVisible();
    await expect(page.locator('.listener-listening-status')).toHaveCount(0);
}

async function expectFree(page: Page): Promise<void> {
    await expect.poll(() => accessKind(page)).toBe('free-quota');
    await expect(page.locator('.listener-experience')).toBeVisible();
    await expect(page.locator('.listener-listening-status')).toBeVisible();
}

// The fixture tokens and direct-database URL must never enter a retained trace.
test.use({ trace: 'off' });

test.describe('Listener Account A/B cache boundary', () => {
    test.skip(
        process.env.E2E_LISTENER_ACCOUNT_SWITCH_GATE !== '1',
        'requires the isolated Account-on E2E server',
    );

    test('never restores Founder presentation or authorization for Free B', async ({ browser }, testInfo) => {
        test.setTimeout(90_000);
        requireDirectDb(testInfo);
        const baseURL = String(testInfo.project.use.baseURL);
        const parsedBaseURL = new URL(baseURL);
        if (!['localhost', '127.0.0.1', '[::1]'].includes(parsedBaseURL.hostname)) {
            throw new Error('refusing to run the Account switch fixture against a non-local app');
        }

        const pair = await createListenerAccountSwitchPair(testInfo);
        const contexts: BrowserContext[] = [];
        try {
            const context = await browser.newContext();
            contexts.push(context);
            await useListenerAccount(context, baseURL, pair.founder);
            const founderState = await listenerAccountSwitchSessionState(testInfo, pair.founder);
            expect(founderState).toEqual({
                present: true,
                accountId: pair.founder.accountId,
                issuer: 'https://account.harmonicbeacon.com',
                expired: expect.any(Boolean),
                remainingSeconds: expect.any(Number),
                synthetic: false,
            });
            expect(founderState.remainingSeconds).toBeGreaterThan(3_000);
            expect(founderState.expired).toBe(false);
            expect((await context.cookies(baseURL)).some((cookie) =>
                cookie.name === LISTENER_ACCOUNT_COOKIE)).toBe(true);
            const page = await context.newPage();
            await page.addInitScript(() => {
                window.addEventListener('pageshow', (event) => {
                    (window as typeof window & { __hbPageShowPersisted?: boolean })
                        .__hbPageShowPersisted = event.persisted;
                });
            });

            const founderResponse = await page.goto('/listener');
            expect(founderResponse?.headers()['cache-control']).toContain('no-store');
            expect((await context.cookies(page.url())).some((cookie) =>
                cookie.name === LISTENER_ACCOUNT_COOKIE)).toBe(true);
            const accessRequest = page.waitForRequest('**/api/listener/access-state');
            const initialKind = await accessKind(page);
            const initialHeaders = await (await accessRequest).allHeaders();
            expect(Boolean(initialHeaders.cookie?.startsWith(
                `${LISTENER_ACCOUNT_COOKIE}=`,
            ))).toBe(true);
            await expect(listenerAccountSwitchSessionState(testInfo, pair.founder)).resolves.toEqual({
                present: true,
                accountId: pair.founder.accountId,
                issuer: 'https://account.harmonicbeacon.com',
                expired: false,
                remainingSeconds: expect.any(Number),
                synthetic: false,
            });
            expect(initialKind).toBe('membership');
            await expectFounder(page);

            // Leave A in browser history, switch the host-only RP cookie to B,
            // and go back. A bfcache restoration must not revive A's Founder UI.
            await page.goto('/listener/privacy');
            await useListenerAccount(context, baseURL, pair.free);
            await page.goBack({ waitUntil: 'domcontentloaded' });
            // The Account-derived response is deliberately not bfcacheable in
            // current engines, so this history traversal must fetch B anew.
            expect(await page.evaluate(() => Boolean(
                (window as typeof window & { __hbPageShowPersisted?: boolean })
                    .__hbPageShowPersisted,
            ))).toBe(false);
            await expectFree(page);

            await page.goForward({ waitUntil: 'domcontentloaded' });
            await expect(page).toHaveURL(/\/listener\/privacy$/);
            await page.goBack({ waitUntil: 'domcontentloaded' });
            await expectFree(page);

            // Reload and a second tab must both derive only B's server session.
            await page.reload({ waitUntil: 'domcontentloaded' });
            await expectFree(page);
            const duplicate = await context.newPage();
            await duplicate.goto('/listener');
            await expectFree(duplicate);

            // Switching back to A restores Founder only after A's cookie is
            // authoritative again; B's page cannot grant it by itself.
            await useListenerAccount(context, baseURL, pair.founder);
            await duplicate.reload({ waitUntil: 'domcontentloaded' });
            await expectFounder(duplicate);
        } finally {
            await Promise.allSettled(contexts.map((context) => context.close()));
            await deleteListenerAccountSwitchPair(testInfo, pair.accountIds);
        }
    });
});
