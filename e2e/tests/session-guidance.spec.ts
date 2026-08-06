import { expect, stackTest } from '../fixtures/stack';
import { loginAttendeeWithTicket } from '../fixtures/auth';
import { SESSION_ES, TICKETS } from '../fixtures/test-data';
import { requireDirectDb, withSessionStatus } from '../fixtures/db';
import {
    expectMediaContinuity,
    installMediaProbe,
    mediaProbeSnapshot,
} from '../helpers/media-probe';

/**
 * UX-COPY-01 (#142): the listening guidance end to end, in real browsers
 * against the real stack.
 *
 * Test 1 proves the pre-room surface: while the doors are closed the
 * attendee sees the guidance disclosure next to the waiting card, opens it,
 * and reads the full guidance (intention, volume, balance, camera/mic).
 *
 * Test 2 is the media-continuity guard from the issue: opening and closing
 * the guidance inside the live room must not disturb the audio/scene
 * pipeline. It reuses the TAP media probe and skips precisely when LiveKit
 * is unreachable, like the canonical continuity suite. It also proves the
 * disclosure sits next to the volume controls without overlapping them.
 */

const LIVEKIT_URL = process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880';

const ATTENDEE_A = {
    name: 'E2E Attendee',
    email: 'e2e.attendee@altermundi.net',
    code: TICKETS.esIssuedA,
} as const;

async function livekitReachable(): Promise<boolean> {
    const httpUrl = LIVEKIT_URL.replace(/^ws/, 'http');
    try {
        const response = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) });
        return response.ok;
    } catch {
        return false;
    }
}

stackTest.describe('session listening guidance (#142)', () => {
    stackTest('waiting attendee can read the guidance before the doors open', async ({
        browser,
    }, testInfo) => {
        stackTest.slow();
        const db = requireDirectDb(testInfo);
        // Doors closed: the entry gate holds the attendee in the WAITING
        // surface, where the guidance lives next to the waiting card.
        await withSessionStatus(db, SESSION_ES.id, 'SCHEDULED', async () => {
            const context = await browser.newContext();
            const page = await context.newPage();
            try {
                await loginAttendeeWithTicket(page, ATTENDEE_A);
                await page.waitForURL(`**/session/${SESSION_ES.id}`);

                const guidance = page.getByTestId('session-guidance');
                await expect(guidance).toBeVisible({ timeout: 30_000 });

                const toggle = guidance.getByRole('button');
                await expect(toggle).toHaveAttribute('aria-expanded', 'false');
                // The label is always visible text, never an icon-only control.
                await expect(toggle).toContainText(/Cómo funciona la escucha|How listening works/);

                await toggle.click();
                await expect(toggle).toHaveAttribute('aria-expanded', 'true');
                await expect(
                    guidance.getByText(/buscar una pregunta|look for a question/),
                ).toBeVisible();
                await expect(
                    guidance.getByText(/volumen general controla|Overall volume controls/),
                ).toBeVisible();
                await expect(
                    guidance.getByText(/balance elige|balance chooses/),
                ).toBeVisible();
                await expect(
                    guidance.getByText(/Apagar la cámara no apaga|Turning off your camera/),
                ).toBeVisible();

                // Keyboard path: close with Enter, focus stays on the toggle.
                await toggle.focus();
                await page.keyboard.press('Enter');
                await expect(toggle).toHaveAttribute('aria-expanded', 'false');
                await expect(toggle).toBeFocused();
            } finally {
                await context.close();
            }
        });
    });

    stackTest('opening the guidance in the room never disturbs the audio/scene pipeline', async ({
        browser,
    }, testInfo) => {
        testInfo.skip(
            !(await livekitReachable()),
            `LiveKit not reachable at ${LIVEKIT_URL} — start the dev server (see e2e/README.md) or set E2E_LIVEKIT_URL`,
        );
        stackTest.slow();
        const db = requireDirectDb(testInfo);
        await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
            const context = await browser.newContext();
            const page = await context.newPage();
            try {
                await installMediaProbe(page);
                await loginAttendeeWithTicket(page, ATTENDEE_A);
                await page.waitForURL(`**/session/${SESSION_ES.id}`);
                await expect(page.getByTestId('connection-state')).toHaveAttribute(
                    'data-state',
                    'connected',
                    { timeout: 30_000 },
                );
                await page.getByRole('button', { name: /Start audio|Iniciar audio/i }).click();

                // Baseline: let the media pipeline settle before touching the
                // guidance (same stable-read discipline as the canonical
                // continuity suite: counters frozen for 4 consecutive reads).
                let baseline = await mediaProbeSnapshot(page);
                let stableReads = 0;
                for (let attempt = 0; attempt < 20 && stableReads < 4; attempt += 1) {
                    await page.waitForTimeout(250);
                    const current = await mediaProbeSnapshot(page);
                    const unchanged =
                        current.audioElements === baseline.audioElements &&
                        current.videoElements === baseline.videoElements &&
                        current.playCalls === baseline.playCalls &&
                        current.mediaElementsAttached === baseline.mediaElementsAttached &&
                        current.mediaElementsRemoved === baseline.mediaElementsRemoved;
                    stableReads = unchanged ? stableReads + 1 : 0;
                    baseline = current;
                }

                const guidance = page.getByTestId('session-guidance');
                const toggle = guidance.getByRole('button');

                // The disclosure sits right above the volume controls it
                // explains, without overlapping them or the scene.
                const toggleBox = await toggle.boundingBox();
                const volumeBox = await page.locator('#room-master-volume').boundingBox();
                expect(toggleBox, 'guidance toggle has no layout box').not.toBeNull();
                expect(volumeBox, 'master volume has no layout box').not.toBeNull();
                expect(toggleBox!.y + toggleBox!.height).toBeLessThanOrEqual(volumeBox!.y + 2);
                expect(toggleBox!.x).toBeGreaterThanOrEqual(0);
                expect(toggleBox!.x + toggleBox!.width).toBeLessThanOrEqual(
                    page.viewportSize()!.width + 1,
                );

                // Exercise the disclosure: open, read, close.
                await expect(toggle).toHaveAttribute('aria-expanded', 'false');
                await toggle.click();
                await expect(toggle).toHaveAttribute('aria-expanded', 'true');
                await expect(
                    guidance.getByText(/Apagar la cámara no apaga|Turning off your camera/),
                ).toBeVisible();
                await page.waitForTimeout(500);
                await toggle.click();
                await expect(toggle).toHaveAttribute('aria-expanded', 'false');
                await page.waitForTimeout(2_500);

                const afterGuidance = await mediaProbeSnapshot(page);
                expectMediaContinuity(baseline, afterGuidance, {
                    // Headless Firefox keeps LiveKit's global autoplay-unlock
                    // listener active and retries resume() on every user gesture,
                    // even while sockets, peers, media elements and play() stay
                    // untouched. That browser behavior cannot be attributed to
                    // this disclosure; all structural media invariants remain strict.
                    ignoreAmbientAudioContextResumes: testInfo.project.name === 'firefox',
                });
            } finally {
                await context.close();
            }
        });
    });
});
