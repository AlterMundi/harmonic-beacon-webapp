import { expect, stackTest } from '../fixtures/stack';
import { loginViaDashboard } from '../fixtures/auth';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';
import { requireDirectDb, withSessionStatus } from '../fixtures/db';
import {
    expectMediaContinuity,
    installMediaProbe,
    mediaProbeSnapshot,
    rtcAudioStatsSnapshot,
} from '../helpers/media-probe';

/**
 * Media-continuity gate (issue #69 — media invariants; epic #64 rubric §4).
 *
 * Proves, in a real browser against a real LiveKit server, that interacting
 * with every panel/control mounted in the live session shell causes:
 * - zero room disconnects (signaling socket / RTCPeerConnection closures),
 * - zero duplicate or detached media elements,
 * - exactly one audio-activation gesture for the session lifetime,
 * - zero new AudioContexts after activation (no gain/codec/buffer churn can
 *   hide behind a rebuilt audio pipeline).
 *
 * The probe is panel-agnostic. The canonical staff cockpit keeps its one room
 * in a same-origin persistent frame so opening operational drawers cannot
 * replace the room or its audio provider; the second test exercises that
 * boundary directly inside the frame.
 *
 * Requires the full local stack plus a LiveKit server (see e2e/README.md);
 * without LiveKit the suite skips with a precise reason rather than
 * weakening its assertions.
 */

const LIVEKIT_URL = process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880';

async function livekitReachable(): Promise<boolean> {
    const httpUrl = LIVEKIT_URL.replace(/^ws/, 'http');
    try {
        const response = await fetch(httpUrl, { signal: AbortSignal.timeout(3000) });
        return response.ok;
    } catch {
        return false;
    }
}

async function settledMediaSnapshot(
    frame: import('@playwright/test').Frame | import('@playwright/test').Page,
): Promise<Awaited<ReturnType<typeof mediaProbeSnapshot>>> {
    let previous = await mediaProbeSnapshot(frame);
    let stableReads = 0;
    for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const current = await mediaProbeSnapshot(frame);
        const unchanged =
            current.audioElements === previous.audioElements &&
            current.videoElements === previous.videoElements &&
            current.playCalls === previous.playCalls &&
            current.mediaElementsAttached === previous.mediaElementsAttached &&
            current.mediaElementsRemoved === previous.mediaElementsRemoved;
        stableReads = unchanged ? stableReads + 1 : 0;
        previous = current;
        if (stableReads >= 4) return current;
    }
    throw new Error('cockpit preview media did not settle before panel exercise');
}

async function leaveConnectedRoom(
    surface: import('@playwright/test').Frame | import('@playwright/test').Page,
): Promise<void> {
    const leave = surface.getByRole('button', { name: /Leave session|Salir de la sesión/i });
    if (await leave.isVisible()) {
        await leave.click();
        await expect(surface.getByTestId('connection-state')).toHaveCount(0);
    }
}

