import assert from 'node:assert/strict';
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackPublishOptions, TrackSource, dispose } from '@livekit/rtc-node';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

// Run by piping this file into node in the installed staging bot container.
// This mutates only the synthetic room, never starts a replacement bot and
// never grants a participant access to a production room or database.
assert.equal(process.env.STAGING_MEDIA_PROBE, '1', 'Explicit staging probe guard required');
assert.equal(process.env.LIVEKIT_ROOM_NAME, 'staging-beacon');
assert.equal(process.env.LIVEKIT_URL, 'ws://livekit:7880');
const url = process.env.LIVEKIT_URL;
const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;
const roomName = 'staging-beacon';
const service = new RoomServiceClient(url.replace(/^ws/, 'http'), apiKey, apiSecret);
const existing = await service.listParticipants(roomName);
assert.deepEqual(existing.map(p => p.identity).sort(), ['playlist-bot'], 'Refusing to overlap another staging participant');
assert.equal(JSON.parse(existing[0].metadata || '{}').schema, 'hb.bed-audio.v1');
const observer = new Room();
const beacon = new Room();
const readers = [];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let source;
let lastLoudAt = 0;
let sourceLastLoudAt = 0;
let frames = 0;
let feed = false;
let loud = true;
let feeder;
const passed = phase => console.log(JSON.stringify({ phase, status: 'passed', decodedFrames: frames }));
const token = async (identity, subscribe) => {
  const access = new AccessToken(apiKey, apiSecret, { identity, name: 'HB590 synthetic staging rehearsal', ttl: '2m' });
  access.addGrant({ roomJoin: true, room: roomName, canPublish: identity === 'beacon01', canSubscribe: subscribe, canPublishData: false, canUpdateOwnMetadata: false });
  return access.toJwt();
};
const deadlineTimer = setTimeout(() => process.exit(2), 90000);
  observer.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (!['playlist-bot', 'beacon01'].includes(participant.identity)) return;
    const reader = new AudioStream(track, 48_000, 2).getReader();
    readers.push(reader);
    void (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        frames++;
        let sum = 0;
        for (const sample of value.data) sum += sample * sample;
        if (Math.sqrt(sum / value.data.length) > 100) {
          if (participant.identity === 'playlist-bot') lastLoudAt = Date.now();
          else sourceLastLoudAt = Date.now();
        }
      }
    })().catch(() => {});
  });
try {
    await observer.connect(url, await token('hb590-lifecycle-observer', true), { autoSubscribe: true });
    const deadline = Date.now() + 12_000;
    while (!lastLoudAt && Date.now() < deadline) await sleep(50);
    assert.ok(lastLoudAt, `bed never delivered decoded audible PCM (${frames} frames)`);
    const telemetry = async () => {
      const publisher = (await service.listParticipants(roomName)).find(p => p.identity === 'playlist-bot');
      const data = JSON.parse(publisher?.metadata ?? '{}');
      assert.equal(data.schema, 'hb.bed-audio.v1', 'actual bot must publish its versioned audio telemetry');
      assert.ok(Date.now() - data.reportedAt < 5000, 'bot telemetry must be fresh');
      return data;
    };
    await sleep(1100);
    assert.ok(Date.now() - (await telemetry()).bedAudibleAt < 3000, 'audible fallback must be reflected in actual metadata');
    passed('baseline');
    await beacon.connect(url, await token('beacon01', false), { autoSubscribe: false });
    await sleep(3000);
    assert.ok(Date.now() - lastLoudAt < 500, 'connected beacon without publication suppressed audible bed');
    passed('connected-without-track');
    source = new AudioSource(48_000, 2);
    const publication = await beacon.localParticipant.publishTrack(LocalAudioTrack.createAudioTrack('silent-beacon', source),
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
    // A track with no captured samples is a real connected-but-silent source.
    await sleep(5000);
    assert.ok(Date.now() - lastLoudAt < 500, 'silent publication suppressed audible bed');
    passed('published-without-frames');
    feed = true;
    feeder = (async () => {
      let position = 0;
      while (feed) {
        const samples = new Int16Array(960 * 2);
        for (let i = 0; i < 960; i++, position++) {
          const sample = loud ? Math.round(8000 * Math.sin(position * 2 * Math.PI * 880 / 48000)) : 0;
          samples[i * 2] = samples[i * 2 + 1] = sample;
        }
        await source.captureFrame(new AudioFrame(samples, 48000, 2, 960));
      }
    })().catch(() => {});
    await sleep(6000);
    assert.ok(Date.now() - lastLoudAt > 1000, `audible beacon failed to fade out bed`);
    assert.equal((await telemetry()).sourceAudible, true);
    assert.ok(Date.now() - sourceLastLoudAt < 500, 'source did not deliver audible PCM');
    passed('audible-source');
    loud = false;
    await sleep(7500);
    assert.ok(Date.now() - lastLoudAt < 500, `sustained zero PCM failed to restore bed`);
    assert.equal((await telemetry()).sourceAudible, false);
    assert.ok(Date.now() - (await telemetry()).bedAudibleAt < 3000);
    passed('sustained-zero-pcm');
    loud = true;
    await sleep(6000);
    assert.ok(Date.now() - lastLoudAt > 1000, `resumed source failed to fade out bed`);
    assert.ok(publication.sid);
    await service.mutePublishedTrack(roomName, 'beacon01', publication.sid, true);
    await sleep(3500);
    assert.ok(Date.now() - lastLoudAt < 500, 'muted source failed to restore bed');
    passed('mute');
    // Native SDK has no local mute API; remote unmute is intentionally disabled.
    // The separate browser-owned publisher probe covers local mute/unmute.
    await beacon.localParticipant.unpublishTrack(publication.sid);
    await sleep(3500);
    assert.ok(Date.now() - lastLoudAt < 500, 'unpublished source failed to restore bed');
    passed('unpublish');
    await service.removeParticipant(roomName, 'playlist-bot');
    await sleep(5000);
    assert.ok(Date.now() - lastLoudAt < 500, 'reconnected bot failed to restore audible bed');
    passed('bot-reconnect');
    passed('complete');
} catch (error) {
    console.error(JSON.stringify({status: 'failed', error: String(error).replace(/eyJ[A-Za-z0-9_.-]+/g, '[token]').slice(0, 500)}));
    process.exitCode = 1;
} finally {
    feed = false;
    await Promise.allSettled(readers.map(reader => reader.cancel()));
    await Promise.allSettled([observer.disconnect(), beacon.disconnect(), source?.close()]);
    await feeder;
    await dispose();
    try {
      const cleanupDeadline = Date.now() + 5000;
      let remaining;
      do {
        remaining = await service.listParticipants(roomName);
        if (remaining.length === 1 && remaining[0].identity === 'playlist-bot') break;
        await sleep(200);
      } while (Date.now() < cleanupDeadline);
      assert.deepEqual(remaining.map(p => p.identity).sort(), ['playlist-bot'], 'Synthetic participants did not leave cleanly');
      passed('cleanup-only-bot-remains');
    } catch {
      console.error(JSON.stringify({status: 'cleanup-failed', room: roomName}));
      process.exitCode = 1;
    }
    clearTimeout(deadlineTimer);
}
