import { Room, RoomEvent, AudioStream, dispose } from '@livekit/rtc-node';
import { readFileSync } from 'node:fs';

const legacy=process.argv.length===3 && process.argv[2]==='--legacy-publisher';
if (process.argv.length !== 2 && !legacy) throw new Error('This fixed staging probe accepts only a read-only token through stdin.');
const room = new Room();
const readers = [];
let frames = 0;
let audibleFrames = 0;
let receivedMs = 0;
let audibleMs = 0;
let metadata;
let providedToken='';
const limit = setTimeout(() => process.exit(2), 45000);
try {
  room.on(RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (participant.identity !== 'playlist-bot') return;
    const reader = new AudioStream(track, 48000, 2).getReader();
    readers.push(reader);
    void (async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) return;
        frames++;
        const frameMs=value.samplesPerChannel/value.sampleRate*1000;
        receivedMs+=frameMs;
        let energy=0;
        for (const sample of value.data) energy+=sample*sample;
        if (Math.sqrt(energy/value.data.length)>100) { audibleFrames++; audibleMs+=frameMs; }
      }
    })().catch(()=>{});
  });
  const token=readFileSync(0,'utf8').trim();
  providedToken=token;
  const claims=JSON.parse(Buffer.from(token.split('.')[1]??'', 'base64url').toString('utf8'));
  if (claims.video?.room!=='staging-beacon' || claims.video.canPublish!==false || claims.video.canPublishData!==false || claims.video.canUpdateOwnMetadata!==false || claims.video.canSubscribe!==true) {
    throw new Error('Only an explicitly read-only staging-beacon grant is accepted.');
  }
  await room.connect('wss://live-staging.harmonicbeacon.com/rtc',token,{autoSubscribe:true});
  await new Promise(resolve=>setTimeout(resolve,10000));
  const bot=room.remoteParticipants.get('playlist-bot');
  metadata=JSON.parse(bot?.metadata??'{}');
  const telemetryFresh=metadata.schema==='hb.bed-audio.v1' && Date.now()-metadata.reportedAt<5000;
  console.log(JSON.stringify({room:'staging-beacon',publisher:legacy?'legacy-without-audio-telemetry':'candidate',frames,audibleFrames,receivedMs,audibleMs,telemetryFresh,sourceAudible:metadata.sourceAudible,bedFrameAgeMs:Date.now()-metadata.bedAudibleAt}));
  if(receivedMs<9000 || audibleMs/receivedMs<0.98 || (!legacy && (!telemetryFresh || metadata.sourceAudible!==false))) process.exitCode=1;
} catch (error) {
  console.log(JSON.stringify({status:'probe-failed',frames,audibleFrames,error:String(error).replaceAll(providedToken||'unused-redaction-sentinel','[token]').replace(/eyJ[A-Za-z0-9_.-]+/g,'[token]').slice(0,500)}));
  process.exitCode=1;
} finally {
  await Promise.allSettled(readers.map(r=>r.cancel()));
  await room.disconnect();
  await dispose();
  clearTimeout(limit);
}
