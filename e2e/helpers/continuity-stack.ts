import { build } from 'esbuild';
import type { Browser, Frame, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { loginViaDashboard } from '../fixtures/auth';
import { withReconciledPublicationGrant } from '../fixtures/db';
import { SESSION_ES } from '../fixtures/test-data';
import { assertSafeFixtureDatabaseUrl } from '../fixtures/database-url';
import { mediaProbeSnapshot } from './media-probe';

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
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    try {
        return await withReconciledPublicationGrant(continuityDatabase(), SESSION_ES.id, async () => {
        await loginViaDashboard(page, 'FACILITATOR', 'Continuity signal', '/');
        const response = await page.request.get(`/api/scheduled-sessions/${SESSION_ES.id}/token`);
        expect(response.ok()).toBe(true);
        const { token, canPublish } = await response.json();
        expect(canPublish).toBe(true);
        const bundle = await build({ stdin: { contents: `export { Room, Track } from 'livekit-client';`, resolveDir: process.cwd() }, bundle: true, write: false, format: 'iife', globalName: 'ContinuitySDK', platform: 'browser' });
        await page.addScriptTag({ content: bundle.outputFiles[0].text });
        await page.evaluate(async ({ token, url, sessionId }) => {
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
            await room.localParticipant.publishTrack(destination.stream.getAudioTracks()[0], { source: sdk.Track.Source.Microphone });
            (window as unknown as { stopSignal: () => Promise<void> }).stopSignal = async () => {
                await room.disconnect(); oscillator.stop(); await audio.close();
            };
        }, { token, url: process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880', sessionId: SESSION_ES.id });
        await page.getByRole('button', { name: 'Start continuity signal', exact: true }).click();
        return async () => { try { await page.evaluate(() => (window as unknown as { stopSignal: () => Promise<void> }).stopSignal()); } finally { await context.close(); } };
        });
    } catch (error) { await context.close(); throw error; }
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

export async function rememberPlayingMedia(surface: Page | Frame) {
    await expect(surface.getByTestId('connection-state')).toHaveAttribute('data-state', 'connected', { timeout: 30_000 });
    const activate = surface.getByRole('button', { name: /Start audio|Iniciar audio/i });
    if (await activate.isVisible()) await activate.click();
    await expect.poll(() => surface.locator('audio').evaluateAll(elements => elements.some(el => el instanceof HTMLAudioElement && el.srcObject instanceof MediaStream && !el.paused && el.readyState >= 2)), { timeout: 20_000 }).toBe(true);
    await surface.evaluate(() => {
        const media = [...document.querySelectorAll<HTMLMediaElement>('audio,video')];
        (window as unknown as { continuityOriginal: unknown }).continuityOriginal = { document, media, streams: media.map(el => el.srcObject), tracks: media.flatMap(el => el.srcObject instanceof MediaStream ? el.srcObject.getTracks() : []) };
    });
}

export async function expectSamePlayingMedia(surface: Page | Frame) {
    expect(await surface.evaluate(() => {
        const original = (window as unknown as { continuityOriginal: { document: Document; media: HTMLMediaElement[]; streams: (MediaProvider | null)[]; tracks: MediaStreamTrack[] } }).continuityOriginal;
        return original?.document === document && original.media.every((el, i) => el.isConnected && el.srcObject === original.streams[i]) && original.tracks.length > 0 && original.tracks.every(track => track.readyState === 'live') && original.media.some(el => el instanceof HTMLAudioElement && !el.paused);
    })).toBe(true);
}
