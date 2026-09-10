import { build } from 'esbuild';
import type { Browser, Frame, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { loginViaDashboard } from '../fixtures/auth';
import { withReconciledPublicationGrant } from '../fixtures/db';
import { SESSION_ES } from '../fixtures/test-data';
import { assertSafeFixtureDatabaseUrl } from '../fixtures/database-url';
import { mediaProbeSnapshot, expectMediaContinuity } from './media-probe';
import { startAudioPublishers } from '../fixtures/audio-publishers';
import { RECEIVED_AUDIO, activateAudioAtMostOnce, expectEffectiveAudioReady, expectNativeAudioAdvancing } from './audio-readiness';
import { accountFixtureEnabled, loginViaAccountFixture } from '../account-fixture/browser';

export async function loginForContinuity(page: Page, role: 'ATTENDEE' | 'OPERATOR' | 'FACILITATOR' | 'ADMIN', name: string, landing: string) {
    await installContinuitySourceProbe(page);
    if (accountFixtureEnabled()) return loginViaAccountFixture(page, role, name, landing);
    return loginViaDashboard(page, role, name, landing);
}

/** Fail closed: these are acceptance tests, not optional degraded-stack smoke. */
export function continuityDatabase(): string {
    const url = process.env.E2E_DATABASE_URL;
    if (!url) throw new Error('Full-stack continuity requires E2E_DATABASE_URL (local beacon_test fixture)');
    assertSafeFixtureDatabaseUrl(url);
    return url;
}

/** Real LiveKit publisher with synthesized audio, not device capture. The receiver
 * is the unmodified production SessionRoom/AudioProvider, including in Staff.
 * No getUserMedia shim, token mock, fake Room or production credential is used. */
export async function syntheticPublisher(browser: Browser, baseURL: string) {
    continuityDatabase(); // Validate isolation before either publisher connects.
    const context = await browser.newContext({ baseURL, ignoreHTTPSErrors: accountFixtureEnabled() });
    const page = await context.newPage();
    let stopBeacon: Awaited<ReturnType<typeof startAudioPublishers>> | undefined;
    try {
        stopBeacon = await startAudioPublishers(browser, { beaconOnly: true, ignoreHTTPSErrors: accountFixtureEnabled() });
        return await withReconciledPublicationGrant(continuityDatabase(), SESSION_ES.id, async () => {
        await loginForContinuity(page, 'FACILITATOR', 'Continuity signal', '/');
        const response = await page.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/token`);
        expect(response.ok()).toBe(true);
        const { token, canPublish } = await response.json();
        expect(canPublish).toBe(true);
        const bundle = await build({ stdin: { contents: `export { Room, Track } from 'livekit-client';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'ContinuitySDK', platform: 'browser' });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        const stage = await page.evaluate(async ({ token, url, sessionId }) => {
            const sdk = (window as unknown as { ContinuitySDK: typeof import('livekit-client') }).ContinuitySDK;
            const room = new sdk.Room();
            await room.connect(url, token);
            // The real join token is subscribe-only. Project the authorized
            // grant after connecting, exactly as the production room does.
            const activation = await fetch(`/api/scheduled-sessions/${sessionId}/publication`, { method: 'POST' });
            if (!activation.ok) throw new Error(`Publisher activation failed: ${activation.status}`);
            const deadline = Date.now() + 15_000;
            while (!room.localParticipant.permissions?.canPublish) {
                if (Date.now() > deadline) throw new Error('Publisher permissions never activated');
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            const audio = new AudioContext();
            const oscillator = audio.createOscillator();
            const destination = audio.createMediaStreamDestination();
            oscillator.connect(destination); oscillator.start();
            // A synthesized signal still needs a genuine autoplay gesture in
            // Firefox/WebKit. No microphone/camera API is invoked.
            const start = document.createElement('button');
            start.textContent = 'Start continuity signal';
            start.onclick = () => { void audio.resume(); };
            document.body.append(start);
            const publication = await room.localParticipant.publishTrack(destination.stream.getAudioTracks()[0], { source: sdk.Track.Source.Microphone, name: 'continuity-stage' });
            (window as unknown as { stopSignal: () => Promise<void> }).stopSignal = async () => {
                await room.disconnect(); oscillator.stop(); await audio.close();
            };
            return { identity: room.localParticipant.identity, participantSid: room.localParticipant.sid, trackSid: publication.trackSid };
        }, { token, url: process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880', sessionId: SESSION_ES.id });
        await page.getByRole('button', { name: 'Start continuity signal', exact: true }).click();
        const sources: ContinuitySource[] = [{ ...stage, role: 'stage' }, { ...stopBeacon!.sources[0], role: 'beacon' }];
        return Object.assign(async () => {
            try { await page.evaluate(() => (window as unknown as { stopSignal: () => Promise<void> }).stopSignal()); }
            finally { try { await context.close(); } finally { await stopBeacon!(); } }
        }, { sources });
        });
    } catch (error) { try { await context.close(); } finally { await stopBeacon?.(); } throw error; }
}

/** Drive the control that production actually renders, not the standalone
 * LanguageControl used by component previews. Embedded Staff intentionally
 * hides global navigation; its locale follows the parent's storage event. */
export async function setLiveLocale(surface: Page | Frame, locale: 'en' | 'es') {
    if (await surface.locator('html').getAttribute('lang') !== locale) {
        await surface.getByRole('button', { name: 'Language / Idioma', exact: true }).click();
    }
    await expect(surface.locator('html')).toHaveAttribute('lang', locale);
}

export async function settledContinuity(surface: Frame | Page) {
    let previous = await mediaProbeSnapshot(surface);
    let stable = 0;
    for (let i = 0; i < 40; i++) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const next = await mediaProbeSnapshot(surface);
        stable = JSON.stringify(next) === JSON.stringify(previous) ? stable + 1 : 0;
        previous = next;
        if (stable >= 5) return next;
    }
    throw new Error('Media never settled');
}

export interface ContinuitySource {
    role: 'stage' | 'beacon';
    identity: string;
    participantSid: string;
    trackSid: string;
}

type ContinuityObservation = {
    participantSid: string;
    nativeTrackId: string;
    nativeTrackSid: string;
    publicationSid: string;
    associationAttempted: boolean;
    valid: boolean;
};

declare global {
    interface Window {
        continuityReceived?: WeakMap<MediaStreamTrack, ContinuityObservation>;
        continuityTrackSubscribed?: (track: MediaStreamTrack, participantSid: string, trackSid: string) => void;
        continuityOriginal?: {
            document: Document; media: HTMLMediaElement[]; streams: (MediaProvider | null)[];
            tracks: MediaStreamTrack[][]; sources: ContinuitySource[];
        };
    }
}

/** Observe genuine RTC track events without changing SDP, streams, or playback.
 * LiveKit packs participant SID in stream.id; Firefox packs publication SID too.
 * Chrome uses the publication SID as track.id. Unidentifiable sources fail closed.
 */
export async function installContinuitySourceProbe(page: Page) {
    await page.addInitScript(() => {
        if (window.continuityReceived) return;
        const received = window.continuityReceived = new WeakMap();
        window.continuityTrackSubscribed = (track, participantSid, trackSid) => {
            const observed = received.get(track);
            // The application may associate only a native track that the probe
            // already observed. Preserve native evidence and fail closed when
            // LiveKit's public subscription identity conflicts with it.
            if (!observed) return;
            if (!participantSid || !trackSid.startsWith('TR') ||
                !observed.participantSid || observed.participantSid !== participantSid ||
                (observed.nativeTrackSid && observed.nativeTrackSid !== trackSid) ||
                (observed.associationAttempted && observed.publicationSid !== trackSid)) {
                received.set(track, { ...observed, associationAttempted: true, valid: false });
                return;
            }
            received.set(track, { ...observed, publicationSid: trackSid, associationAttempted: true, valid: true });
        };
        const Native = window.RTCPeerConnection;
        window.RTCPeerConnection = new Proxy(Native, {
            construct(target, args) {
                const pc = new target(...args as ConstructorParameters<typeof RTCPeerConnection>);
                pc.addEventListener('track', event => {
                    const [participantSid, streamId] = (event.streams[0]?.id ?? '').split('|');
                    const nativeTrackSid = streamId?.startsWith('TR') ? streamId :
                        (event.track.id.startsWith('TR') ? event.track.id : '');
                    received.set(event.track, {
                        participantSid,
                        nativeTrackId: event.track.id,
                        nativeTrackSid,
                        publicationSid: nativeTrackSid,
                        associationAttempted: false,
                        valid: !!participantSid && !!nativeTrackSid,
                    });
                });
                return pc;
            },
        });
    });
}

async function expectIdentifiedSources(surface: Page | Frame, sources: ContinuitySource[]) {
    expect(sources.map(source => source.role).sort()).toEqual(['beacon', 'stage']);
    expect(new Set(sources.map(source => source.participantSid)).size).toBe(2);
    expect(new Set(sources.map(source => source.trackSid)).size).toBe(2);
    expect(sources.every(source => source.identity && source.participantSid && source.trackSid)).toBe(true);
    expect(await surface.locator(RECEIVED_AUDIO).evaluateAll((elements, expected) => {
        const tracks = elements.flatMap(el => el instanceof HTMLAudioElement && el.srcObject instanceof MediaStream ? el.srcObject.getAudioTracks() : []);
        return elements.length === 2 && tracks.length === 2 && new Set(tracks).size === 2 &&
            expected.every(source => tracks.filter(track => {
                const received = window.continuityReceived?.get(track);
                return track.readyState === 'live' && received?.valid === true &&
                    received.nativeTrackId === track.id && received.participantSid === source.participantSid &&
                    received.publicationSid === source.trackSid;
            }).length === 1);
    }, sources), 'exact stage and Beacon RTC publications must be attached').toBe(true);
}

const probeBaselines = new WeakMap<Page | Frame, Awaited<ReturnType<typeof mediaProbeSnapshot>>>();

export async function rememberPlayingMedia(surface: Page | Frame, sources: ContinuitySource[] = []) {
    await activateAudioAtMostOnce(surface);
    await expectNativeAudioAdvancing(surface, 2);
    await expectIdentifiedSources(surface, sources);
    await surface.evaluate(({ selector, sources }) => {
        const media = [...document.querySelectorAll<HTMLMediaElement>(`${selector},video`)];
        window.continuityOriginal = { document, media, streams: media.map(el => el.srcObject),
            tracks: media.map(el => el.srcObject instanceof MediaStream ? el.srcObject.getTracks() : []), sources };
    }, { selector: RECEIVED_AUDIO, sources });
    // Some terminal-removal callers intentionally do not install the capture probe.
    if (await surface.evaluate(() => !!window.__hbMediaProbe)) probeBaselines.set(surface, await settledContinuity(surface));
}

export async function expectSamePlayingMedia(surface: Page | Frame) {
    const same = () => surface.evaluate(selector => {
        const original = window.continuityOriginal;
        const media = [...document.querySelectorAll<HTMLMediaElement>(`${selector},video`)];
        return original?.document === document && media.length === original.media.length &&
            media.every((el, i) => {
                const tracks = el.srcObject instanceof MediaStream ? el.srcObject.getTracks() : [];
                return el === original.media[i] && el.isConnected && el.srcObject === original.streams[i] &&
                    tracks.length === original.tracks[i].length && tracks.every((track, j) => track === original.tracks[i][j] && track.readyState === 'live');
            });
    }, RECEIVED_AUDIO);
    expect(await same(), 'original document, elements, streams and tracks retained').toBe(true);
    const sources = await surface.evaluate(() => window.continuityOriginal!.sources);
    await expectEffectiveAudioReady(surface);
    await expectIdentifiedSources(surface, sources);
    await expectNativeAudioAdvancing(surface, 2);
    expect(await same(), 'identity retained throughout clock sample').toBe(true);
    const baseline = probeBaselines.get(surface);
    if (baseline) {
        const after = await settledContinuity(surface);
        expectMediaContinuity(baseline, after);
        expect(after.livekitSocketsOpened, 'no extra signaling connection').toBe(baseline.livekitSocketsOpened);
        expect(after.peerConnectionsCreated, 'no extra RTC connection').toBe(baseline.peerConnectionsCreated);
    }
}
