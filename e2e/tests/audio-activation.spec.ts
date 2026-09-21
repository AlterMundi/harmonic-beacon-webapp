import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { probeStack } from '../fixtures/stack';
import { assertSafeFixtureDatabaseUrl } from '../fixtures/database-url';
import { withSessionStatus } from '../fixtures/db';
import { loginViaDashboard } from '../fixtures/auth';
import { ROUTES, SESSION_ES } from '../fixtures/test-data';
import { startAudioPublishers } from '../fixtures/audio-publishers';
import { activateAudioAtMostOnce, expectEffectiveAudioReady, expectNativeAudioAdvancing, leaveConnectedRoom, RECEIVED_AUDIO, START_AUDIO } from '../helpers/audio-readiness';
import { expectMediaContinuity, installMediaProbe, mediaProbeSnapshot } from '../helpers/media-probe';
import { denyDeviceCapture, deniedCaptureSnapshot, expectDeniedThumbnailCapture } from '../helpers/denied-capture';
import { signalingResume } from '../helpers/signaling-resume';
import { retainSignalingSockets } from '../helpers/signaling-loss';
import { denyNativePlayback } from '../helpers/native-playback-denial';

// This dedicated gate fails closed locally AND in CI (the parent integration
// separately fixes stackTest's automatic CI gate). Real DB,
// entitlement/token routes, signaling, WebRTC and browser playback are required.
const test = base.extend<{ liveAudio: void }>({
    liveAudio: [async ({ request, browser }, runFixture) => {
        const db = process.env.E2E_DATABASE_URL;
        assertSafeFixtureDatabaseUrl(db ?? '');
        expect(await probeStack(request), 'required fixture database/app not ready').toBe('ok');
        const livekit = process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880';
        const response = await fetch(livekit.replace(/^ws/, 'http'), { signal: AbortSignal.timeout(3000) });
        expect(response.ok, 'required isolated LiveKit server not ready').toBe(true);
        await withSessionStatus(db!, SESSION_ES.id, 'LIVE', async () => {
            const closePublishers = await startAudioPublishers(browser);
            try { await runFixture(); } finally { await closePublishers(); }
        });
    }, { auto: true }],
});

