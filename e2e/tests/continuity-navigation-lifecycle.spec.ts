import { test, expect } from '@playwright/test';
import { navigationBrowser } from '../fixtures/navigation-browser';

for (const role of ['attendee', 'staff'] as const) {
    test(`lifecycle: ${role} native reload cancellation with real pointer activation retains its document`, async ({ page }) => {
        const fixture = await navigationBrowser();
        try {
            await page.goto(`${fixture.origin}/${role === 'attendee' ? 'session/event-1' : 'ops/events/event-1'}`, { waitUntil: 'load' });
            const surface = role === 'attendee' ? page : page.frames().find(frame => frame.url().includes('/session/'))!;
            const draft = surface.getByLabel('Room draft');
            await draft.fill('retained by cancelled departure');
            // fill() is not sticky activation in Firefox; a real click is.
            await draft.click();
            const native: string[] = [];
            page.on('dialog', async dialog => { native.push(dialog.type()); await dialog.dismiss(); });
            await page.evaluate(() => { setTimeout(() => location.reload(), 0); });
            await expect.poll(() => native.length).toBe(1);
            await expect(draft).toHaveValue('retained by cancelled departure');
            if (role === 'staff') {
                await draft.click();
                await surface.evaluate(() => { setTimeout(() => location.reload(), 0); });
                await expect.poll(() => native.length).toBe(2);
                await expect(draft).toHaveValue('retained by cancelled departure');
            }
            expect(native.every(type => type === 'beforeunload')).toBe(true);
        } finally { await page.close(); await fixture.close(); }
    });
}

test('lifecycle: component fixture reaches a committed load before history testing', async ({ page }) => {
    const fixture = await navigationBrowser();
    try {
        await page.goto(`${fixture.origin}/session/event-1`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByLabel('Room draft')).toBeVisible();
        await page.waitForLoadState('load', { timeout: 5000 });
    } finally { await page.close(); await fixture.close(); }
});

test('lifecycle: a replaced iframe error document invalidates ownership and pending approval', async ({ page }) => {
    const fixture = await navigationBrowser();
    try {
        await page.goto(`${fixture.origin}/ops/events/event-1`, { waitUntil: 'domcontentloaded' });
        const frame = page.frameLocator('[data-testid="persistent-room"]');
        await frame.getByRole('button', { name: 'Exit room', exact: true }).click();
        await expect(page.getByRole('alertdialog')).toBeVisible();
        // A scriptless replacement cannot send React cleanup or state:false.
        // Suppress native confirmation only in the fixture to force replacement.
        await page.locator('[data-testid="persistent-room"]').evaluate((node: HTMLIFrameElement) => {
            node.contentWindow!.addEventListener('beforeunload', event => event.stopImmediatePropagation(), true);
            node.src = 'about:blank';
        });
        await expect.poll(() => page.locator('[data-testid="persistent-room"]').evaluate((node: HTMLIFrameElement) => node.contentDocument?.URL)).toBe('about:blank');
        await expect(page.getByRole('alertdialog')).toHaveCount(0);
        expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(true);
    } finally { await page.close(); await fixture.close(); }
});

test('lifecycle: stale old-document hello cannot disarm a newly registered room', async ({ page }) => {
    const fixture = await navigationBrowser();
    try {
        await page.addInitScript(() => {
            window.addEventListener('message', event => {
                if (event.data?.type === 'hb-room-exit' && event.data.event === 'state') {
                    document.body.dataset.lastRoomState = JSON.stringify(event.data);
                }
            });
        });
        await page.goto(`${fixture.origin}/ops/events/event-1`, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('body')).toHaveAttribute('data-last-room-state', /"active":true/);
        const old = JSON.parse((await page.locator('body').getAttribute('data-last-room-state'))!);
        await page.locator('[data-testid="persistent-room"]').evaluate((node: HTMLIFrameElement) => {
            node.contentWindow!.addEventListener('beforeunload', event => event.stopImmediatePropagation(), true);
            node.src = 'about:blank';
        });
        await expect.poll(() => page.locator('[data-testid="persistent-room"]').evaluate((node: HTMLIFrameElement) => node.contentDocument?.URL)).toBe('about:blank');
        await page.locator('[data-testid="persistent-room"]').evaluate((node: HTMLIFrameElement) => { node.src = '/session/event-1?surface=cockpit'; });
        await expect.poll(async () => JSON.parse((await page.locator('body').getAttribute('data-last-room-state'))!).generation).not.toBe(old.generation);
        await expect(page.locator('body')).toHaveAttribute('data-last-room-state', /"active":true/);
        await page.evaluate(old => {
            const source = document.querySelector<HTMLIFrameElement>('[data-testid="persistent-room"]')!.contentWindow;
            window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source, data: { ...old, event: 'hello' } }));
            window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source, data: old }));
        }, old);
        expect(await page.evaluate(() => window.dispatchEvent(new Event('beforeunload', { cancelable: true })))).toBe(false);
    } finally { await page.close(); await fixture.close(); }
});

