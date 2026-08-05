import { expect, stackTest } from '../fixtures/stack';
import { loginViaDashboard } from '../fixtures/auth';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';

/**
 * TAP-02 request measurement (issue #129, PR #145): the operational tapestry
 * must stay O(1) — one manifest JSON + one composite image per poll cycle —
 * regardless of participant count. Measured in a real browser against the
 * real cockpit, with 0, 1, 50 and 150 manifest entries. The hand-queue spec
 * covers the same discipline for the spotlight drawer.
 */

type ManifestEntry = {
    tileId: string;
    displayName: string;
    handRaised: boolean;
    queuePosition: number | null;
    presence: 'connected';
    camera: 'on';
    column: number;
    row: number;
};

function manifestFor(count: number) {
    const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
    const rows = Math.max(1, Math.ceil(count / columns));
    const entries: ManifestEntry[] = Array.from({ length: count }, (_, i) => ({
        tileId: `tp-${i + 1}`,
        displayName: `Tapestry Person ${i + 1}`,
        handRaised: i === 0,
        queuePosition: i === 0 ? 1 : null,
        presence: 'connected',
        camera: 'on',
        column: i % columns,
        row: Math.floor(i / columns),
    }));
    return {
        sessionId: SESSION_ES.id,
        revision: 'measurement-rev',
        liveStateAvailable: true,
        layout: { revision: 7, columns, rows, tileSizePx: 100 },
        tileFreshForSeconds: 10,
        entries,
        waitingHands: count > 0
            ? [{ displayName: 'Tapestry Person 1', queuePosition: 1, tileId: 'tp-1' }]
            : [],
    };
}

stackTest('operational tapestry stays O(1) at 0/1/50/150 participants', async ({ page }) => {
    stackTest.slow();
    let count = 0;
    const counters = { manifest: 0, composite: 0, tiles: 0 };

    page.on('request', (request) => {
        // Only the main frame's cockpit counts; the room iframe has its own
        // optional composite poll covered by its own contract.
        if (request.frame() !== page.mainFrame()) return;
        const url = request.url();
        if (url.includes(`/api/ops/sessions/${SESSION_ES.id}/tapestry/manifest`)) counters.manifest += 1;
        else if (url.includes(`/api/ops/sessions/${SESSION_ES.id}/tapestry/tiles/`)) counters.tiles += 1;
        else if (url.includes(`/api/tapestry/${SESSION_ES.id}`)) counters.composite += 1;
    });

    await page.route(`**/api/ops/sessions/${SESSION_ES.id}/tapestry/manifest`, async (route) => {
        await route.fulfill({ json: manifestFor(count) });
    });
    await page.route(`**/api/tapestry/${SESSION_ES.id}`, async (route) => {
        await route.fulfill({
            body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
            contentType: 'image/gif',
            headers: { 'x-tapestry-revision': '7' },
        });
    });
    await page.route(`**/api/ops/sessions/${SESSION_ES.id}/tapestry/tiles/**`, async (route) => {
        await route.fulfill({ status: 404 });
    });

    await loginViaDashboard(page, 'OPERATOR', 'Tapestry Measure Op', ROUTES.opsSession(SESSION_ES.id));

    // Drawer closed: the operational tapestry spends nothing at all.
    await page.waitForTimeout(7_000);
    expect(counters).toEqual({ manifest: 0, composite: 0, tiles: 0 });

    await page.locator('[data-tool="tapestry"]').click();
    const drawer = page.getByRole('dialog');
    const section = drawer.getByRole('region', { name: /Operational tapestry|Tapiz operativo/i });
    await expect(section).toBeVisible();

    for (const n of [0, 1, 50, 150]) {
        count = n;
        const before = { ...counters };
        if (n > 0) {
            await expect(section.getByText(`Tapestry Person ${n}`, { exact: true })).toBeVisible({
                timeout: 10_000,
            });
        } else {
            await expect(section.getByText(/No tiles yet|Todavía no hay teselas/i)).toBeVisible({
                timeout: 10_000,
            });
        }
        // Two more full poll cycles (3s each) beyond the first render.
        await page.waitForTimeout(7_000);
        const spent = {
            manifest: counters.manifest - before.manifest,
            composite: counters.composite - before.composite,
            tiles: counters.tiles - before.tiles,
        };
        // ~3 cycles in the window: strictly bounded, independent of N.
        expect(spent.manifest, `manifest requests at ${n} participants`).toBeLessThanOrEqual(4);
        expect(spent.composite, `composite requests at ${n} participants`).toBeLessThanOrEqual(4);
        expect(spent.tiles, `per-tile requests at ${n} participants`).toBe(0);
        // Exactly one image carries the whole room.
        await expect(section.getByRole('img')).toHaveCount(1);
        if (n > 0) {
            await expect(section.getByRole('listitem')).toHaveCount(n);
        }
    }
});
