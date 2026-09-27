import { AccessToken } from 'livekit-server-sdk';
if (process.stdout.isTTY || process.env.LIVEKIT_ROOM_NAME !== 'staging-beacon' || process.env.LIVEKIT_URL !== 'ws://livekit:7880') {
  throw new Error('Use only in the staging bot and pipe stdout directly into the staging probe.');
}
const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, { identity: 'hb590-external-pcm-observer', ttl: '2m' });
token.addGrant({roomJoin:true,room:'staging-beacon',canPublish:false,canPublishData:false,canUpdateOwnMetadata:false,canSubscribe:true});
process.stdout.write(await token.toJwt());
