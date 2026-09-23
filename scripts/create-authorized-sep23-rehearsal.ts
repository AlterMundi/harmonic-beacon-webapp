/** One-event operator action explicitly requested by Direction, 2026-09-23.
 * Dry-run by default. Uses product services, never mints a web session.
 * Run only through an authorized host operator; this is not a public API.
 */
import { prisma } from '../src/lib/db';
import { saveEvent } from '../src/lib/event-editor';
import { transitionScheduledSession } from '../src/lib/session-lifecycle';
import { terminateSessionMedia } from '../src/lib/session-termination';

const prepareClosed = process.argv.includes('--prepare-closed');
const id = prepareClosed ? '50000000-0000-4000-8000-202609230004' : '50000000-0000-4000-8000-202609230003';
const title = prepareClosed ? 'Simulación de equipo — apertura manual' : 'Prueba de equipo — acceso inmediato';
async function main() {
  if (new Date().toISOString().slice(0,10) !== '2026-09-23') throw Error('date fence');
  const actorEmail = process.env.AUTHORIZED_EVENT_ACTOR;
  if (!actorEmail) throw Error('explicit actor required');
  const actor = await prisma.user.findFirst({where:{email:actorEmail,role:'ADMIN',disabledAt:null}});
  if (!actor) throw Error('authorized admin unavailable');
  const reference = await prisma.scheduledSession.findUniqueOrThrow({where:{id:'50000000-0000-4000-8000-202609230002'}});
  if(reference.status !== 'SCHEDULED' || reference.scheduledAt.toISOString() !== '2026-09-23T22:00:00.000Z') throw Error('evening changed');
  const existing = await prisma.scheduledSession.findUnique({where:{id}});
  if(existing && (existing.title !== title || !existing.publicAccess || existing.roomName !== `event-${id}`)) throw Error('target conflict');
  if(prepareClosed && existing && existing.status !== 'SCHEDULED') throw Error('simulation already started; do not reset');
  const fields = {id,title,description:'Ensayo del equipo. No es el encuentro de las 19:00.',
    scheduledAt:existing?.scheduledAt.toISOString() || new Date(Date.now()+(prepareClosed ? 300_000 : 60_000)).toISOString(),
    eventTimeZone:'America/Argentina/Buenos_Aires',language:'SPANISH',facilitatorId:reference.facilitatorId,
    publicAccess:true,isPublished:true};
  if(!process.argv.includes('--apply')) { console.log(JSON.stringify({mode:'dry-run',id,scheduledAt:fields.scheduledAt,eveningUnchanged:true})); return; }
  if(!existing) await saveEvent(actor, fields);
  if(prepareClosed) {
    const previousId='50000000-0000-4000-8000-202609230003';
    const previous=await prisma.scheduledSession.findUniqueOrThrow({where:{id:previousId}});
    if(previous.title !== 'Prueba de equipo — acceso inmediato' || previous.roomName !== `event-${previousId}`) throw Error('previous conflict');
    await transitionScheduledSession({sessionId:previousId,actor,targetStatus:'ENDED',reason:'Direction requests closed-door simulation instead of immediately open rehearsal'});
    const termination=await terminateSessionMedia({sessionId:previousId,actorUserId:actor.id,actorRole:actor.role});
    if(!termination.complete) throw Error('previous media cleanup incomplete');
    console.log(JSON.stringify({id,status:'SCHEDULED',doors:'closed',previousEnded:true,url:`https://live.harmonicbeacon.com/session/${id}`}));
    return;
  }
  const result=await transitionScheduledSession({sessionId:id,actor,targetStatus:'LIVE',reason:'Explicit Direction request: immediate team rehearsal; no UI available'});
  console.log(JSON.stringify({id,status:result.status,url:`https://live.harmonicbeacon.com/session/${id}`}));
}
main().catch(()=>{console.error('Authorized rehearsal failed; inspect state before retry');process.exitCode=1;}).finally(()=>prisma.$disconnect());