async function join(page: Page): Promise<void> {
    await installMediaProbe(page);
    // Deny all acquisition, not the product's intentional default-on thumbnail
    // policy. Exact constraints + before/after snapshots disallow microphone
    // requests and any new capture triggered by audio activation.
    await page.addInitScript(denyDeviceCapture);
    await loginViaDashboard(page, 'ATTENDEE', 'E2E Audio Listener', ROUTES.session(SESSION_ES.id));
    await expect(page.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected', { timeout: 20_000 });
}

async function ready(page: Page, thumbnailAttempts = 1): Promise<void> {
    await expect(page.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected', { timeout: 20_000 });
    const captureBefore = await expectDeniedThumbnailCapture(page, thumbnailAttempts);
    await expect(page.locator(RECEIVED_AUDIO)).toHaveCount(2, { timeout: 20_000 });
    const automaticallyPlaying = await page.locator(RECEIVED_AUDIO).evaluateAll(elements =>
        elements.every(element => element instanceof HTMLAudioElement &&
            !element.paused && !element.ended && !element.error),
    );
    // Conditional real-browser proof, not a forced autoplay policy: if native
    // playback is already allowed, demand advancing sources and a hidden CTA
    // BEFORE the activation helper can click anything or inspect new attributes.
    if (automaticallyPlaying) {
        await expectNativeAudioAdvancing(page, 2);
        await expect(page.getByRole('button', { name: START_AUDIO })).toHaveCount(0);
    }
    const clicks = await activateAudioAtMostOnce(page);
    if (automaticallyPlaying) expect(clicks).toBe(0);
    test.info().annotations.push({
        type: 'native-autoplay',
        description: automaticallyPlaying
            ? 'Advancing native playback observed before activation; CTA hid with zero clicks.'
            : `Automatic playback not established on entry; readiness verified after ${clicks} activation(s).`,
    });
    await expectNativeAudioAdvancing(page, 2);
    expect(await expectDeniedThumbnailCapture(page, thumbnailAttempts)).toEqual(captureBefore);
}

async function receipt(page: Page, testInfo: TestInfo, name: string) {
    const snapshot = await mediaProbeSnapshot(page);
    // Signaling URLs contain ephemeral tokens. Never attach them to evidence.
    const safe = { ...snapshot, livekitSocketUrls: [], signaling: snapshot.livekitSocketUrls.map(signalingResume), capture: await deniedCaptureSnapshot(page) };
    await testInfo.attach(name, { body: JSON.stringify(safe, null, 2), contentType: 'application/json' });
    return snapshot;
}

test.describe('live continuity without capture', () => {
    test.afterEach(async ({ page }, testInfo) => {
        if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
            const diagnostic = await page.evaluate(() => ({
                path: location.pathname,
                connection: document.querySelector('[data-testid="connection-state"]')?.getAttribute('data-state'),
                play: HTMLMediaElement.prototype.play.toString(),
                autoplaySetter: Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'autoplay')?.set?.toString(),
                native: [...document.querySelectorAll('audio')].map(audio => ({
                    id: audio.id, paused: audio.paused, autoplay: audio.autoplay, ended: audio.ended,
                    error: audio.error?.code, currentTime: audio.currentTime,
                    tracks: (audio.srcObject as MediaStream | null)?.getAudioTracks().map(track => ({ id: track.id, state: track.readyState })),
                })),
                capture: window.fixtureDeniedCapture?.(),
                devicesRetained: window.fixtureDeniedCaptureDevices === navigator.mediaDevices,
            }));
            await testInfo.attach('failed-document-native-state', { body: JSON.stringify(diagnostic), contentType: 'application/json' });
        }
        await leaveConnectedRoom(page);
    });

    test('entry and refresh reach both rooms native playback with zero or one activation', async ({ page }, testInfo) => {
        await join(page);
        await ready(page);
        const before = await receipt(page, testInfo, 'entry-ready');
        const captureBefore = await expectDeniedThumbnailCapture(page, 1);
        // Zero gain is intentional silence, never a reason to demand activation.
        const volume = page.getByRole('slider', { name: /Overall room volume|Volumen general de la sala/i });
        await volume.press('Home');
        await expect(volume).toHaveValue('0');
        await page.getByRole('slider', { name: /Beacon \/ Session balance|Balance Beacon \/ Sesión/i }).press('ArrowLeft');
        await expectEffectiveAudioReady(page);
        await expectNativeAudioAdvancing(page, 2);
        expectMediaContinuity(before, await receipt(page, testInfo, 'controls-ready'));
        expect(await expectDeniedThumbnailCapture(page, 1)).toEqual(captureBefore);
        await page.reload();
        await ready(page);
        await receipt(page, testInfo, 'refresh-ready');
    });

    test('unused suspended SDK contexts do not gate advancing native output', async ({ page }, testInfo) => {
        await page.addInitScript(() => {
            const NativeAudioContext = window.AudioContext;
            const contexts: AudioContext[] = [];
            // Control only platform resume policy; native media play, app rooms,
            // SDK and remote RTP remain real. This is NOT an output-graph fault
            // with the app's default webAudioMix:false routing.
            NativeAudioContext.prototype.resume = function () {
                return new Promise<void>(() => {});
            };
            class PolicyAudioContext extends NativeAudioContext {
                constructor(options?: AudioContextOptions) {
                    super(options);
                    contexts.push(this);
                    void this.suspend();
                }
            }
            window.AudioContext = PolicyAudioContext;
            Object.assign(window, {
                fixtureAuxiliaryContextStates: () => contexts.map(context => context.state),
            });
        });
        await join(page);
        // Native clocks and absence of unnecessary activation are the output
        // contract. Neither UI readiness nor SDK success proves context state.
        await ready(page);
        const states = await page.evaluate(() => (
            window as unknown as { fixtureAuxiliaryContextStates: () => string[] }
        ).fixtureAuxiliaryContextStates());
        expect(states.length).toBeGreaterThanOrEqual(2);
        expect(states.every(state => state === 'suspended')).toBe(true);
        await testInfo.attach('unused-auxiliary-context-states', {
            body: JSON.stringify(states), contentType: 'application/json',
        });
        await receipt(page, testInfo, 'native-ready-with-unused-suspended-contexts');
    });

    test('failed native playback offers a real retry, never a stale successful-click receipt', async ({ page }, testInfo) => {
        await page.addInitScript(denyNativePlayback);
        await join(page);
        await expect(page.locator(RECEIVED_AUDIO)).toHaveCount(2, { timeout: 20_000 });
        const captureBefore = await expectDeniedThumbnailCapture(page, 1);
        // Fault precondition must be actual native state, not a rejected JS
        // promise or a product readiness attribute. Autoplay bypasses play().
        await expect.poll(() => page.locator(RECEIVED_AUDIO).evaluateAll(elements =>
            elements.length === 2 && elements.every(element => element instanceof HTMLAudioElement &&
                element.paused && !element.autoplay && !element.ended && !element.error),
            ), { message: 'native denial must really block both autoplay outputs' }).toBe(true);
        const nativeOutput = () => page.locator(RECEIVED_AUDIO).evaluateAll(elements => elements.map(element => {
            const audio = element as HTMLAudioElement;
            return { paused: audio.paused, autoplay: audio.autoplay, currentTime: audio.currentTime,
                tracks: (audio.srcObject as MediaStream).getAudioTracks().map(track => ({ id: track.id, state: track.readyState })) };
        }));
        const blocked = await nativeOutput();
        const trackIds = blocked.flatMap(output => output.tracks.map(track => track.id)).sort();
        expect(trackIds).toHaveLength(2);
        expect(new Set(trackIds).size).toBe(2);
        expect(blocked.every(output => output.tracks.every(track => track.state === 'live'))).toBe(true);
        await testInfo.attach('native-output-blocked', { body: JSON.stringify(blocked), contentType: 'application/json' });
        await page.getByRole('button', { name: START_AUDIO }).click();
        const activation = page.getByRole('group', { name: /Audio activation|Activación de audio/i });
        await expect(activation.getByRole('alert')).toBeVisible();
        await expect(page.getByRole('button', { name: START_AUDIO })).toBeEnabled();
        expect(await expectDeniedThumbnailCapture(page, 1)).toEqual(captureBefore);
        const failed = await receipt(page, testInfo, 'native-failure');
        const rejected = await nativeOutput();
        expect(rejected).toEqual(blocked);
        await page.evaluate(() => window.allowFixturePlayback());
        // Merely releasing fixture policy must not fabricate native success.
        expect(await nativeOutput()).toEqual(blocked);
        await page.getByRole('button', { name: START_AUDIO }).click();
        await expectNativeAudioAdvancing(page, 2);
        await expectEffectiveAudioReady(page);
        const playing = await nativeOutput();
        expect(playing.flatMap(output => output.tracks.map(track => track.id)).sort()).toEqual(trackIds);
        await testInfo.attach('native-output-retry-playing', { body: JSON.stringify(playing), contentType: 'application/json' });
        expect(await expectDeniedThumbnailCapture(page, 1)).toEqual(captureBefore);
        const recovered = await receipt(page, testInfo, 'native-retry-ready');
        expect(recovered.livekitSocketsClosed).toBe(failed.livekitSocketsClosed);
        expect(recovered.peerConnectionsClosed).toBe(failed.peerConnectionsClosed);
        expect(recovered.audioElements).toBe(failed.audioElements);
        expect(recovered.duplicateMediaSources).toEqual([]);
    });

    test('failed initial Beacon token connection reconnects on retry without replacing the stage', async ({ page }, testInfo) => {
        await page.route('**/api/livekit/token?**', (route) => route.fulfill({
            status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'E2E transient outage' }),
        }));
        await join(page);
        await expect(page.getByRole('group', { name: /Audio activation|Activación de audio/i }).getByRole('alert')).toBeVisible();
        const captureBefore = await expectDeniedThumbnailCapture(page, 1);
        const failed = await receipt(page, testInfo, 'beacon-connection-failure');
        await page.unroute('**/api/livekit/token?**');
        // Beacon's second native source cannot arrive until the connection retry.
        // Assert the functional regression BEFORE new diagnostic attributes:
        // baseline startAudio never refetches the failed token, so its second
        // real native track never arrives. A missing attribute is not our RED.
        await page.getByRole('button', { name: START_AUDIO }).click();
        await expectNativeAudioAdvancing(page, 2);
        await expectEffectiveAudioReady(page);
        expect(await expectDeniedThumbnailCapture(page, 1)).toEqual(captureBefore);
        const recovered = await receipt(page, testInfo, 'beacon-connection-retry-ready');
        expect(recovered.livekitSocketsClosed).toBe(failed.livekitSocketsClosed);
        expect(recovered.peerConnectionsClosed).toBe(failed.peerConnectionsClosed);
        expect(recovered.duplicateMediaSources).toEqual([]);
    });

    test('transport recovery resamples both rooms without duplicate native sources', async ({ page }, testInfo) => {
        test.slow();
        await page.addInitScript(
            retainSignalingSockets,
            process.env.E2E_LIVEKIT_PUBLIC_URL ?? process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880',
        );
        await join(page);
        await ready(page);
        const before = await receipt(page, testInfo, 'before-transport-loss');
        const captureBefore = await expectDeniedThumbnailCapture(page, 1);
        const fault = await page.evaluate(() => window.fixtureSeverSignaling());
        expect(fault).toEqual({ closed: 2, codes: [4000, 4000] });
        await testInfo.attach('native-signaling-loss', { body: JSON.stringify(fault), contentType: 'application/json' });
        await expect(page.getByTestId('connection-state')).toHaveAttribute(
            'data-state', /^(reconnecting|signalReconnecting)$/, { timeout: 30_000 },
        );
        // Deliberately qualify SDK resume, NOT an app disconnected/connected
        // lifecycle. Legacy /rtc uses reconnect=1 + sid; SDK 2.17 /rtc/v1
        // carries equivalent reconnect=true + participantSid in join_request;
        // require both participants and reject any new initial-join socket.
        // The media probe's bounded URL history must also be complete here.
        await expect.poll(async () => {
            const current = await mediaProbeSnapshot(page);
            const resumed = current.livekitSocketUrls.slice(before.livekitSocketUrls.length)
                .map(signalingResume);
            return before.livekitSocketUrls.length === before.livekitSocketsOpened &&
                current.livekitSocketUrls.length === current.livekitSocketsOpened &&
                before.livekitSocketUrls.every((url, index) => current.livekitSocketUrls[index] === url) &&
                resumed.every(signal => signal?.reconnect === true && Boolean(signal.sid)) &&
                new Set(resumed.map(signal => signal?.sid)).size === 2;
        }, { timeout: 30_000, message: 'both rooms must use SDK resume signaling, not a fresh join' }).toBe(true);
        // SDK Reconnecting/Resumed keeps ThumbnailSender's connected prop true:
        // exactly the original denied capture, with none added by activation.
        await ready(page, 1);
        expect(await expectDeniedThumbnailCapture(page, 1)).toEqual(captureBefore);
        const recovered = await receipt(page, testInfo, 'after-transport-recovery');
        expect(recovered.peerConnectionsCreated).toBe(before.peerConnectionsCreated);
        expect(recovered.peerConnectionsClosed).toBe(before.peerConnectionsClosed);
        expect(recovered.duplicateMediaSources).toEqual([]);
        await expect(page.getByText(/access is open elsewhere|entrada está abierta en otro lugar/i)).toHaveCount(0);
    });
});
