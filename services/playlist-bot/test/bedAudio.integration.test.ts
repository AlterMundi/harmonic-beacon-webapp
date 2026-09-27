import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AudioFrame, AudioSource, AudioStream, LocalAudioTrack, Room, RoomEvent, TrackPublishOptions, TrackSource, dispose } from '@livekit/rtc-node';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

const url = process.env.LIVEKIT_NATIVE_TEST_URL;
const apiKey = process.env.LIVEKIT_NATIVE_TEST_API_KEY;
const apiSecret = process.env.LIVEKIT_NATIVE_TEST_API_SECRET;
const enabled = Boolean(url && apiKey && apiSecret);
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// This starts the actual compiled bot and measures decoded subscriber PCM.
// Only the explicitly supplied disposable server and synthetic recording are used.
test('actual bed PCM follows silence, sound, mute, unpublish and bot reconnect', {
  skip: !enabled, timeout: 80_000,
}, async () => {
  const roomName = `hb-bed-pcm-${Date.now()}`;
  const service = new RoomServiceClient(url!.replace(/^ws/, 'http'), apiKey!, apiSecret!);
  const directory = mkdtempSync(join(tmpdir(), 'hb-bed-pcm-'));
  const observer = new Room();
  const beacon = new Room();
  const readers: ReadableStreamDefaultReader<unknown>[] = [];
  let source: AudioSource | undefined;
  let bot: ReturnType<typeof spawn> | undefined;
  let botLogs = '';
  let lastLoudAt = 0;
  let sourceLastLoudAt = 0;
  let frames = 0;
  let feed = false;
  let loud = true;
  let feeder: Promise<void> | undefined;
  const token = async (identity: string, subscribe: boolean) => {
    const access = new AccessToken(apiKey!, apiSecret!, { identity, ttl: '5m' });
    access.addGrant({ roomJoin: true, room: roomName, canPublish: identity === 'beacon01', canSubscribe: subscribe });
    return access.toJwt();
  };
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
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '30', '-ac', '2', join(directory, 'rehearsal.wav')]);
    await observer.connect(url!, await token('pcm-observer', true), { autoSubscribe: true });
    bot = spawn(process.execPath, [resolve('services/playlist-bot/dist/index.js')], {
      env: { ...process.env, LIVEKIT_URL: url, LIVEKIT_API_KEY: apiKey, LIVEKIT_API_SECRET: apiSecret,
        LIVEKIT_ROOM_NAME: roomName, BEACON_RECORDS_PATH: directory, BEACON_PLAYLIST_FILE: 'rehearsal.wav' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    bot.stdout?.on('data', chunk => { botLogs = (botLogs + chunk.toString()).slice(-8000); });
    bot.stderr?.on('data', chunk => { botLogs = (botLogs + chunk.toString()).slice(-8000); });
    const deadline = Date.now() + 12_000;
    while (!lastLoudAt && Date.now() < deadline) await sleep(50);
    assert.ok(lastLoudAt, `bed never delivered decoded audible PCM (${frames} frames); ${botLogs}`);
    const telemetry = async () => {
      const publisher = (await service.listParticipants(roomName)).find(p => p.identity === 'playlist-bot');
      const data = JSON.parse(publisher?.metadata ?? '{}');
      assert.equal(data.schema, 'hb.bed-audio.v1', 'actual bot must publish its versioned audio telemetry');
      assert.ok(Date.now() - data.reportedAt < 5000, 'bot telemetry must be fresh');
      return data;
    };
    await sleep(1100);
    assert.ok(Date.now() - (await telemetry()).bedAudibleAt < 3000, 'audible fallback must be reflected in actual metadata');
    await beacon.connect(url!, await token('beacon01', false), { autoSubscribe: false });
    await sleep(3000);
    assert.ok(Date.now() - lastLoudAt < 500, 'connected beacon without publication suppressed audible bed');
    source = new AudioSource(48_000, 2);
    const publication = await beacon.localParticipant!.publishTrack(LocalAudioTrack.createAudioTrack('silent-beacon', source),
      new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }));
    // A track with no captured samples is a real connected-but-silent source.
    await sleep(5000);
    assert.ok(Date.now() - lastLoudAt < 500, `silent publication suppressed audible bed; ${botLogs}`);
    feed = true;
    feeder = (async () => {
      let position = 0;
      while (feed) {
        const samples = new Int16Array(960 * 2);
        for (let i = 0; i < 960; i++, position++) {
          const sample = loud ? Math.round(8000 * Math.sin(position * 2 * Math.PI * 880 / 48000)) : 0;
          samples[i * 2] = samples[i * 2 + 1] = sample;
        }
        await source!.captureFrame(new AudioFrame(samples, 48000, 2, 960));
      }
    })().catch(() => {});
    await sleep(6000);
    assert.ok(Date.now() - lastLoudAt > 1000, `audible beacon failed to fade out bed; ${botLogs}`);
    assert.equal((await telemetry()).sourceAudible, true);
    loud = false;
    await sleep(7500);
    assert.ok(Date.now() - lastLoudAt < 500, `sustained zero PCM failed to restore bed; ${botLogs}`);
    assert.equal((await telemetry()).sourceAudible, false);
    assert.ok(Date.now() - (await telemetry()).bedAudibleAt < 3000);
    loud = true;
    await sleep(6000);
    assert.ok(Date.now() - lastLoudAt > 1000, `resumed source failed to fade out bed; ${botLogs}`);
    assert.ok(publication.sid);
    await service.mutePublishedTrack(roomName, 'beacon01', publication.sid, true);
    await sleep(3500);
    assert.ok(Date.now() - lastLoudAt < 500, 'muted source failed to restore bed');
    await service.mutePublishedTrack(roomName, 'beacon01', publication.sid, false);
    await sleep(6000);
    assert.ok(Date.now() - sourceLastLoudAt < 500, 'fixture source did not resume audible PCM after remote unmute');
    assert.ok(Date.now() - lastLoudAt > 1000, `unmuted audible source failed to fade out bed; ${botLogs}`);
    await beacon.localParticipant!.unpublishTrack(publication.sid);
    await sleep(3500);
    assert.ok(Date.now() - lastLoudAt < 500, 'unpublished source failed to restore bed');
    await service.removeParticipant(roomName, 'playlist-bot');
    await sleep(5000);
    assert.ok(Date.now() - lastLoudAt < 500, `reconnected bot failed to restore audible bed; ${botLogs}`);
  } finally {
    feed = false;
    bot?.kill('SIGTERM');
    await Promise.allSettled(readers.map(reader => reader.cancel()));
    await Promise.allSettled([observer.disconnect(), beacon.disconnect(), source?.close()]);
    if (bot && bot.exitCode === null) {
      await Promise.race([new Promise(resolve => bot!.once('exit', resolve)), sleep(3000)]);
      if (bot.exitCode === null) bot.kill('SIGKILL');
    }
    await feeder;
    await dispose();
    rmSync(directory, { recursive: true, force: true });
  }
});
