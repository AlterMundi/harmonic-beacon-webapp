import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { AudioStream, Room, RoomEvent, dispose } from '@livekit/rtc-node';

const url = 'wss://live-staging.harmonicbeacon.com/rtc';
const tokens = JSON.parse(readFileSync(0, 'utf8'));
for (const [name, token] of Object.entries(tokens)) {
  assert.ok(['observer', 'source'].includes(name));
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  assert.equal(claims.video.room, 'staging-beacon');
  assert.equal(claims.video.canPublish, name === 'source');
  assert.equal(claims.video.canSubscribe, name === 'observer');
  assert.equal(claims.video.canPublishData, false);
  assert.equal(claims.video.canUpdateOwnMetadata, false);
  assert.equal(claims.sub, name === 'source' ? 'beacon01' : 'hb590-browser-pcm-observer');
}
assert.equal(Object.keys(tokens).length, 2);
const observer = new Room();
const readers = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let browser;
let bedLoudAt = 0;
let sourceLoudAt = 0;
let decodedFrames = 0;
let rejectDeadline;
const timeout = new Promise((_, reject) => { rejectDeadline = reject; });
const timer = setTimeout(() => rejectDeadline(new Error('Staging browser audio deadline exceeded')), 75000);
const passed = phase => console.log(JSON.stringify({ phase, status: 'passed', decodedFrames }));
observer.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
  if (!['playlist-bot', 'beacon01'].includes(participant.identity)) return;
  const reader = new AudioStream(track, 48000, 2).getReader();
  readers.push(reader);
  void (async () => {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      decodedFrames++;
      let energy = 0;
      for (const sample of value.data) energy += sample * sample;
      if (Math.sqrt(energy / value.data.length) > 100) {
        if (participant.identity === 'playlist-bot') bedLoudAt = Date.now();
        else sourceLoudAt = Date.now();
      }
    }
  })().catch(() => {});
});
async function run() {
  await observer.connect(url, tokens.observer, { autoSubscribe: true });
  const start = Date.now();
  while (!bedLoudAt && Date.now() - start < 12000) await sleep(100);
  assert.ok(bedLoudAt, 'No public decoded bed PCM');
  passed('public-baseline');
  browser = await chromium.launch();
  const page = await browser.newPage();
  await page.setContent('<button id="start">Start synthetic source</button>');
  await page.addScriptTag({ path: fileURLToPath(new URL('../../../node_modules/livekit-client/dist/livekit-client.umd.js', import.meta.url)) });
  await page.evaluate(async ({ url, token }) => {
    const sdk = window.LivekitClient;
    const room = new sdk.Room();
    await room.connect(url, token, { autoSubscribe: false });
    window.hbSource = { room };
    document.getElementById('start').onclick = () => {
      window.hbSource.started = (async () => {
        const audio = new AudioContext();
        window.hbSource.audio = audio;
        await audio.resume();
        const oscillator = audio.createOscillator();
        oscillator.frequency.value = 880;
        const gain = audio.createGain();
        gain.gain.value = 0.25;
        const destination = audio.createMediaStreamDestination();
        oscillator.connect(gain).connect(destination);
        oscillator.start();
        window.hbSource.publication = await room.localParticipant.publishTrack(destination.stream.getAudioTracks()[0], { source: sdk.Track.Source.Microphone });
      })();
    };
  }, { url, token: tokens.source });
  await page.getByRole('button', { name: 'Start synthetic source' }).click();
  await page.evaluate(() => window.hbSource.started);
  await sleep(6000);
  assert.ok(Date.now() - sourceLoudAt < 500, 'Browser source did not deliver decoded public PCM');
  assert.ok(Date.now() - bedLoudAt > 1000, 'Audible browser source did not fade the bed');
  passed('public-browser-source');
  await page.evaluate(() => window.hbSource.publication.track.mute());
  await sleep(3500);
  assert.ok(Date.now() - bedLoudAt < 500, 'Publisher mute did not restore public bed PCM');
  passed('publisher-mute');
  await page.evaluate(() => window.hbSource.publication.track.unmute());
  await sleep(6000);
  assert.ok(Date.now() - sourceLoudAt < 500, 'Publisher unmute did not restore public source PCM');
  assert.ok(Date.now() - bedLoudAt > 1000, 'Publisher unmute did not fade the bed');
  passed('publisher-unmute');
  await page.evaluate(() => window.hbSource.room.localParticipant.unpublishTrack(window.hbSource.publication.track));
  await sleep(3500);
  assert.ok(Date.now() - bedLoudAt < 500, 'Unpublish did not restore public bed PCM');
  passed('public-unpublish');
  await page.evaluate(async () => {
    await window.hbSource.room.disconnect();
    await window.hbSource.audio.close();
  });
  await browser.close();
  browser = undefined;
  await sleep(1000);
  assert.deepEqual([...observer.remoteParticipants.keys()].sort(), ['playlist-bot']);
  passed('source-cleanup');
}
try {
  await Promise.race([run(), timeout]);
} catch (error) {
  console.error(JSON.stringify({status: 'failed', error: String(error).replace(/eyJ[A-Za-z0-9_.-]+/g, '[token]').slice(0, 500)}));
  process.exitCode = 1;
} finally {
  await browser?.close();
  await Promise.allSettled(readers.map(reader => reader.cancel()));
  await observer.disconnect();
  await dispose();
  clearTimeout(timer);
}
