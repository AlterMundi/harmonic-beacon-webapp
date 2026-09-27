import assert from 'node:assert/strict';
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

assert.equal(process.stdout.isTTY, undefined, 'Pipe tokens directly into the browser probe');
assert.equal(process.env.STAGING_MEDIA_PROBE, '1');
assert.equal(process.env.LIVEKIT_ROOM_NAME, 'staging-beacon');
assert.equal(process.env.LIVEKIT_URL, 'ws://livekit:7880');
const { LIVEKIT_API_KEY: key, LIVEKIT_API_SECRET: secret } = process.env;
const service = new RoomServiceClient('http://livekit:7880', key, secret);
const participants = await service.listParticipants('staging-beacon');
assert.deepEqual(participants.map(p => p.identity).sort(), ['playlist-bot'], 'Another rehearsal is active');
async function issue(identity, publish) {
  const token = new AccessToken(key, secret, { identity, name: 'HB590 synthetic browser rehearsal', ttl: '2m' });
  token.addGrant({ roomJoin: true, room: 'staging-beacon', canPublish: publish, canSubscribe: !publish, canPublishData: false, canUpdateOwnMetadata: false });
  return token.toJwt();
}
process.stdout.write(JSON.stringify({ observer: await issue('hb590-browser-pcm-observer', false), source: await issue('beacon01', true) }));
