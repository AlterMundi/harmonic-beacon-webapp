import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium, firefox, expect } from '@playwright/test';
import { navigationBrowser } from '../fixtures/navigation-browser';
import { installContinuitySourceProbe, rememberPlayingMedia, expectSamePlayingMedia } from './continuity-stack';

// Real local RTP transport; source-only oscillators never connect to speakers.
// UI readiness flags are boundary inputs, not a claim of an Account/LiveKit run.
for (const engine of [chromium]) {
    test(`${engine.name()} two identified native RTC sources: positive and missing/paused/stalled/duplicate/replacement controls`, async () => {
        const fixture = await navigationBrowser();
        const browser = await engine.launch().catch(async error => { await fixture.close(); throw error; });
        try {
            const page = await browser.newPage();
            await installContinuitySourceProbe(page);
            await page.goto(fixture.origin + '/away');
            const sources = await page.evaluate(async () => {
                document.body.innerHTML = '<div data-testid="connection-state" data-state="connected" data-beacon-audio="ready" data-stage-audio="ready"></div><button>Start</button>';
                const graph = new AudioContext();
                const sources = [];
                for (const role of ['stage', 'beacon'] as const) {
                    const oscillator = graph.createOscillator();
                    const destination = graph.createMediaStreamDestination();
                    oscillator.connect(destination); oscillator.start();
                    const sender = new RTCPeerConnection(); const receiver = new RTCPeerConnection();
                    sender.onicecandidate = event => { if (event.candidate) void receiver.addIceCandidate(event.candidate); };
                    receiver.onicecandidate = event => { if (event.candidate) void sender.addIceCandidate(event.candidate); };
                    const incoming = new Promise<RTCTrackEvent>(resolve => receiver.ontrack = resolve);
                    sender.addTrack(destination.stream.getAudioTracks()[0], destination.stream);
                    await sender.setLocalDescription(await sender.createOffer());
                    await receiver.setRemoteDescription(sender.localDescription!);
                    await receiver.setLocalDescription(await receiver.createAnswer());
                    await sender.setRemoteDescription(receiver.localDescription!);
                    const event = await incoming;
                    if (event.track.id.startsWith('TR')) throw new Error('control requires a browser-native track UUID');
                    const publicationSid = `TR_${role}_publication`;
                    window.continuityTrackSubscribed?.(event.track, event.streams[0].id, publicationSid);
                    const audio = document.createElement('audio'); audio.id = role;
                    audio.srcObject = new MediaStream([event.track]); document.body.append(audio);
                    sources.push({ role, identity: role, participantSid: event.streams[0].id, trackSid: publicationSid });
                }
                document.querySelector('button')!.onclick = async () => { await graph.resume(); await Promise.all([...document.querySelectorAll('audio')].map(audio => audio.play())); };
                return sources;
            });
            assert.equal(await page.evaluate(async () => {
                const graph = new AudioContext();
                const destination = graph.createMediaStreamDestination();
                const track = destination.stream.getAudioTracks()[0];
                window.continuityTrackSubscribed?.(track, 'PA_unobserved', 'TR_unobserved');
                const accepted = window.continuityReceived?.has(track) === true;
                track.stop();
                await graph.close();
                return accepted;
            }), false, 'subscription association cannot create native RTC evidence');
            await page.getByRole('button', { name: 'Start', exact: true }).click();
            await rememberPlayingMedia(page, sources);
            await expectSamePlayingMedia(page);
            await assert.rejects(rememberPlayingMedia(page, sources.map(source => source.role === 'beacon' ? { ...source, participantSid: 'not-the-Beacon-publisher' } : source)), /exact stage and Beacon/);
            await assert.rejects(rememberPlayingMedia(page, sources.map(source => source.role === 'beacon' ? { ...source, trackSid: 'TR_wrong-publication' } : source)), /exact stage and Beacon/);
            await page.evaluate(() => { const dummy = document.createElement('audio'); dummy.id = 'livekit-dummy-audio-el'; document.body.append(dummy); });
            await expectSamePlayingMedia(page);
            await page.evaluate(() => { const extra = document.createElement('audio'); extra.id = 'arbitrary-extra'; document.body.append(extra); });
            await assert.rejects(expectSamePlayingMedia(page), /identity|retained/);
            await page.locator('#arbitrary-extra').evaluate(audio => audio.remove());
            await page.locator('#livekit-dummy-audio-el').evaluate(audio => audio.remove());
            await expectSamePlayingMedia(page);
            console.log('identified publication mismatch and arbitrary extra rejected; only SDK dummy excluded');
            await page.locator('audio').evaluateAll(elements => elements.forEach(element => { const audio = element as HTMLAudioElement; audio.muted = true; audio.volume = 0; }));
            await expectSamePlayingMedia(page); // Intentional mute is not blocked playback.
            console.log('positive: both native RTC clocks; mute/zero gain preserve readiness');
            for (const role of ['stage', 'beacon']) {
                await page.evaluate(role => document.getElementById(role)!.remove(), role);
                await assert.rejects(rememberPlayingMedia(page, sources), /count|Count|locator/);
                await assert.rejects(expectSamePlayingMedia(page), /identity|retained/);
                console.log(`rejected missing ${role} before and after retention`);
                await page.evaluate(() => { for (const audio of window.continuityOriginal!.media) document.body.append(audio); });
                await page.getByRole('button', { name: 'Start', exact: true }).click();
                await expectSamePlayingMedia(page);
            }
            await page.locator('#beacon').evaluate((audio: HTMLAudioElement) => audio.pause());
            await assert.rejects(rememberPlayingMedia(page, sources), /blocked|paused|Expected|expect/);
            await assert.rejects(expectSamePlayingMedia(page));
            console.log('rejected paused Beacon before and after retention');
            await page.getByRole('button', { name: 'Start', exact: true }).click();
            // Deterministic clock-stall fault at the native element boundary.
            await page.locator('#beacon').evaluate((audio: HTMLAudioElement) => Object.defineProperty(audio, 'currentTime', { configurable: true, value: audio.currentTime }));
            await assert.rejects(rememberPlayingMedia(page, sources), /advance/);
            await assert.rejects(expectSamePlayingMedia(page), /advance/);
            console.log('rejected stalled Beacon before and after retention');
            await page.locator('#beacon').evaluate(audio => Reflect.deleteProperty(audio, 'currentTime'));
            await expectSamePlayingMedia(page);
            await page.locator('#beacon').evaluate((audio: HTMLAudioElement) => { audio.srcObject = document.querySelector<HTMLAudioElement>('#stage')!.srcObject; });
            await page.getByRole('button', { name: 'Start', exact: true }).click();
            await assert.rejects(rememberPlayingMedia(page, sources));
            console.log('rejected duplicate source');
            await assert.rejects(expectSamePlayingMedia(page), /identity|retained/);
            await page.evaluate(() => window.continuityOriginal!.media.forEach((audio, i) => { audio.srcObject = window.continuityOriginal!.streams[i]; }));
            await page.getByRole('button', { name: 'Start', exact: true }).click();
            await expectSamePlayingMedia(page);
            await page.locator('#beacon').evaluate((audio: HTMLAudioElement) => { const stream = audio.srcObject as MediaStream; const track = stream.getAudioTracks()[0]; stream.removeTrack(track); stream.addTrack(track.clone()); });
            await assert.rejects(expectSamePlayingMedia(page), /identity|retained/);
            console.log('rejected replacement track in original stream');
            await page.evaluate(() => window.continuityOriginal!.media.forEach((audio, i) => { const stream = audio.srcObject as MediaStream; stream.getTracks().forEach(track => stream.removeTrack(track)); window.continuityOriginal!.tracks[i].forEach(track => stream.addTrack(track)); }));
            await page.locator('#beacon').evaluate((audio: HTMLAudioElement) => { audio.srcObject = new MediaStream((audio.srcObject as MediaStream).getTracks()); });
            await page.getByRole('button', { name: 'Start', exact: true }).click();
            await assert.rejects(expectSamePlayingMedia(page), /identity|retained/);
            console.log('rejected replacement stream even with the original live track');
            await page.evaluate(() => {
                const beacon = document.querySelector<HTMLAudioElement>('#beacon')!;
                beacon.srcObject = window.continuityOriginal!.streams[1];
            });
            await page.getByRole('button', { name: 'Start', exact: true }).click();
            await expectSamePlayingMedia(page);
            const beacon = sources.find(source => source.role === 'beacon')!;
            await page.evaluate(({ participantSid }) => {
                const track = (document.querySelector<HTMLAudioElement>('#beacon')!.srcObject as MediaStream).getAudioTracks()[0];
                window.continuityTrackSubscribed?.(track, participantSid, 'TR_conflicting-publication');
            }, beacon);
            await assert.rejects(expectSamePlayingMedia(page), /exact stage and Beacon/);
            console.log('unobserved association and conflicting publication rejected');
        } finally { await browser.close(); await fixture.close(); }
    });
}

