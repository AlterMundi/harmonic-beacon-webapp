import { expect, type Browser } from '@playwright/test';
import { AccessToken } from 'livekit-server-sdk';
import { resolve } from 'node:path';
import { SESSION_ES } from './test-data';

/** Real RTP publishers with synthesized audio, not microphone/camera capture.
 * The same installed LiveKit SDK talks to the genuine local server. This is a
 * test-side publisher, never an app mock or a production endpoint.
 */
export async function startAudioPublishers(browser: Browser, options: { beaconOnly?: boolean; ignoreHTTPSErrors?: boolean } = {}) {
    const url = process.env.E2E_LIVEKIT_URL ?? 'ws://localhost:7880';
    const target = new URL(url);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
        throw new Error('audio activation publishers require an isolated loopback LiveKit server');
    }
    const credentials = {
        key: process.env.E2E_LIVEKIT_API_KEY ?? 'devkey',
        secret: process.env.E2E_LIVEKIT_API_SECRET ?? 'secret',
    };
    const sources = [
        { room: process.env.E2E_LIVEKIT_ROOM_NAME ?? 'beacon', identity: 'beacon01', frequency: 220 },
        { room: SESSION_ES.roomName, identity: 'e2e-audio-495-stage', frequency: 440 },
    ];
    const tokens = await Promise.all((options.beaconOnly ? sources.slice(0, 1) : sources).map(async (source) => {
        const token = new AccessToken(credentials.key, credentials.secret, {
            identity: source.identity, ttl: '10m',
        });
        token.addGrant({ room: source.room, roomJoin: true, canPublish: true, canSubscribe: false, canPublishData: false });
        return { ...source, token: await token.toJwt() };
    }));
    const context = await browser.newContext({ ignoreHTTPSErrors: options.ignoreHTTPSErrors ?? false });
    const page = await context.newPage();
    try {
        await page.setContent('<button id="publish">Publish fixture audio</button>');
        await page.addScriptTag({ path: resolve('node_modules/livekit-client/dist/livekit-client.umd.js') });
        await page.evaluate(({ url, tokens }) => {
            const sdk = (window as unknown as { LivekitClient: typeof import('livekit-client') }).LivekitClient;
            const rooms: import('livekit-client').Room[] = [];
            const audio = new AudioContext();
            const oscillators: OscillatorNode[] = [];
            let ready: Promise<void>;
            document.getElementById('publish')!.onclick = () => {
                ready = (async () => {
                    await audio.resume();
                    for (const source of tokens) {
                        const room = new sdk.Room();
                        rooms.push(room);
                        await room.connect(url, source.token);
                        const oscillator = audio.createOscillator();
                        oscillator.frequency.value = source.frequency;
                        const gain = audio.createGain();
                        gain.gain.value = 0.05;
                        const destination = audio.createMediaStreamDestination();
                        oscillator.connect(gain).connect(destination);
                        oscillator.start();
                        oscillators.push(oscillator);
                        await room.localParticipant.publishTrack(destination.stream.getAudioTracks()[0], {
                            source: sdk.Track.Source.Microphone, name: source.identity,
                        });
                    }
                })();
                // Keep any async failure handled until the test awaits it.
                void ready.catch(() => {});
            };
            Object.assign(window, {
                fixtureAudioReady: () => ready,
                fixtureAudioSources: () => rooms.map((room, index) => ({
                    identity: tokens[index].identity, participantSid: room.localParticipant.sid,
                    trackSid: [...room.localParticipant.audioTrackPublications.values()][0].trackSid,
                })),
                closeFixtureAudio: async () => {
                    await Promise.all(rooms.map((room) => room.disconnect()));
                    oscillators.forEach((oscillator) => oscillator.stop());
                    await audio.close();
                },
            });
        }, { url, tokens });
        await page.getByRole('button', { name: 'Publish fixture audio' }).click();
        await page.evaluate(() => (window as unknown as { fixtureAudioReady: () => Promise<void> }).fixtureAudioReady());
        expect(await page.evaluate(() => !!(window as unknown as { closeFixtureAudio?: unknown }).closeFixtureAudio)).toBe(true);
        const sources = await page.evaluate(() => (window as unknown as { fixtureAudioSources: () => { identity: string; participantSid: string; trackSid: string }[] }).fixtureAudioSources());
        return Object.assign(async () => {
            try {
                await page.evaluate(() => (window as unknown as { closeFixtureAudio: () => Promise<void> }).closeFixtureAudio());
            } finally {
                await context.close();
            }
        }, { sources });
    } catch (error) {
        await context.close();
        throw error;
    }
}
