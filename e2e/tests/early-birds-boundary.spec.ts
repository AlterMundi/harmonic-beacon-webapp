import { expect, test, type BrowserContext, type Page } from '@playwright/test';

import {
    deleteSyntheticListenerEmails,
    minuteOffset,
    putSyntheticFreeSchedule,
    signInSyntheticListener,
    syntheticListenerByEmail,
} from '../fixtures/listener-boundary';
import { requireDirectDb } from '../fixtures/db';

async function documentEpoch(page: Page): Promise<number> {
    return page.evaluate(() => Number(sessionStorage.getItem('listener-boundary-document-epoch')));
}

async function installDocumentEpoch(context: BrowserContext): Promise<void> {
    await context.addInitScript(() => {
        const key = 'listener-boundary-document-epoch';
        const next = Number(sessionStorage.getItem(key) ?? 0) + 1;
        sessionStorage.setItem(key, String(next));
    });
}

// A failed run must not persist the ephemeral Listener cookie or the local
// synthetic-login request headers in a Playwright trace artifact.
test.use({ trace: 'off' });

test.describe('Listener scheduled Free browser boundary', () => {
    test('enters and leaves without document reload, polling or client authorization', async ({ browser }, testInfo) => {
        test.setTimeout(90_000);
        // Refuse before creating a session or browser context unless both the
        // app and database are the dedicated local fixture stack.
        requireDirectDb(testInfo);
        const baseURL = new URL(String(testInfo.project.use.baseURL));
        if (!['localhost', '127.0.0.1', '[::1]'].includes(baseURL.hostname)) {
            throw new Error('refusing to run Listener boundary E2E against a non-local application');
        }
        const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const enteringEmail = `boundary-enter-${nonce}@e2e.invalid`;
        const leavingEmail = `boundary-leave-${nonce}@e2e.invalid`;
        const contexts: BrowserContext[] = [];

        try {
            const enteringContext = await browser.newContext();
            const leavingContext = await browser.newContext();
            contexts.push(enteringContext, leavingContext);
            await Promise.all([installDocumentEpoch(enteringContext), installDocumentEpoch(leavingContext)]);

            await Promise.all([
                signInSyntheticListener(enteringContext.request, enteringEmail),
                signInSyntheticListener(leavingContext.request, leavingEmail),
            ]);
            const entering = await syntheticListenerByEmail(testInfo, enteringEmail);
            const leaving = await syntheticListenerByEmail(testInfo, leavingEmail);

            const now = new Date();
            // Entering starts at the next UTC wall minute. Leaving starts now,
            // so its truthful boundary is two hours away in browser time.
            await Promise.all([
                putSyntheticFreeSchedule(testInfo, entering, minuteOffset(now, 1)),
                putSyntheticFreeSchedule(testInfo, leaving, minuteOffset(now, 0)),
            ]);

            const enteringPage = await enteringContext.newPage();
            const leavingPage = await leavingContext.newPage();
            await Promise.all([enteringPage.clock.install(), leavingPage.clock.install()]);

            let enteringStateRequests = 0;
            let leavingStateRequests = 0;
            let enteringLeaseRequests = 0;
            let failEnteringOnce = true;
            await enteringPage.route('**/api/listener/access-state', async (route) => {
                enteringStateRequests += 1;
                if (failEnteringOnce) {
                    failEnteringOnce = false;
                    await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"synthetic outage"}' });
                    return;
                }
                await route.continue();
            });
            await enteringPage.route('**/api/early-birds/stream/lease', async (route) => {
                enteringLeaseRequests += 1;
                await route.continue();
            });
            await leavingPage.route('**/api/listener/access-state', async (route) => {
                leavingStateRequests += 1;
                await route.continue();
            });

            await Promise.all([
                enteringPage.goto('/listener'),
                leavingPage.goto('/listener'),
            ]);
            await expect(enteringPage.locator('.listener-shell--public')).toBeVisible();
            await expect(enteringPage.locator('.listener-experience')).toHaveCount(0);
            await expect(leavingPage.locator('.listener-experience')).toBeVisible();

            const enteringEpoch = await documentEpoch(enteringPage);
            const leavingEpoch = await documentEpoch(leavingPage);
            const enteringState = await enteringPage.request.get('/api/listener/access-state');
            const leavingState = await leavingPage.request.get('/api/listener/access-state');
            const enteringPayload = await enteringState.json() as { serverNow: string; freeWindow: { nextStart: string } };
            const leavingPayload = await leavingState.json() as { serverNow: string; access: { allowedUntil: string } };

            // Move only synthetic database truth across both boundaries. The
            // browser clock then runs the real setTimeout path immediately;
            // no test-only public clock or authorization endpoint is needed.
            const transitionNow = new Date();
            await Promise.all([
                putSyntheticFreeSchedule(testInfo, entering, minuteOffset(transitionNow, 0)),
                putSyntheticFreeSchedule(testInfo, leaving, minuteOffset(transitionNow, -121)),
            ]);

            const enterDelay = new Date(enteringPayload.freeWindow.nextStart).getTime()
                - new Date(enteringPayload.serverNow).getTime() + 1_000;
            const leaveDelay = new Date(leavingPayload.access.allowedUntil).getTime()
                - new Date(leavingPayload.serverNow).getTime() + 1_000;
            await Promise.all([
                enteringPage.clock.fastForward(Math.max(1_000, enterDelay)),
                leavingPage.clock.fastForward(Math.max(1_000, leaveDelay)),
            ]);

            // The failed start revalidation cannot grant UI or media access.
            await expect.poll(() => enteringStateRequests).toBe(1);
            await expect(enteringPage.locator('.listener-shell--public')).toBeVisible();
            expect(enteringLeaseRequests).toBe(0);

            // A resume/visibility signal supplies one bounded retry.
            await enteringPage.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
            await expect.poll(() => enteringStateRequests).toBe(2);
            await expect(enteringPage.locator('.listener-experience')).toBeVisible();
            await expect(leavingPage.locator('.listener-experience')).toHaveCount(0);
            await expect(leavingPage.locator('.listener-shell--public')).toBeVisible();

            expect(await documentEpoch(enteringPage)).toBe(enteringEpoch);
            expect(await documentEpoch(leavingPage)).toBe(leavingEpoch);
            expect(leavingStateRequests).toBe(1);

            // Once the refreshed server tree is stable, a full minute of
            // browser time produces no extra access-state polling.
            await Promise.all([
                enteringPage.clock.fastForward(60_000),
                leavingPage.clock.fastForward(60_000),
            ]);
            expect(enteringStateRequests).toBe(2);
            expect(leavingStateRequests).toBe(1);
        } finally {
            await Promise.all(contexts.map((context) => context.close()));
            await deleteSyntheticListenerEmails(testInfo, [enteringEmail, leavingEmail]);
        }
    });
});
