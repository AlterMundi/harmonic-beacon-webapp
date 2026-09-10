import { test, expect, type Frame, type Page } from '@playwright/test';
import { navigationBrowser } from '../fixtures/navigation-browser';
import { loginForContinuity } from '../helpers/continuity-stack';
import { accountFixtureEnabled, accountSessionRow, expectAccountSessionRevoked, expectCentralSessionInactive } from '../account-fixture/browser';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';
import { withSessionStatus, withResetSessionLifecycle } from '../fixtures/db';
import { installMediaProbe, expectMediaContinuity } from '../helpers/media-probe';
import { continuityDatabase, syntheticPublisher, rememberPlayingMedia, expectSamePlayingMedia, settledContinuity, setLiveLocale } from '../helpers/continuity-stack';

test('live continuity without capture: Staff open drawer survives a cancelled browser reload @desktop-native-staff', async ({ page, browser, baseURL }) => {
    test.slow();
    await withSessionStatus(continuityDatabase(), SESSION_ES.id, 'LIVE', async () => {
        const stopPublisher = await syntheticPublisher(browser, baseURL!);
        try {
            await installMediaProbe(page);
            await loginForContinuity(page, 'OPERATOR', 'Drawer reload', ROUTES.opsSession(SESSION_ES.id));
            const surface = await liveRoomSurface(page, 'OPERATOR');
            await rememberPlayingMedia(surface, stopPublisher.sources);
            await expectSamePlayingMedia(surface);
            await setLiveLocale(page, 'en');
            await expectSamePlayingMedia(surface);
            await page.getByRole('button', { name: /Hands/ }).first().click();
            const drawer = page.getByRole('dialog');
            await expect(drawer).toBeVisible();
            const before = await settledContinuity(surface);
            // Hands was a real top-level pointer gesture, not a forced click
            // through the backdrop. Firefox needs sticky activation for unload.
            expect(await page.evaluate(() => navigator.userActivation.hasBeenActive)).toBe(true);
            const documentHandle = await page.evaluateHandle(() => document);
            await expectSamePlayingMedia(surface);
            const warnings: string[] = [];
            page.on('dialog', async dialog => { warnings.push(dialog.type()); await dialog.dismiss(); });
            await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
            await expect.poll(() => warnings.length).toBe(1);
            expect(warnings).toEqual(['beforeunload']);
            expect(await page.evaluate(original => original === document, documentHandle)).toBe(true);
            await documentHandle.dispose();
            await expect(drawer).toBeVisible();
            await expectSamePlayingMedia(surface);
            expectMediaContinuity(before, await settledContinuity(surface));
            expect(warnings).toEqual(['beforeunload']);
            await drawer.getByRole('button', { name: /Return to the live room/ }).click();
            await expectSamePlayingMedia(surface);
        } finally { await stopPublisher(); }
    });
});

