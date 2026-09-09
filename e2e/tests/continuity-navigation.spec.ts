import { test, expect } from '@playwright/test';
import { navigationBrowser } from '../fixtures/navigation-browser';
import { loginViaDashboard } from '../fixtures/auth';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';
import { withSessionStatus } from '../fixtures/db';
import { installMediaProbe, expectMediaContinuity } from '../helpers/media-probe';
import { continuityDatabase, syntheticPublisher, rememberPlayingMedia, expectSamePlayingMedia, settledContinuity, setLiveLocale } from '../helpers/continuity-stack';

for (const role of ['ATTENDEE', 'OPERATOR'] as const) {
    test(`live continuity without capture: full-stack ${role} locale preserves real LiveKit playback`, async ({ page, browser, baseURL }, testInfo) => {
        test.slow();
        await withSessionStatus(continuityDatabase(), SESSION_ES.id, 'LIVE', async () => {
            const stopPublisher = await syntheticPublisher(browser, baseURL!);
            try {
                await installMediaProbe(page);
                await loginViaDashboard(page, role, `Continuity ${role}`, role === 'ATTENDEE' ? ROUTES.session(SESSION_ES.id) : ROUTES.opsSession(SESSION_ES.id));
                const surface = role === 'ATTENDEE' ? page : await (await page.getByTestId('persistent-room').elementHandle())!.contentFrame();
                expect(surface).not.toBeNull();
                if (!surface) throw new Error('Staff room frame absent');
                await rememberPlayingMedia(surface);
                const before = await settledContinuity(surface);
                expect(before.livekitSocketsOpened).toBeGreaterThan(0);
                expect(before.peerConnectionsCreated).toBeGreaterThan(0);
                for (const locale of ['EN', 'ES', 'EN']) {
                    await setLiveLocale(page, locale.toLowerCase() as 'en' | 'es');
                    await expect(page.locator('html')).toHaveAttribute('lang', locale.toLowerCase());
                    await expect(surface.locator('html')).toHaveAttribute('lang', locale.toLowerCase());
                    await expectSamePlayingMedia(surface);
                    if (role === 'OPERATOR') {
                        await page.getByRole('button', { name: /Hands|Manos/i }).first().click();
                        await page.getByRole('button', { name: /Return to the live room|Volver a la sala en vivo/ }).click();
                    }
                }
                if (role === 'OPERATOR') {
                    await setLiveLocale(page, 'es');
                    await page.getByRole('button', { name: /Hands|Manos/i }).first().click();
                    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
                    await expect(page.getByRole('button', { name: /Volver a la sala en vivo/ })).toBeVisible();
                }
                const after = await settledContinuity(surface);
                expectMediaContinuity(before, after);
                expect(after.livekitSocketsOpened).toBe(before.livekitSocketsOpened);
                expect(after.peerConnectionsCreated).toBe(before.peerConnectionsCreated);
                await testInfo.attach('locale-media-before-after', { body: JSON.stringify({ before, after }, null, 2), contentType: 'application/json' });
            } finally { await stopPublisher(); }
        });
    });
}

let fixture: Awaited<ReturnType<typeof navigationBrowser>>;
test.describe('live continuity without capture', () => {
    test.beforeAll(async () => { fixture = await navigationBrowser(); });
    test.afterAll(async () => { await fixture?.close(); });
    test('pinned global language control changes the live Staff locale without a document reload', async ({ page }) => {
        await page.goto(`${fixture.origin}/ops/events/event-1?real-navigation`, { waitUntil: 'domcontentloaded' });
        const room = page.frameLocator('[data-testid="persistent-room"]');
        await room.getByLabel('Room draft').fill('real control retained');
        await page.evaluate(() => { (window as unknown as { originalDocument: Document }).originalDocument = document; });
        for (const locale of ['es', 'en'] as const) {
            await setLiveLocale(page, locale);
            await expect(room.getByLabel('Room locale')).toHaveText(locale);
            await expect(room.getByLabel('Room draft')).toHaveValue('real control retained');
            expect(await page.evaluate(() => (window as unknown as { originalDocument: Document }).originalDocument === document)).toBe(true);
            await expect(page.getByRole('alertdialog')).toHaveCount(0);
        }
    });

    test('ES/EN changes in Staff and its persistent room preserve document, track and draft', async ({ page }) => {
        await page.goto(`${fixture.origin}/ops/events/event-1`, { waitUntil: 'domcontentloaded' });
        const room = page.frameLocator('[data-testid="persistent-room"]');
        await room.getByLabel('Room draft').fill('keep this draft');
        await room.locator('video').evaluate((video: HTMLVideoElement) => {
            (window as unknown as { originalMedia: unknown }).originalMedia = { video, stream: video.srcObject };
        });
        await page.getByRole('button', { name: 'Hands', exact: false }).click();
        for (const locale of ['ES', 'EN']) {
            await page.getByRole('button', { name: locale, exact: true }).click();
            await expect(room.getByLabel('Room locale')).toHaveText(locale.toLowerCase());
            await expect(page.locator('html')).toHaveAttribute('lang', locale.toLowerCase());
            await expect(room.locator('html')).toHaveAttribute('lang', locale.toLowerCase());
            await expect(room.getByLabel('Room draft')).toHaveValue('keep this draft');
            expect(await room.locator('video').evaluate((video: HTMLVideoElement) => {
                const original = (window as unknown as { originalMedia: { video: HTMLVideoElement; stream: MediaStream } }).originalMedia;
                return original.video === video && original.stream === video.srcObject && original.stream.getTracks().every(track => track.readyState === 'live');
            })).toBe(true);
        }
        expect(await page.evaluate(() => (window as unknown as { __refreshes?: number }).__refreshes ?? 0)).toBe(0);
        await room.getByRole('button', { name: 'ES', exact: true }).click();
        await expect(page.locator('html')).toHaveAttribute('lang', 'es');
        await expect(page.getByRole('button', { name: /Volver a la sala en vivo/ })).toBeVisible();
    });
});
