import test from 'node:test';
import assert from 'node:assert/strict';
import { validManifest } from './b2-fixture.mjs';
import { validateQualificationEvidence, validateReleaseManifest, verifyReleaseManifest } from '../release-manifest.mjs';
const evidence = () => ({browser:{engine:'chromium',passed:1,failed:0,skipped:0},syntheticSession:{created:1,authenticatedRole:'ADMIN'},commerce:{workerHeartbeatAgeMs:1,pending:0,processing:0},schema:{expectedHead:'20260909120000_example',observedHead:'20260909120000_example'},isolation:{internalNetworks:['database','media'],forbiddenSecretNamesFound:[]},restore:{backupSha256:`sha256:${'a'.repeat(64)}`,backupBytes:1,restoredSessionCount:1}});
for (const [section,field,max] of [['browser','passed',10000],['syntheticSession','created',10000],['commerce','pending',10000],['commerce','processing',10000],['restore','backupBytes',1073741824],['restore','restoredSessionCount',10000]]) {
 test(`bounded ${section}.${field}`,()=>{
 const e=evidence();e[section][field]=max;validateQualificationEvidence(e);
 for(const bad of [max+1,-1,1.5,'1',null,Number.MAX_SAFE_INTEGER]) {e[section][field]=bad;assert.throws(()=>validateQualificationEvidence(e));}
 });
}
test('qualification lifetime is at most 24 hours',()=>{const m=validManifest();validateReleaseManifest(m);m.qualification.expiresAt='2026-09-11T17:50:00.001Z';assert.throws(()=>validateReleaseManifest(m),/lifetime/);});
test('root rejects future qualification before registry access',()=>{const m=validManifest();assert.throws(()=>verifyReleaseManifest(m,{sourceRepository:m.source.repository,sourceSha:m.source.gitSha,sourceTree:m.source.gitTree,workflowRunId:m.build.workflowRunId,workflowRunAttempt:1,target:'production',targetConfigSha256:m.configProfiles.production.sha256,currentBaseManifestSha256:m.promotion.baseManifestSha256,now:'2026-09-10T17:49:59.999Z'}),/future/);});

import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { verifyFinalCandidateBlobs } from '../../../deploy/hb-artifact-verify.mjs';
test('both final blobs require authentication before parsing, with rejection propagated',()=>{
 const root=mkdtempSync(join(process.cwd(),'.final-auth-'));
 try {
  for(const name of ['candidate-manifest.json','qualification-receipt.json','release-manifest.signature.bundle.json','qualification-receipt.signature.bundle.json']) writeFileSync(join(root,name),'not JSON');
  const seen=[];verifyFinalCandidateBlobs(root,(blob,bundle)=>seen.push([blob,bundle]));assert.equal(seen.length,2);
  for(const denied of [0,1]) {let index=0;assert.throws(()=>verifyFinalCandidateBlobs(root,()=>{if(index++===denied) throw Error('invalid signature');}),/invalid signature/);}
  rmSync(join(root,'qualification-receipt.signature.bundle.json'));assert.throws(()=>verifyFinalCandidateBlobs(root,()=>{}));
 } finally {rmSync(root,{recursive:true,force:true});}
});
