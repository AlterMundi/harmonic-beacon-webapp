import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAdmission } from '../../../ops/analytics/analytics-delivery-state.mjs';
const hash = c => `sha256:${c.repeat(64)}`;
const now = Date.parse('2026-09-28T00:00:00Z');
const invocation = {verb:'transaction',target:'analytics-production',operation:'deploy',sourceSha:'a'.repeat(40),imageDigest:hash('b'),ciRunId:'1',ciRunAttempt:1,buildRunId:'2',buildRunAttempt:1,workflowRef:'qualified',githubRef:'refs/heads/release',runId:'3',runAttempt:1,reversedRunId:'0',reversedRunAttempt:0};
const previous = {sourceSha:'c'.repeat(40),imageId:hash('d'),digest:hash('e'),configSha256:hash('f')};
const make = () => ({schemaVersion:'hb.analytics.owner-admission.v1',invocation:{...invocation},previous:{...previous},configSha256:hash('a'),expiresAt:'2026-09-28T01:00:00Z'});
const check = (a, i=invocation, current=previous, journal=null, time=now) => validateAdmission(a,i,current,journal,hash('a'),time);
test('fresh owner admission binds every invocation field and current base', () => {
 assert.match(check(make()), /^sha256:/);
 assert.throws(() => check(null), /admission/);
 for (const key of Object.keys(invocation)) {
  const changed={...invocation,[key]:typeof invocation[key]==='number'?9:'different'};
  assert.throws(() => check(make(),changed), /invocation mismatch/, key);
 }
 for(const key of Object.keys(previous)) assert.throws(() => check(make(),invocation,{...previous,[key]:'different'}),/current state mismatch/,key);
 assert.throws(() => check({...make(),expiresAt:'2026-09-27T23:00:00Z'}),/expired/);
 assert.throws(() => check({...make(),expiresAt:'2026-09-30T00:00:00Z'}),/exceeds/);
 assert.throws(() => check({...make(),configSha256:hash('b')}),/Compose mismatch/);
 assert.throws(() => check({...make(),extra:true}),/invalid owner admission/);
});
test('durable acceptance permits identical recovery after expiry but rejects substitution and stale unfinished replay', () => {
 const a=make();
 const journal={admissionSha256:check(a),previous,operation:'deploy',phase:'prepared',sourceSha:invocation.sourceSha,imageId:hash('1'),imageDigest:invocation.imageDigest,configSha256:hash('a')};
 const later=now+48*3600*1000;
 assert.doesNotThrow(() => check(a,invocation,previous,journal,later));
 assert.throws(() => check({...a,expiresAt:'2026-09-28T02:00:00Z'},invocation,previous,journal,later),/admission changed/);
 assert.throws(() => check(a,invocation,{...previous,sourceSha:'newer'},journal,later),/no longer owns/);
 const published={sourceSha:journal.sourceSha,imageId:journal.imageId,digest:journal.imageDigest,configSha256:journal.configSha256};
 assert.doesNotThrow(() => check(a,invocation,published,{...journal,phase:'replaced'},later));
 assert.doesNotThrow(() => check(a,invocation,{...previous,sourceSha:'newer'},{...journal,phase:'committed'},later));
});