for (const role of ['ATTENDEE', 'OPERATOR'] as const) {
    test(`live continuity without capture: full-stack ${role} denied VIDEO locale changes do not retry capture`, async ({ page, browser, baseURL }, testInfo) => {
        test.slow();
        await withSessionStatus(continuityDatabase(), SESSION_ES.id, 'LIVE', async () => {
            const stopPublisher = await syntheticPublisher(browser, baseURL!);
            try {
                await installMediaProbe(page, { denyCapture: true });
                await loginForContinuity(page, role, `Denied ${role}`, role === 'ATTENDEE' ? ROUTES.session(SESSION_ES.id) : ROUTES.opsSession(SESSION_ES.id));
                const surface = await liveRoomSurface(page, role);
                await rememberPlayingMedia(surface, stopPublisher.sources);
                const before = await settledContinuity(surface);
                expect(before.captureAttempts).toBe(1); // Default-on VIDEO, not zero camera policy.
                expect(before.videoCaptureAttempts).toBe(1);
                expect(before.audioCaptureAttempts).toBe(0);
                for (const locale of ['en', 'es', 'en'] as const) {
                    await expectSamePlayingMedia(surface);
                    await setLiveLocale(page, locale);
                    await expectSamePlayingMedia(surface);
                    await expect(surface.locator('html')).toHaveAttribute('lang', locale);
                    await expectSamePlayingMedia(surface);
                    expectMediaContinuity(before, await settledContinuity(surface));
                }
                await testInfo.attach('denied-device-simulation-capture-attempts', { body: JSON.stringify({ before, after: await settledContinuity(surface) }), contentType: 'application/json' });
            } finally { await stopPublisher(); }
        });
    });

    test(`live continuity without capture: full-stack ${role} locale preserves real LiveKit playback`, async ({ page, browser, baseURL }, testInfo) => {
        test.slow();
        await withSessionStatus(continuityDatabase(), SESSION_ES.id, 'LIVE', async () => {
            const stopPublisher = await syntheticPublisher(browser, baseURL!);
            try {
                await installMediaProbe(page);
                await loginForContinuity(page, role, `Continuity ${role}`, role === 'ATTENDEE' ? ROUTES.session(SESSION_ES.id) : ROUTES.opsSession(SESSION_ES.id));
                const surface = role === 'ATTENDEE' ? page : await (await page.getByTestId('persistent-room').elementHandle())!.contentFrame();
                expect(surface).not.toBeNull();
                if (!surface) throw new Error('Staff room frame absent');
                await rememberPlayingMedia(surface, stopPublisher.sources);
                const before = await settledContinuity(surface);
                expect(before.livekitSocketsOpened).toBeGreaterThan(0);
                expect(before.peerConnectionsCreated).toBeGreaterThan(0);
                for (const locale of ['EN', 'ES', 'EN']) {
                    await expectSamePlayingMedia(surface);
                    await setLiveLocale(page, locale.toLowerCase() as 'en' | 'es');
                    await expectSamePlayingMedia(surface);
                    await expect(page.locator('html')).toHaveAttribute('lang', locale.toLowerCase());
                    await expect(surface.locator('html')).toHaveAttribute('lang', locale.toLowerCase());
                    await expectSamePlayingMedia(surface);
                    if (role === 'OPERATOR') {
                        await page.getByRole('button', { name: /Hands|Manos/i }).first().click();
                        await expectSamePlayingMedia(surface);
                        await page.getByRole('button', { name: /Return to the live room|Volver a la sala en vivo/ }).click();
                        await expectSamePlayingMedia(surface);
                    }
                }
                if (role === 'OPERATOR') {
                    await expectSamePlayingMedia(surface);
                    await setLiveLocale(page, 'es');
                    await expectSamePlayingMedia(surface);
                    await page.getByRole('button', { name: /Hands|Manos/i }).first().click();
                    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
                    await expect(page.getByRole('button', { name: /Volver a la sala en vivo/ })).toBeVisible();
                    await expectSamePlayingMedia(surface);
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

async function globalListenLink(page: Page) {
    const links = page.locator('hb-global-nav a[href*="listen.harmonicbeacon.com"]').filter({ visible: true });
    if (!await links.count()) await page.locator('hb-global-nav .toggle').click();
    return links.first();
}

async function liveRoomSurface(page: Page, role: 'ATTENDEE' | 'OPERATOR'): Promise<Page | Frame> {
    if (role === 'ATTENDEE') return page;
    const frame = await (await page.getByTestId('persistent-room').elementHandle())?.contentFrame();
    if (!frame) throw new Error('Staff room frame absent');
    return frame;
}

for (const role of ['ATTENDEE', 'OPERATOR'] as const) {
    test(`live continuity without capture: full-stack ${role} cancelled exits preserve real media, state and focus`, async ({ page, browser, baseURL }, testInfo) => {
        test.slow();
        await withSessionStatus(continuityDatabase(), SESSION_ES.id, 'LIVE', async () => {
            const stopPublisher = await syntheticPublisher(browser, baseURL!);
            try {
                await installMediaProbe(page);
                await loginForContinuity(page, role, `Guard ${role}`, role === 'ATTENDEE' ? ROUTES.session(SESSION_ES.id) : ROUTES.opsSession(SESSION_ES.id));
                const surface = await liveRoomSurface(page, role);
                await rememberPlayingMedia(surface, stopPublisher.sources);
                await expectSamePlayingMedia(surface);
                await setLiveLocale(page, 'en');
                await expectSamePlayingMedia(surface);
                const mix = surface.getByRole('slider').nth(1);
                await mix.focus(); await mix.press('ArrowLeft');
                const mixValue = await mix.inputValue();
                const before = await settledContinuity(surface);
                const native: string[] = [];
                page.on('dialog', async dialog => { native.push(dialog.type()); await dialog.dismiss(); });
                const exit = surface.getByRole('button', { name: 'Leave session', exact: true });
                await exit.click();
                await expect(page.getByRole('alertdialog')).toBeVisible();
                if (role === 'OPERATOR') await expect(surface.getByRole('alertdialog')).toHaveCount(0);
                await page.getByRole('button', { name: 'Stay in the room', exact: true }).click();
                await expect(exit).toBeFocused();
                await expectSamePlayingMedia(surface);
                // Exercise the real pinned web component's shadow link (or its
                // actual fallback), not an injected navigation mock.
                const globalExit = await globalListenLink(page);
                await globalExit.click();
                await expect(page.getByRole('alertdialog')).toBeVisible();
                await page.keyboard.press('Escape');
                await expect(globalExit).toBeFocused();
                await expectSamePlayingMedia(surface);
                if (role === 'OPERATOR') {
                    const hands = page.getByRole('button', { name: /Hands/ }).first();
                    await hands.click();
                    // The real drawer backdrop covers outer navigation. Close
                    // through its reachable control before testing that exit.
                    await page.getByRole('button', { name: /Return to the live room/ }).click();
                    const staffExit = page.locator('.live-ops-shell nav a[href="/ops/events"]').first();
                    await staffExit.click();
                    await expect(page.getByRole('alertdialog')).toBeVisible();
                    await page.keyboard.press('Escape');
                    await expect(staffExit).toBeFocused();
                    await expect(page.getByRole('dialog')).not.toBeVisible();
                    await expectSamePlayingMedia(surface);
                }
                await expectSamePlayingMedia(surface);
                await setLiveLocale(page, 'es');
                await expectSamePlayingMedia(surface);
                await expect(page.getByRole('alertdialog')).toHaveCount(0);
                await expect(mix).toHaveValue(mixValue);
                await expectSamePlayingMedia(surface);
                const after = await settledContinuity(surface);
                expectMediaContinuity(before, after);
                expect(after.livekitSocketsOpened).toBe(before.livekitSocketsOpened);
                expect(after.peerConnectionsCreated).toBe(before.peerConnectionsCreated);
                expect(native).toEqual([]);
                await testInfo.attach('exit-cancel-real-media', { body: JSON.stringify({ before, after }, null, 2), contentType: 'application/json' });
                // A confirmed real global exit must navigate once, with no
                // second native warning. Only the destination is fulfilled;
                // the running app, auth, room and media APIs stay unmodified.
                let departures = 0;
                await page.route('https://listen.harmonicbeacon.com/**', route => {
                    departures++; return route.fulfill({ contentType: 'text/html', body: '<h1>Confirmed exit destination</h1>' });
                });
                await (await globalListenLink(page)).click();
                await page.getByRole('button', { name: 'Salir de la sala', exact: true }).click();
                await expect(page.getByRole('heading', { name: 'Confirmed exit destination' })).toBeVisible();
                expect(departures).toBe(1);
                expect(native).toEqual([]);
            } finally { await stopPublisher(); }
        });
    });

    test(`live continuity without capture: full-stack ${role} sign-out waits for confirmation and revokes once`, async ({ page, browser, baseURL }) => {
        test.skip(!accountFixtureEnabled(), 'Separate Account protocol gate; run e2e/account-fixture/playwright.config.ts. Legacy stack intentionally keeps Account disabled.');
        test.slow();
        await withSessionStatus(continuityDatabase(), SESSION_ES.id, 'LIVE', async () => {
            const stopPublisher = await syntheticPublisher(browser, baseURL!);
            try {
                await installMediaProbe(page);
                await loginForContinuity(page, role, `Signout ${role}`, role === 'ATTENDEE' ? ROUTES.session(SESSION_ES.id) : ROUTES.opsSession(SESSION_ES.id));
                const surface = await liveRoomSurface(page, role);
                await rememberPlayingMedia(surface, stopPublisher.sources);
                await expectSamePlayingMedia(surface);
                await setLiveLocale(page, 'en');
                await expectSamePlayingMedia(surface);
                const accountRow = await accountSessionRow(page);
                await expect(page.locator('hb-global-nav .account-trigger')).toBeVisible();
                await page.locator('hb-global-nav .account-trigger').click();
                const signout = page.getByRole('menuitem', { name: 'Sign out', exact: true });
                let logouts = 0;
                const native: string[] = [];
                page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/auth/logout') logouts++; });
                page.on('dialog', async dialog => { native.push(dialog.type()); await dialog.dismiss(); });
                const before = await settledContinuity(surface);
                await signout.click();
                await page.getByRole('button', { name: 'Stay in the room', exact: true }).click();
                await expect(signout).toBeFocused();
                await expectSamePlayingMedia(surface);
                expect(logouts).toBe(0);
                await signout.click(); await page.keyboard.press('Escape');
                await expect(signout).toBeFocused();
                await expectSamePlayingMedia(surface);
                expectMediaContinuity(before, await settledContinuity(surface));
                await signout.click();
                const logout = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/logout' && response.request().method() === 'POST');
                await page.getByRole('button', { name: 'Leave the room', exact: true }).click();
                const logoutResponse = await logout;
                expect(logoutResponse.ok()).toBe(true);
                const { issuerLogoutUrl } = await logoutResponse.json();
                expect(new URL(issuerLogoutUrl).origin).toBe(process.env.E2E_ACCOUNT_ISSUER);
                await expect(page.getByRole('heading', { name: 'External identity simulation' })).toBeVisible();
                await expectAccountSessionRevoked(accountRow.id);
                await page.getByRole('button', { name: 'Confirm simulated Account sign-out', exact: true }).click();
                await expect(page).toHaveURL(new URL('/', baseURL!).href);
                await expectCentralSessionInactive(page, accountRow);
                expect(logouts).toBe(1);
                expect(native).toEqual([]);
                expect((await page.context().cookies()).filter(cookie => cookie.name === 'hb_session')).toHaveLength(0);
            } finally { await stopPublisher(); }
        });
    });

    test(`live continuity without capture: full-stack ${role} server removal dismisses a pending guard without trapping`, async ({ page, browser, baseURL }) => {
        test.slow();
        await withSessionStatus(continuityDatabase(), SESSION_ES.id, 'LIVE', async () => {
            const stopPublisher = await syntheticPublisher(browser, baseURL!);
            try {
                await loginForContinuity(page, role, `Removed ${role}`, role === 'ATTENDEE' ? ROUTES.session(SESSION_ES.id) : ROUTES.opsSession(SESSION_ES.id));
                const surface = await liveRoomSurface(page, role);
                await rememberPlayingMedia(surface, stopPublisher.sources);
                await expectSamePlayingMedia(surface);
                await setLiveLocale(page, 'en');
                await expectSamePlayingMedia(surface);
                const tokenResponse = await page.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/token`);
                expect(tokenResponse.ok()).toBe(true);
                const { identity, room } = await tokenResponse.json();
                await surface.getByRole('button', { name: 'Leave session', exact: true }).click();
                await expect(page.getByRole('alertdialog')).toBeVisible();
                const { RoomServiceClient } = await import('livekit-server-sdk');
                // The local fixture DB check above is mandatory before any
                // test-admin call. Use the same isolated credentials as CI.
                const service = new RoomServiceClient((process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880').replace(/^ws/, 'http'), process.env.E2E_LIVEKIT_API_KEY ?? 'devkey', process.env.E2E_LIVEKIT_API_SECRET ?? 'secret');
                await service.removeParticipant(room, identity);
                await expect(page.getByRole('alertdialog')).toHaveCount(0);
                await expect(surface.getByTestId('connection-state')).toHaveCount(0);
                let native = 0;
                page.on('dialog', async dialog => { native++; await dialog.dismiss(); });
                await page.route('https://listen.harmonicbeacon.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Unguarded terminal exit</h1>' }));
                await (await globalListenLink(page)).click();
                await expect(page.getByRole('heading', { name: 'Unguarded terminal exit' })).toBeVisible();
                expect(native).toBe(0);
            } finally { await stopPublisher(); }
        });
    });

    test(`live continuity without capture: full-stack ${role} Back cancellation and native unload retain real playback`, async ({ page, browser, baseURL, isMobile }, testInfo) => {
        test.slow();
        await withSessionStatus(continuityDatabase(), SESSION_ES.id, 'LIVE', async () => {
            const stopPublisher = await syntheticPublisher(browser, baseURL!);
            try {
                await installMediaProbe(page);
                await loginForContinuity(page, role, `History ${role}`, role === 'ATTENDEE' ? ROUTES.session(SESSION_ES.id) : ROUTES.opsSession(SESSION_ES.id));
                const surface = await liveRoomSurface(page, role);
                await rememberPlayingMedia(surface, stopPublisher.sources);
                await expectSamePlayingMedia(surface);
                await setLiveLocale(page, 'en');
                await expectSamePlayingMedia(surface);
                // Seed an actual same-document Back destination without
                // replacing Next's state payload or the production room.
                await page.evaluate(() => {
                    const url = location.href;
                    history.replaceState(history.state, '', '/?continuity-prior');
                    history.pushState(history.state, '', url);
                });
                const original = await page.evaluate(() => ({ state: history.state, url: location.href }));
                const before = await settledContinuity(surface);
                const focus = page.getByRole('button', { name: 'Language / Idioma', exact: true });
                await focus.focus();
                await page.evaluate(() => history.back());
                await expect(page.getByRole('alertdialog')).toBeVisible();
                await page.keyboard.press('Escape');
                await expect(focus).toBeFocused();
                expect(await page.evaluate(() => ({ state: history.state, url: location.href }))).toEqual(original);
                await expectSamePlayingMedia(surface);
                const native: string[] = [];
                page.on('dialog', async dialog => { native.push(dialog.type()); await dialog.dismiss(); });
                if (!isMobile) {
                    // Mobile unload availability is browser-controlled; this
                    // is the desktop API gate, not a physical-mobile promise.
                    await page.locator('h1').first().click();
                    await page.evaluate(() => location.reload());
                    await expect.poll(() => native.length).toBe(1);
                    await expectSamePlayingMedia(surface);
                    await page.close({ runBeforeUnload: true });
                    await expect.poll(() => native.length).toBe(2);
                    expect(page.isClosed()).toBe(false);
                    await expectSamePlayingMedia(surface);
                }
                const after = await settledContinuity(surface);
                expectMediaContinuity(before, after);
                expect(after.livekitSocketsOpened).toBe(before.livekitSocketsOpened);
                expect(after.peerConnectionsCreated).toBe(before.peerConnectionsCreated);
                await testInfo.attach('history-native-real-media', { body: JSON.stringify({ before, after, native, mobileNativeExcluded: isMobile }, null, 2), contentType: 'application/json' });
                await page.evaluate(() => history.back());
                await page.getByRole('button', { name: 'Leave the room', exact: true }).click();
                await expect(page).toHaveURL(new RegExp('/\\?continuity-prior$'));
            } finally { await stopPublisher(); }
        });
    });
}

test('live continuity without capture: full-stack ended Staff event releases parent and room guards', async ({ page, browser, baseURL }) => {
    test.slow();
    await withResetSessionLifecycle(continuityDatabase(), SESSION_ES.id, async () => {
        await withSessionStatus(continuityDatabase(), SESSION_ES.id, 'LIVE', async () => {
            const stopPublisher = await syntheticPublisher(browser, baseURL!);
            const adminContext = await browser.newContext({ baseURL, ignoreHTTPSErrors: accountFixtureEnabled() });
            try {
                await loginForContinuity(page, 'OPERATOR', 'Terminal operator', ROUTES.opsSession(SESSION_ES.id));
                const surface = await liveRoomSurface(page, 'OPERATOR');
                await rememberPlayingMedia(surface, stopPublisher.sources);
                await expectSamePlayingMedia(surface);
                await setLiveLocale(page, 'en');
                await expectSamePlayingMedia(surface);
                const admin = await adminContext.newPage();
                await loginForContinuity(admin, 'ADMIN', 'Terminal controller', '/');
                await surface.getByRole('button', { name: 'Leave session', exact: true }).click();
                await expect(page.getByRole('alertdialog')).toBeVisible();
                const ended = await admin.request.post(`/api/ops/sessions/${SESSION_ES.id}/lifecycle`, { data: { status: 'ENDED' } });
                expect(ended.ok()).toBe(true);
                await expect(page.getByRole('alertdialog')).toHaveCount(0, { timeout: 30_000 });
                await expect(surface.getByTestId('connection-state')).toHaveCount(0);
                let native = 0;
                page.on('dialog', async dialog => { native++; await dialog.dismiss(); });
                await page.route('https://listen.harmonicbeacon.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Ended event exit</h1>' }));
                await (await globalListenLink(page)).click();
                await expect(page.getByRole('heading', { name: 'Ended event exit' })).toBeVisible();
                expect(native).toBe(0);
            } finally { await adminContext.close(); await stopPublisher(); }
        });
    });
});

let fixture: Awaited<ReturnType<typeof navigationBrowser>>;
test.describe('live continuity without capture', () => {
    test.beforeAll(async () => { fixture = await navigationBrowser(); });
    test.afterAll(async () => { await fixture?.close(); });
    test('the real account menu stays open and focused on Stay; sign-out executes once on approval', async ({ page }) => {
        let logouts = 0;
        await page.route('**/api/auth/logout', route => { logouts++; return route.fulfill({ json: { ok: true } }); });
        await page.goto(`${fixture.origin}/session/event-1?real-navigation`, { waitUntil: 'domcontentloaded' });
        await page.getByLabel('Room draft').fill('signout retained');
        await page.locator('hb-global-nav .account-trigger').click();
        const signout = page.getByRole('menuitem', { name: 'Sign out', exact: true });
        await signout.click();
        await page.getByRole('button', { name: 'Stay in the room', exact: true }).click();
        await expect(signout).toBeVisible();
        await expect(signout).toBeFocused();
        expect(logouts).toBe(0);
        await expect(page.getByLabel('Room draft')).toHaveValue('signout retained');
        await signout.click();
        await page.keyboard.press('Escape');
        await expect(signout).toBeFocused();
        await signout.click();
        await page.getByRole('button', { name: 'Leave the room', exact: true }).click();
        await expect(page).toHaveURL(`${fixture.origin}/`);
        expect(logouts).toBe(1);
    });
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
    test('approved native Staff reload produces a single browser prompt, not another from its frame', async ({ page, isMobile }) => {
        test.skip(isMobile, 'Mobile native beforeunload is not guaranteed; desktop engines own this API gate');
        await page.goto(`${fixture.origin}/ops/events/event-1`, { waitUntil: 'domcontentloaded' });
        const room = page.frameLocator('[data-testid="persistent-room"]');
        await room.getByLabel('Room draft').fill('before reload');
        await room.getByRole('button', { name: 'Exit room', exact: true }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await page.keyboard.press('Escape');
        const native: string[] = [];
        page.on('dialog', async dialog => { native.push(dialog.type()); await dialog.accept(); });
        // Explicit top-level pointer activation, not fill() or focus restoration.
        await page.getByRole('button', { name: 'EN', exact: true }).click();
        expect(await page.evaluate(() => navigator.userActivation.hasBeenActive)).toBe(true);
        // Firefox's automation page.reload() bypasses beforeunload. Initiate a
        // real document reload and await its commit without bypassing the guard.
        await Promise.all([
            page.waitForEvent('domcontentloaded'),
            page.evaluate(() => { setTimeout(() => location.reload(), 0); }),
        ]);
        await expect(room.getByLabel('Room draft')).toHaveValue('draft');
        expect(native).toEqual(['beforeunload']);
    });
    test('embedded native reload cancellation preserves the child and warns only once', async ({ page, isMobile }) => {
        test.skip(isMobile, 'Mobile native beforeunload is not guaranteed; desktop engines own this API gate');
        await page.goto(`${fixture.origin}/ops/events/event-1`, { waitUntil: 'domcontentloaded' });
        const room = page.frameLocator('[data-testid="persistent-room"]');
        await room.getByLabel('Room draft').fill('embedded native retained');
        // Complete the host handshake before exercising the iframe's own unload.
        await room.getByRole('button', { name: 'Exit room', exact: true }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await page.keyboard.press('Escape');
        const native: string[] = [];
        page.on('dialog', async dialog => { native.push(dialog.type()); await dialog.dismiss(); });
        await room.locator('body').evaluate(() => location.reload());
        await expect.poll(() => native.length).toBe(1);
        await expect(room.getByLabel('Room draft')).toHaveValue('embedded native retained');
        expect(native).toEqual(['beforeunload']);
    });
    for (const direction of ['back', 'forward'] as const) {
        test(`same-document ${direction} cancels before URL/state changes and confirms exactly once`, async ({ page }) => {
            await page.goto(`${fixture.origin}/session/event-1`, { waitUntil: 'domcontentloaded' });
            await page.getByRole('button', { name: 'End room', exact: true }).click();
            await page.evaluate(direction => {
                history.replaceState({ fixture: 'prior' }, '', '/away?prior');
                history.pushState({ fixture: 'room' }, '', '/session/event-1');
                if (direction === 'forward') { history.pushState({ fixture: 'next' }, '', '/away?next'); history.back(); }
            }, direction);
            await expect(page).toHaveURL(`${fixture.origin}/session/event-1`);
            await page.getByRole('button', { name: 'Start room', exact: true }).click();
            await page.getByLabel('Room draft').fill('history retained');
            const original = await page.evaluate(() => history.state);
            await page.evaluate(direction => history[direction](), direction);
            await expect(page.getByRole('alertdialog')).toBeVisible();
            await expect(page).toHaveURL(`${fixture.origin}/session/event-1`);
            await page.keyboard.press('Escape');
            expect(await page.evaluate(() => history.state)).toEqual(original);
            await expect(page.getByLabel('Room draft')).toHaveValue('history retained');
            await expect(page.getByLabel('Room draft')).toBeFocused();
            await page.evaluate(direction => history[direction](), direction);
            await page.getByRole('button', { name: 'Leave the room', exact: true }).click();
            await expect(page).toHaveURL(new RegExp(`/away\\?${direction === 'back' ? 'prior' : 'next'}$`));
        });
    }
    test('Staff root and embedded exits share one dialog; untrusted messages cannot disarm it', async ({ page }) => {
        await page.goto(`${fixture.origin}/ops/events/event-1`, { waitUntil: 'domcontentloaded' });
        const room = page.frameLocator('[data-testid="persistent-room"]');
        await room.getByLabel('Room draft').fill('staff retained');
        const native: string[] = [];
        page.on('dialog', async dialog => { native.push(dialog.type()); await dialog.dismiss(); });
        await page.getByRole('button', { name: /Hands/ }).click();
        await page.getByRole('link', { name: 'Global exit', exact: true }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.getByRole('button', { name: /Return to the live room/ })).toBeVisible();
        await page.getByRole('button', { name: /Return to the live room/ }).click();
        await room.getByRole('button', { name: 'Exit room', exact: true }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await expect(room.getByRole('alertdialog')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await expect(room.getByRole('button', { name: 'Exit room', exact: true })).toBeFocused();
        await expect(room.getByLabel('Room draft')).toHaveValue('staff retained');
        await page.evaluate(() => {
            const frame = document.querySelector('iframe')!;
            const data = { type: 'hb-room-exit', sessionId: 'event-1', event: 'state', active: false };
            window.dispatchEvent(new MessageEvent('message', { origin: 'https://invalid.example', source: frame.contentWindow, data }));
            window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: window, data }));
        });
        await page.getByRole('link', { name: 'Shadow exit', exact: true }).click();
        await page.getByRole('button', { name: 'Leave the room', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Away' })).toBeVisible();
        expect(native).toEqual([]);
    });
    test('native reload and tab-close cancellation keep media; ended rooms do not warn', async ({ page, isMobile }) => {
        test.skip(isMobile, 'Mobile native beforeunload is not guaranteed; desktop engines own this API gate');
        await page.goto(`${fixture.origin}/session/event-1`, { waitUntil: 'domcontentloaded' });
        await page.getByLabel('Room draft').fill('native retained');
        // fill() alone does not grant Firefox sticky user activation for native unload.
        await page.getByLabel('Room draft').click();
        const dialogs: string[] = [];
        page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.dismiss(); });
        await page.evaluate(() => location.reload());
        await expect.poll(() => dialogs.length).toBe(1);
        await expect(page.getByLabel('Room draft')).toHaveValue('native retained');
        await page.close({ runBeforeUnload: true });
        await expect.poll(() => dialogs.length).toBe(2);
        expect(page.isClosed()).toBe(false);
        expect(dialogs).toEqual(['beforeunload', 'beforeunload']);
        await page.getByRole('button', { name: 'End room', exact: true }).click();
        await page.reload({ waitUntil: 'domcontentloaded' });
        await expect(page.getByLabel('Room draft')).toHaveValue('draft');
        expect(dialogs).toHaveLength(2);
    });
    test('guarded links include shadow DOM; Escape preserves the room and confirmation unloads once', async ({ page }) => {
        await page.goto(`${fixture.origin}/session/event-1`, { waitUntil: 'domcontentloaded' });
        await page.getByLabel('Room draft').fill('keep');
        const native: string[] = [];
        page.on('dialog', async dialog => { native.push(dialog.type()); await dialog.dismiss(); });
        for (const name of ['Global exit', 'Shadow exit']) {
            await page.getByRole('link', { name, exact: true }).click();
            await expect(page.getByRole('alertdialog')).toBeVisible();
            await page.keyboard.press('Escape');
            await expect(page.getByRole('link', { name, exact: true })).toBeFocused();
            await expect(page.getByLabel('Room draft')).toHaveValue('keep');
        }
        await page.getByRole('link', { name: 'Local panel', exact: true }).click();
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
        const popupPromise = page.waitForEvent('popup');
        await page.getByRole('link', { name: 'New tab', exact: true }).click();
        await (await popupPromise).close();
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
        await page.getByRole('link', { name: 'Global exit', exact: true }).click();
        await page.getByRole('button', { name: 'Leave the room', exact: true }).click();
        await expect(page.getByRole('heading', { name: 'Away' })).toBeVisible();
        expect(native).toEqual([]);
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
