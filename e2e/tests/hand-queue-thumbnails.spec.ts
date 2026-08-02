import { expect, stackTest } from '../fixtures/stack';
import { loginViaDashboard } from '../fixtures/auth';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';

type HandFixture = ReturnType<typeof handFixture>;

function handFixture(index: number, withImage = true) {
    const displayName = `Queue Person ${index + 1}`;
    return {
        id: `queue-person-${index + 1}`,
        identity: `opaque-queue-person-${index + 1}`,
        displayName,
        principalType: 'attendee',
        staffRole: null,
        isAssignedFacilitator: false,
        joinedAt: '2026-08-01T15:00:00.000Z',
        leftAt: null,
        raisedAt: new Date(Date.UTC(2026, 7, 1, 15, 0, index)).toISOString(),
        queuePosition: index + 1,
        canPublish: false,
        stageState: 'AUDIENCE',
        grantVersion: 0,
        reconcileNeeded: false,
        connected: true,
        media: [],
        connectionQuality: null,
        thumbnailUrl: withImage
            ? `/api/ops/sessions/${SESSION_ES.id}/tapestry/tiles/tp-${index + 1}?v=1`
            : null,
    };
}

function queueSnapshot(participants: HandFixture[]) {
    return {
        sessionId: SESSION_ES.id,
        maxPublishers: 6,
        activePublishers: 0,
        grantedPublishers: 0,
        liveStateAvailable: true,
        tapestryThumbnailsAvailable: true,
        thumbnailFreshForSeconds: 10,
        participants,
    };
}

stackTest('private hand thumbnails remain bounded, accessible and actionable at 0/1/50 rows', async ({
    page,
}) => {
    stackTest.slow();
    let participants: HandFixture[] = [];
    let snapshotRequests = 0;
    const tileRequests = new Set<string>();

    await page.route(`**/api/ops/sessions/${SESSION_ES.id}/participants`, async (route) => {
        snapshotRequests += 1;
        await route.fulfill({ json: queueSnapshot(participants) });
    });
    await page.route(`**/api/ops/sessions/${SESSION_ES.id}/tapestry/tiles/**`, async (route) => {
        tileRequests.add(new URL(route.request().url()).pathname);
        // A valid one-pixel GIF is sufficient for the browser image lifecycle;
        // the production route itself is separately contract-tested as JPEG.
        await route.fulfill({
            body: Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64'),
            contentType: 'image/gif',
            headers: { 'cache-control': 'private, max-age=4' },
        });
    });

    await loginViaDashboard(
        page,
        'OPERATOR',
        'Queue Test Operator',
        ROUTES.opsSession(SESSION_ES.id),
    );
    await page.locator('[data-signal="hands"]').click();
    const drawer = page.getByRole('dialog');

    await expect(drawer.getByText(/No hands raised|No hay manos levantadas/i)).toBeVisible();

    participants = [handFixture(0)];
    const firstRow = drawer.locator('li').filter({ hasText: 'Queue Person 1' });
    await expect(firstRow.getByRole('img', {
        name: /Recent tapestry snapshot of Queue Person 1|Imagen reciente del tapiz de Queue Person 1/i,
    })).toBeVisible({ timeout: 10_000 });

    const firstGiveFloor = firstRow.getByRole('button', { name: /Give floor|Dar la palabra/i });
    const firstRemoveHand = firstRow.getByRole('button', { name: /Remove hand|Quitar mano/i });
    await firstGiveFloor.focus();
    await page.keyboard.press('Tab');
    await expect(firstRemoveHand).toBeFocused();

    participants = Array.from({ length: 50 }, (_, index) => handFixture(index, index % 2 === 0));
    const requestsBeforeFifty = snapshotRequests;
    await expect(drawer.getByText('#50 — Queue Person 50 · ID erson-50')).toBeVisible({
        timeout: 10_000,
    });
    expect(snapshotRequests - requestsBeforeFifty).toBeLessThanOrEqual(2);
    await expect(drawer.getByRole('button', { name: /Give floor|Dar la palabra/i })).toHaveCount(50);
    await expect(drawer.getByRole('button', { name: /Remove hand|Quitar mano/i })).toHaveCount(50);
    await expect(drawer.getByRole('img', { name: /Recent tapestry snapshot|Imagen reciente del tapiz/i })).toHaveCount(25);
    await expect(drawer.getByRole('img', { name: /no current tapestry snapshot|sin imagen actual del tapiz/i })).toHaveCount(25);
    expect(tileRequests.size).toBeLessThanOrEqual(25);
});
