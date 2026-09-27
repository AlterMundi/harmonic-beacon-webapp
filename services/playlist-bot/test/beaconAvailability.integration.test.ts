import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import {
  AudioSource,
  LocalAudioTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
  dispose,
} from '@livekit/rtc-node';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';
import { hasAvailableBeaconAudio } from '../src/beaconAvailability.js';

const livekitUrl = process.env.LIVEKIT_NATIVE_TEST_URL;
const apiKey = process.env.LIVEKIT_NATIVE_TEST_API_KEY;
const apiSecret = process.env.LIVEKIT_NATIVE_TEST_API_SECRET;
const enabled = Boolean(livekitUrl && apiKey && apiSecret);

// This opt-in test intentionally exercises TrackUnmuted as an SDK lifecycle
// signal. The disposable LiveKit used for the test must set
// `room.enable_remote_unmute: true`; production keeps the safer default where
// staff can mute a participant but cannot turn their microphone back on.

function httpUrl(url: string): string {
  return url.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:');
}

async function token(roomName: string, identity: string): Promise<string> {
  const access = new AccessToken(apiKey!, apiSecret!, { identity, ttl: '10m' });
  access.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: false,
  });
  return access.toJwt();
}

async function connect(roomName: string, identity: string): Promise<Room> {
  const room = new Room();
  await room.connect(livekitUrl!, await token(roomName, identity), {
    autoSubscribe: false,
  });
  return room;
}

async function eventually(
  predicate: () => boolean,
  message: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  assert.fail(message);
}

describe('Beacon availability against the pinned LiveKit SDK', () => {
  after(async () => {
    if (enabled) await dispose();
  });

  it('reconciles connect, publish, mute, unmute, unpublish and identity replacement from native snapshots', {
    skip: !enabled,
    timeout: 45_000,
  }, async () => {
    const roomName = `hb-playlist-native-${Date.now()}`;
    const observer = await connect(roomName, 'playlist-observer');
    const beacon = await connect(roomName, 'beacon01');
    let source: AudioSource | null = null;
    let replacement: Room | null = null;
    let replacementSource: AudioSource | null = null;

    const available = () => hasAvailableBeaconAudio(observer.remoteParticipants.values());

    try {
      await eventually(
        () => observer.remoteParticipants.has('beacon01'),
        'observer never saw beacon01 connect',
      );
      assert.equal(available(), false, 'identity presence alone must not suppress fallback');

      source = new AudioSource(48_000, 2);
      const track = LocalAudioTrack.createAudioTrack('beacon-native-audio', source);
      const publication = await beacon.localParticipant!.publishTrack(
        track,
        new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
      );
      assert.ok(publication.sid, 'native publication must expose a track SID');
      await eventually(available, 'unmuted native audio publication was not detected');

      const service = new RoomServiceClient(httpUrl(livekitUrl!), apiKey!, apiSecret!);
      await service.mutePublishedTrack(roomName, 'beacon01', publication.sid, true);
      await eventually(() => !available(), 'server mute was not reflected in the native snapshot');

      await service.mutePublishedTrack(roomName, 'beacon01', publication.sid, false);
      await eventually(available, 'server unmute was not reflected in the native snapshot');

      await beacon.localParticipant!.unpublishTrack(publication.sid);
      await eventually(() => !available(), 'unpublish was not reflected in the native snapshot');

      replacement = await connect(roomName, 'beacon01');
      replacementSource = new AudioSource(48_000, 2);
      const replacementTrack = LocalAudioTrack.createAudioTrack(
        'beacon-native-replacement',
        replacementSource,
      );
      await replacement.localParticipant!.publishTrack(
        replacementTrack,
        new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
      );
      await eventually(
        available,
        'replacement beacon01 publication was not reconstructed from the current snapshot',
      );
    } finally {
      await Promise.allSettled([
        replacement?.disconnect(),
        beacon.disconnect(),
        observer.disconnect(),
        replacementSource?.close(),
        source?.close(),
      ].filter((operation): operation is Promise<unknown> => operation instanceof Promise));
    }
  });
});
