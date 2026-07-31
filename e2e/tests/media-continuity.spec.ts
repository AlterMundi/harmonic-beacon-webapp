import { expect, stackTest } from '../fixtures/stack';
import { loginViaDashboard } from '../fixtures/auth';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';
import { requireDirectDb, withSessionStatus } from '../fixtures/db';
import {
    expectMediaContinuity,
    installMediaProbe,
    mediaProbeSnapshot,
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
 * The probe is panel-agnostic: when the #70 single-mount cockpit lands its
 * panels inside this shell, opening them is added to `exerciseInRoomPanels`
 * and the same assertions prove the invariant. Today's /ops/* pages mount
 * no media at all, which the ops-surface test below pins down.
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
        await attendee.getByRole('slider', { name: /Master volume|Volumen general/i }).fill('0.7');
        await attendee.getByRole('slider', { name: /Beacon and session mix|Mezcla de Beacon y sesión/i }).fill('0.25');
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

        await attendeeContext.close();
        await facilitatorContext.close();
        });
    });

    stackTest('ops cockpit surfaces mount no media at all', async ({ page }) => {
        await installMediaProbe(page);
        await loginViaDashboard(page, 'OPERATOR', 'E2E Operator', ROUTES.opsHealth);
        await page.goto(ROUTES.opsAdmission);
        await page.goto(ROUTES.opsSession(SESSION_ES.id));
        await expect(page.getByText(SESSION_ES.title)).toBeVisible();

        const snapshot = await mediaProbeSnapshot(page);
        expect(snapshot.audioElements + snapshot.videoElements).toBe(0);
        expect(snapshot.livekitSocketsOpened).toBe(0);
        expect(snapshot.peerConnectionsCreated).toBe(0);
        expect(snapshot.audioContextsCreated).toBe(0);
    });
});