stackTest.describe('media continuity', () => {
    stackTest.beforeEach(async ({}, testInfo) => {
        testInfo.skip(
            !(await livekitReachable()),
            `LiveKit not reachable at ${LIVEKIT_URL} — start the dev server (see e2e/README.md) or set E2E_LIVEKIT_URL`,
        );
    });

    stackTest('room controls never disconnect rooms, duplicate media, or re-activate audio', async ({
        browser,
    }, testInfo) => {
        stackTest.slow();

        // Doors open for the duration of the test: attendees only receive
        // stage tokens for LIVE sessions (src/lib/room-entitlement.ts).
        const db = requireDirectDb(testInfo);
        await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
        // --- Facilitator publishes mic + camera into the stage room. ---
        const facilitatorContext = await browser.newContext();
        const facilitator = await facilitatorContext.newPage();
        await loginViaDashboard(
            facilitator,
            'FACILITATOR',
            'E2E Facilitator',
            ROUTES.session(SESSION_ES.id),
        );
        await expect(facilitator.getByTestId('connection-state')).toHaveAttribute(
            'data-state',
            'connected',
            { timeout: 20_000 },
        );
        await facilitator.getByRole('button', { name: /Start audio|Iniciar audio/i }).click();
        await facilitator.getByRole('button', { name: /Unmute microphone|Activar micrófono/i }).click();
        await expect(
            facilitator.getByRole('button', { name: /Mute microphone|Silenciar micrófono/i }),
        ).toBeVisible();
        const qualityMonitor = facilitator.getByTestId('facilitator-audio-quality');
        await expect(qualityMonitor).toBeVisible();
        await expect(qualityMonitor).not.toHaveAttribute('data-severity', 'waiting', { timeout: 10_000 });
        await expect(qualityMonitor).toContainText(/96 kbps/);
        await facilitator.getByRole('button', { name: /Turn camera on|Encender cámara/i }).click();
        await expect(
            facilitator.getByRole('button', { name: /Turn camera off|Apagar cámara/i }),
        ).toBeVisible();

        // --- Attendee joins, activates audio exactly once. ---
        const attendeeContext = await browser.newContext();
        const attendee = await attendeeContext.newPage();
        await installMediaProbe(attendee);
        await loginViaDashboard(
            attendee,
            'ATTENDEE',
            'E2E Attendee',
            ROUTES.session(SESSION_ES.id),
        );
        await expect(attendee.getByTestId('connection-state')).toHaveAttribute(
            'data-state',
            'connected',
            { timeout: 20_000 },
        );

        // The facilitator's published media must arrive exactly once each:
        // one hidden <audio> for the mic, one <video> in the stage tile.
        await expect
            .poll(async () => (await mediaProbeSnapshot(attendee)).audioElements, {
                timeout: 20_000,
                message: 'facilitator mic track never attached an audio element',
            })
            .toBe(1);
        await expect(attendee.getByTestId('stage-tile-video').first()).toBeAttached();

        // The single audio-activation gesture for the whole session.
        await attendee.getByRole('button', { name: /Start audio|Iniciar audio/i }).click();
        const activated = await mediaProbeSnapshot(attendee);
        expect(activated.playCalls).toBeGreaterThan(0);

        // --- Exercise every panel/control mounted in the live shell. ---
        await attendee.getByRole('slider', { name: /Overall room volume|Volumen general de la sala/i }).fill('0.7');
        await attendee.getByRole('slider', { name: /Beacon \/ Session balance|Balance Beacon \/ Sesión/i }).fill('0.25');
        await attendee.getByRole('button', { name: /Raise hand|Levantar la mano/i }).click();
        await expect(
            attendee.getByRole('button', { name: /Lower hand|Bajar la mano/i }),
        ).toBeVisible();
        await attendee.getByRole('button', { name: /Lower hand|Bajar la mano/i }).click();

        const after = await mediaProbeSnapshot(attendee);
        expectMediaContinuity(activated, after);

        // --- Audio-only mode detaches exactly the video, never the audio. ---
        await attendee.getByRole('button', { name: /Switch to audio only|Cambiar a solo audio/i }).click();
        await expect(attendee.getByTestId('stage-tile-video')).toHaveCount(0);
        let snapshot = await mediaProbeSnapshot(attendee);
        expect(snapshot.audioElements).toBe(activated.audioElements);
        expect(snapshot.livekitSocketsClosed).toBe(activated.livekitSocketsClosed);

        await attendee.getByRole('button', { name: /Turn video back on|Volver a encender el video/i }).click();
        await expect(attendee.getByTestId('stage-tile-video').first()).toBeAttached({
            timeout: 20_000,
        });
        snapshot = await mediaProbeSnapshot(attendee);
        expect(snapshot.audioElements).toBe(activated.audioElements);
        expect(snapshot.duplicateMediaSources).toEqual([]);
        expect(snapshot.livekitSocketsClosed).toBe(activated.livekitSocketsClosed);

        const rtcAudioStats = await rtcAudioStatsSnapshot(attendee);
        expect(rtcAudioStats.collectionErrors).toBe(0);
        expect(
            rtcAudioStats.peerConnections.flatMap((connection) => connection.inbound),
            'the subscribed facilitator audio never produced an inbound RTC stats report',
        ).not.toHaveLength(0);
        await testInfo.attach('rtc-audio-stats-attendee.json', {
            body: Buffer.from(`${JSON.stringify(rtcAudioStats, null, 2)}\n`),
            contentType: 'application/json',
        });

        // Send an intentional LiveKit leave before destroying the browser
        // contexts. An abrupt context close keeps the publisher resumable for
        // the server departure timeout and leaks a phantom facilitator into
        // later visual tests that share the fixture room.
        await leaveConnectedRoom(attendee);
        await leaveConnectedRoom(facilitator);
        await attendeeContext.close();
        await facilitatorContext.close();
        });
    });

    stackTest('attendee controls without capture preserve the connected rooms', async ({ page }, testInfo) => {
        await installMediaProbe(page);
        const db = requireDirectDb(testInfo);
        await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
            await loginViaDashboard(
                page,
                'ATTENDEE',
                'E2E Listener',
                ROUTES.session(SESSION_ES.id),
            );
            await expect(page.getByTestId('connection-state')).toHaveAttribute(
                'data-state',
                'connected',
                { timeout: 20_000 },
            );

            await page.getByRole('button', { name: /Start audio|Iniciar audio/i }).click();
            const activated = await settledMediaSnapshot(page);
            expect(activated.livekitSocketsOpened).toBeGreaterThan(0);
            expect(activated.peerConnectionsCreated).toBeGreaterThan(0);

            await page.getByRole('slider', {
                name: /Overall room volume|Volumen general de la sala/i,
            }).fill('0.7');
            await page.getByRole('slider', {
                name: /Beacon \/ Session balance|Balance Beacon \/ Sesión/i,
            }).fill('0.25');
            await page.getByRole('button', { name: /Raise hand|Levantar la mano/i }).click();
            await expect(
                page.getByRole('button', { name: /Lower hand|Bajar la mano/i }),
            ).toBeVisible();
            await page.getByRole('button', { name: /Lower hand|Bajar la mano/i }).click();
            await page.getByRole('button', {
                name: /Switch to audio only|Cambiar a solo audio/i,
            }).click();
            await page.getByRole('button', {
                name: /Turn video back on|Volver a encender el video/i,
            }).click();

            const after = await settledMediaSnapshot(page);
            expect(after.livekitSocketsClosed).toBe(activated.livekitSocketsClosed);
            expect(after.peerConnectionsClosed).toBe(activated.peerConnectionsClosed);
            expect(after.duplicateMediaSources).toEqual([]);
        });
    });

    stackTest('cockpit drawers preserve the single mounted preview room', async ({ page }, testInfo) => {
        await installMediaProbe(page);
        const db = requireDirectDb(testInfo);
        await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
            await loginViaDashboard(
                page,
                'OPERATOR',
                'E2E Operator',
                ROUTES.opsSession(SESSION_ES.id),
            );
            await expect(page.getByTestId('persistent-room')).toHaveCount(1);

            const iframe = page.locator('iframe[data-testid="persistent-room"]');
            const handle = await iframe.elementHandle();
            const roomFrame = await handle?.contentFrame();
            expect(roomFrame, 'persistent room frame did not mount').not.toBeNull();
            if (!roomFrame) return;

            await expect(
                roomFrame.getByTestId('connection-state'),
            ).toHaveAttribute('data-state', 'connected', { timeout: 20_000 });
            const before = await settledMediaSnapshot(roomFrame);
            expect(before.livekitSocketsOpened).toBeGreaterThan(0);
            expect(before.peerConnectionsCreated).toBeGreaterThan(0);

            for (const signal of ['door', 'hands', 'stage', 'primary', 'health']) {
                await page.locator(`[data-signal="${signal}"]`).click();
                const dialog = page.getByRole('dialog');
                await expect(dialog).toBeVisible();
                await dialog.getByRole('button', { name: /Return to the live room|Volver a la sala en vivo/i }).click();
                await expect(dialog).toBeHidden();
                await expect(page.getByTestId('persistent-room')).toHaveCount(1);
            }

            const after = await mediaProbeSnapshot(roomFrame);
            expectMediaContinuity(before, after);
        });
    });

    stackTest('standalone staff room hands media off to the cockpit without duplicate identity', async ({ page }, testInfo) => {
        stackTest.slow();
        const db = requireDirectDb(testInfo);
        await withSessionStatus(db, SESSION_ES.id, 'LIVE', async () => {
            await loginViaDashboard(
                page,
                'FACILITATOR',
                'E2E Facilitator',
                ROUTES.session(SESSION_ES.id),
            );
            await expect(page.getByTestId('connection-state')).toHaveAttribute(
                'data-state',
                'connected',
                { timeout: 20_000 },
            );
            await page.getByRole('button', { name: /Unmute microphone|Activar micrófono/i }).click();
            await page.getByRole('button', { name: /Turn camera on|Encender cámara/i }).click();

            await page.getByRole('button', { name: /Stage and hands|Escena y manos/i }).click();
            await expect(page).toHaveURL(new RegExp(`/ops/events/${SESSION_ES.id}$`));

            const iframe = page.locator('iframe[data-testid="persistent-room"]');
            const handle = await iframe.elementHandle();
            const roomFrame = await handle?.contentFrame();
            expect(roomFrame, 'persistent room frame did not mount after handoff').not.toBeNull();
            if (!roomFrame) return;

            await expect(roomFrame.getByTestId('connection-state')).toHaveAttribute(
                'data-state',
                'connected',
                { timeout: 20_000 },
            );
            await expect(
                roomFrame.getByRole('button', { name: /Mute microphone|Silenciar micrófono/i }),
            ).toBeVisible();
            await expect(
                roomFrame.getByRole('button', { name: /Turn camera off|Apagar cámara/i }),
            ).toBeVisible();
            await expect(roomFrame.getByText(/access is open elsewhere|entrada está abierta en otro lugar/i))
                .toHaveCount(0);
            await leaveConnectedRoom(roomFrame);
        });
    });
});