test('Firefox automation reload is a causal negative; scheduled native reload retains the actual Staff drawer', async () => {
    const fixture = await navigationBrowser();
    const browser = await firefox.launch().catch(async error => { await fixture.close(); throw error; });
    try {
        const page = await browser.newPage();
        await page.goto(fixture.origin + '/ops/events/event-1');
        const room = page.frameLocator('[data-testid="persistent-room"]');
        await room.getByLabel('Room draft').fill('retained');
        await room.getByRole('button', { name: 'Exit room', exact: true }).click();
        await page.getByRole('button', { name: 'Stay in the room', exact: true }).click();
        await page.getByRole('button', { name: 'Hands', exact: false }).click();
        assert.equal(await page.evaluate(() => navigator.userActivation.hasBeenActive), true);
        const warnings: string[] = [];
        page.on('dialog', async dialog => { warnings.push(dialog.type()); await dialog.dismiss(); });
        await page.reload();
        assert.deepEqual(warnings, []);
        await expect(room.getByLabel('Room draft')).toHaveValue('draft');
        await room.getByLabel('Room draft').fill('native retained');
        await room.getByRole('button', { name: 'Exit room', exact: true }).click();
        await page.getByRole('button', { name: 'Stay in the room', exact: true }).click();
        await page.getByRole('button', { name: 'Hands', exact: false }).click();
        const drawer = page.getByRole('dialog');
        await expect(drawer).toBeVisible();
        await page.evaluate(() => { Object.assign(window, { retainedDocument: document }); setTimeout(() => location.reload(), 0); });
        await expect.poll(() => warnings.length).toBe(1);
        assert.deepEqual(warnings, ['beforeunload']);
        await expect(drawer).toBeVisible();
        await expect(room.getByLabel('Room draft')).toHaveValue('native retained');
        assert.equal(await page.evaluate(() => (window as unknown as { retainedDocument: Document }).retainedDocument === document), true);
    } finally { await browser.close(); await fixture.close(); }
});