test('lifecycle: fallback still protects same-document entries after reload', async ({ page }) => {
    const fixture = await navigationBrowser();
    try {
        await page.addInitScript(() => Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }));
        await page.goto(`${fixture.origin}/session/event-1`, { waitUntil: 'domcontentloaded' });
        await page.getByRole('button', { name: 'End room', exact: true }).click();
        await page.evaluate(() => {
            history.replaceState({ __NA: true, tree: ['before'] }, '', '/before');
            history.pushState({ __NA: true, tree: ['room'] }, '', '/session/event-1');
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.getByLabel('Room draft').click();
        const restoredState = await page.evaluate(() => history.state);
        const native: string[] = [];
        page.on('dialog', async dialog => { native.push(dialog.type()); await dialog.dismiss(); });
        await page.evaluate(() => history.back());
        // Firefox may retain a cross-document boundary on reload; Chromium
        // reuses these entries in the replacement document. Both must cancel.
        await expect.poll(async () => native.length + await page.getByRole('alertdialog').count()).toBe(1);
        await expect(page).toHaveURL(`${fixture.origin}/session/event-1`);
        if (native.length) expect(native).toEqual(['beforeunload']);
        else await page.getByRole('button', { name: 'Stay in the room', exact: true }).click();
        expect(await page.evaluate(() => history.state)).toEqual(restoredState);
    } finally { await page.close(); await fixture.close(); }
});

test('lifecycle: absent Navigation API preserves exact entries, Next state and Forward on cancellation', async ({ page }) => {
    const fixture = await navigationBrowser();
    try {
        await page.addInitScript(() => Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }));
        await page.goto(`${fixture.origin}/session/event-1`, { waitUntil: 'domcontentloaded' });
        await expect(page.getByRole('button', { name: 'Exit room', exact: true })).toBeVisible();
        await page.evaluate(() => {
            history.replaceState({ __NA: true, tree: ['original'], custom: 1 }, '', '/before');
            history.pushState({ __NA: true, tree: ['room'], custom: 2 }, '', '/session/event-1');
            history.pushState({ __NA: true, tree: ['forward'], custom: 3 }, '', '/after');
        });
        // Inactive traversal positions the cursor with a real forward entry.
        await page.getByRole('button', { name: 'End room', exact: true }).click();
        await page.evaluate(() => history.back());
        await expect(page).toHaveURL(`${fixture.origin}/session/event-1`);
        await page.getByRole('button', { name: 'Start room', exact: true }).click();
        const state = await page.evaluate(() => history.state);
        const length = await page.evaluate(() => history.length);
        await page.evaluate(() => {
            window.addEventListener('popstate', () => document.body.dataset.routerPops = String(Number(document.body.dataset.routerPops || 0) + 1));
            history.back();
        });
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await expect(page).toHaveURL(`${fixture.origin}/session/event-1`);
        await page.getByRole('button', { name: 'Stay in the room', exact: true }).click();
        expect(await page.evaluate(() => history.state)).toEqual(state);
        expect(await page.evaluate(() => history.length)).toBe(length);
        expect(await page.locator('body').getAttribute('data-router-pops')).toBeNull();
        await page.evaluate(() => history.forward());
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await page.getByRole('button', { name: 'Stay in the room', exact: true }).click();
        await expect(page).toHaveURL(`${fixture.origin}/session/event-1`);
        expect(await page.evaluate(() => history.state)).toEqual(state);
        await page.evaluate(() => history.forward());
        await expect(page.getByRole('alertdialog')).toBeVisible();
        await page.getByRole('button', { name: 'Leave the room', exact: true }).click();
        await expect(page).toHaveURL(`${fixture.origin}/after`);
        expect(await page.evaluate(() => history.state)).toMatchObject({ __NA: true, tree: ['forward'], custom: 3 });
        await expect(page.locator('body')).toHaveAttribute('data-router-pops', '1');
    } finally { await page.close(); await fixture.close(); }
});
