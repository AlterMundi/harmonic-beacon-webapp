// Explicit synthetic-database acceptance; never accepts a production target.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Pool} from 'pg';
import {prisma} from '../src/lib/db';
import {saveEvent} from '../src/lib/event-editor';
import {verifyEventEditorRollbackSafety} from '../src/lib/event-editor-rollback';

async function main(){
    const url=new URL(process.env.DATABASE_URL||'');
    assert.equal(url.hostname,'127.0.0.1');assert.equal(url.pathname,'/beacon_event_test');
    const pool=new Pool({connectionString:url.href});
    try{
        const actor=await prisma.user.upsert({where:{email:'event-editor-operator@example.invalid'},update:{},create:{email:'event-editor-operator@example.invalid',name:'Synthetic operator',role:'FACILITATOR_OP',passwordDigest:'synthetic-not-a-login'}});
        const seed=readFileSync(new URL('../prisma/migrations/20260923120000_create_sep23_proyecciones_mito/migration.sql',import.meta.url),'utf8');
        await pool.query(seed);
        await pool.query(seed);
        assert.equal(await prisma.scheduledSession.count({where:{id:{in:['50000000-0000-4000-8000-202609230001','50000000-0000-4000-8000-202609230002']}}}),2);
        const correction=readFileSync(new URL('../prisma/migrations/20260923170000_correct_sep23_evening_time/migration.sql',import.meta.url),'utf8');
        await pool.query(correction);await pool.query(correction);
        const evening=await prisma.scheduledSession.findUniqueOrThrow({where:{id:'50000000-0000-4000-8000-202609230002'}});
        assert.equal(evening.title,'Proyecciones Mito — 19:00');
        assert.equal(evening.scheduledAt.toISOString(),'2026-09-23T22:00:00.000Z');
        assert.equal(evening.roomName,'proyecciones-mito-2026-09-23-1800-art');
        await verifyEventEditorRollbackSafety(prisma);
        const input={id:'80000000-0000-4000-8000-000000000088',title:'Synthetic future event',scheduledAt:'2099-09-23T21:00:00Z',eventTimeZone:'America/Argentina/Buenos_Aires',language:'SPANISH',facilitatorId:actor.id,publicAccess:true,isPublished:false};
        const concurrent=await Promise.all([saveEvent(actor,input),saveEvent(actor,input)]);
        assert.equal(concurrent[0].id,concurrent[1].id);
        assert.equal(await prisma.auditLog.count({where:{targetId:input.id,action:'event.created'}}),1);
        await assert.rejects(verifyEventEditorRollbackSafety(prisma),/event_editor_old_binary_rollback_refused/);
        const event=concurrent[0];
        const updated=await saveEvent(actor,{...input,isPublished:true,updatedAt:event.updatedAt.toISOString()},event.id);
        assert.equal(updated.isPublished,true);assert.equal(updated.status,'SCHEDULED');
        await assert.rejects(saveEvent(actor,{...input,updatedAt:event.updatedAt.toISOString()},event.id));
        assert.equal(await prisma.ticketEntitlement.count(),0);
        assert.equal(await prisma.sessionParticipant.count(),0);
        console.log('PASS: populated event seed/replay, concurrent create, audit once, publication, stale update, zero tickets/participants');
    }finally{await pool.end();await prisma.$disconnect();}
}
main().catch(error=>{console.error('FAIL: synthetic PostgreSQL acceptance',error instanceof Error?error.message:'unknown');process.exitCode=1;});
