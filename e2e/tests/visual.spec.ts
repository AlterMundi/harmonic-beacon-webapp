import { expect, stackTest } from '../fixtures/stack';
import { RoomServiceClient } from 'livekit-server-sdk';
import { loginViaDashboard } from '../fixtures/auth';
import { requireDirectDb, withSessionStatus } from '../fixtures/db';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';
import { startAudioPublishers } from '../fixtures/audio-publishers';
import { denyNativePlayback } from '../helpers/native-playback-denial';

const NOMINAL_CHECK = { status: 'green', detail: 'Nominal fixture', latencyMs: 1 } as const;
const NOMINAL_HEALTH = {
    status: 'green',
    checkedAt: '2026-08-01T14:00:00.000Z',
    session: { id: SESSION_ES.id, title: SESSION_ES.title, status: 'SCHEDULED' },
    checks: {
        postgres: NOMINAL_CHECK,
        livekit: NOMINAL_CHECK,
        stageRoom: NOMINAL_CHECK,
        publisherGrants: NOMINAL_CHECK,
        grantDelivery: NOMINAL_CHECK,
        bedPublisher: NOMINAL_CHECK,
        tapestry: NOMINAL_CHECK,
    },
};

async function resetStageRoom(): Promise<void> {
    const livekitUrl = (process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880')
        .replace(/^ws:/, 'http:')
        .replace(/^wss:/, 'https:');
    const roomService = new RoomServiceClient(
        livekitUrl,
        process.env.E2E_LIVEKIT_API_KEY ?? 'devkey',
        process.env.E2E_LIVEKIT_API_SECRET ?? 'secret',
    );
    const rooms = await roomService.listRooms([SESSION_ES.roomName]);
    if (rooms.some((room) => room.name === SESSION_ES.roomName)) {
        await roomService.deleteRoom(SESSION_ES.roomName);
    }
}

/**
 * Visual regression gate — intentional screenshot baselines at 1440 / 1024 /
 * 768 / 390 / 320 px (the viewport projects in playwright.config.ts).
 *
 * Public and fixture-only role surfaces are captured. Baselines contain no
 * real participant data or imagery. Animations are disabled and a 1% pixel
 * tolerance absorbs font rasterization noise on a single runner (see
 * `expect.toHaveScreenshot` in playwright.config.ts).
 *
 * Baselines are blessed intentionally: regenerate with
 * `npm run test:e2e:update-snapshots` on the reference environment and
 * review the diff before committing. See e2e/README.md.
 */

stackTest.describe('visual baselines', () => {
    stackTest('landing', async ({ page }) => {
        await page.goto(ROUTES.landing);
        await expect(page.getByRole('link', { name: 'Ingresar al evento' })).toHaveCount(4);
        await expect(page).toHaveScreenshot('landing.png', { fullPage: true });
    });

    stackTest('staff login', async ({ page }) => {
        await page.goto(ROUTES.staffLogin);
        await expect(page.locator('#staff-email')).toBeVisible();
        await expect(page).toHaveScreenshot('staff-login.png');
    });

    stackTest('attendee audio prompt', async ({ page, browser }, testInfo) => {
        const db = requireDirectDb(testInfo);
        // This baseline is specifically the blocked-autoplay surface. Publish
        // one real audio-only Beacon source, then deny its native playback;
        // runner autoplay policy can no longer make the CTA disappear.
        await page.addInitScript(denyNativePlayback);
        const stopPublisher = await startAudioPublishers(browser, { beaconOnly: true });
        try {
            await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
                // Earlier media/load scenarios can leave a LiveKit participant
                // visible for a short grace period. Start this visual contract
                // from a genuinely empty stage room instead of blessing that race.
                await resetStageRoom();
                await loginViaDashboard(
                    page,
                    'ATTENDEE',
                    'E2E Attendee',
                    ROUTES.session(SESSION_ES.id),
                );
                await expect(page.getByTestId('connection-state')).toHaveAttribute(
                    'data-state',
                    'connected',
                    { timeout: 20_000 },
                );
                await expect(page.getByRole('button', { name: /Start audio|Iniciar audio/i })).toBeVisible();
                await expect.poll(() => page.evaluate(() => window.nativePlaybackDenialAttempts), {
                    timeout: 30_000,
                }).toBeGreaterThan(0);
                await page.addStyleTag({
                    content: '.event-card[role="group"] > [role="alert"] { display: none !important; }',
                });
                // Camera acquisition is asynchronous. Wait for the complete
                // mobile camera control instead of snapshotting an intermediate
                // state that races between "share" and "stop/switch" controls.
                await expect(page.getByRole('button', {
                    name: /Switch to rear camera|Cambiar a cámara trasera/i,
                })).toBeVisible();
                await expect(page).toHaveScreenshot('attendee-audio-prompt.png', {
                    mask: [page.getByTestId('connection-state').locator('..')],
                    maskColor: '#16120d',
                });
            });
        } finally {
            await stopPublisher();
        }
    });

    stackTest('conductor cockpit', async ({ page }) => {
        await page.route('**/api/ops/health**', (route) => route.fulfill({ json: NOMINAL_HEALTH }));
        await loginViaDashboard(
            page,
            'FACILITATOR',
            'E2E Facilitator',
            ROUTES.opsSession(SESSION_ES.id),
        );
        await expect(page.getByTestId('conductor-cockpit')).toBeVisible();
        await expect(page.locator('[data-signal="stage"]')).toHaveAttribute('data-loaded', 'true');
        await expect(page.locator('[data-signal="health"]')).toContainText('green', { timeout: 15_000 });
        const persistentRoom = page.locator('iframe[data-testid="persistent-room"]');
        await expect(persistentRoom).toBeVisible();
        // The embedded room has its own connected-state visual baseline. Hide
        // it here so LiveKit timing cannot switch this cockpit snapshot between
        // the frame's loading overlay and its loaded room UI.
        await page.addStyleTag({
            content: 'iframe[data-testid="persistent-room"] { visibility: hidden !important; }',
        });
        await expect(page).toHaveScreenshot('conductor-cockpit.png', {
            fullPage: true,
        });
    });

    stackTest('event hub', async ({ page }) => {
        await loginViaDashboard(page, 'OPERATOR', 'E2E Operator', ROUTES.opsEvents);
        await expect(page.getByRole('heading', { name: /Eventos|Events/i })).toBeVisible();
        await expect(page).toHaveScreenshot('event-hub.png', { fullPage: true });
    });

    stackTest('admission operations', async ({ page }) => {
        await loginViaDashboard(page, 'FACILITATOR_OP', 'E2E Conductor', ROUTES.opsAdmission);
        await expect(page.getByRole('heading', { name: /Buscar entrada|Look up ticket/i })).toBeVisible();
        await expect(page).toHaveScreenshot('admission.png', { fullPage: true });
    });

    stackTest('event health', async ({ page }) => {
        await page.route('**/api/ops/health**', (route) => route.fulfill({ json: NOMINAL_HEALTH }));
        await page.route('**/api/tapestry/**', (route) => route.fulfill({ status: 404 }));
        await loginViaDashboard(page, 'FACILITATOR_OP', 'E2E Conductor', ROUTES.opsHealth);
        await expect(page.getByText(/(?:VERDE|GREEN) —/i)).toBeVisible();
        await expect(page).toHaveScreenshot('event-health.png', { fullPage: true });
    });
});
