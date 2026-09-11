import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as trusted from '../release-manifest.mjs';
const digest = `sha256:${'a'.repeat(64)}`;
const now = Date.parse('2026-09-11T00:00:00.000Z');
const fixture = () => ({schemaVersion:'harmonic-beacon.delivery-authorization.v1',
 sourceSha:'a'.repeat(40), sourceTree:'b'.repeat(40), candidateManifestSha256:'c'.repeat(64), baseManifestSha256:'d'.repeat(64),
 candidateRunId:'12', candidateRunAttempt:1, deliveryRunId:'34', deliveryRunAttempt:2,
 workflowPath:'.github/workflows/oci-promote.yml', workflowRef:'refs/heads/main',
 laneState:'legacy-shadow', environment:'shadow', target:'shadow', operation:'promote', configSha256:digest,
 transitionAuthorizationSha256:null, verbs:['prepare','preflight','status'],
 authorizedAt:new Date(now).toISOString(), expiresAt:new Date(now+600000).toISOString()});
const bytes = value => Buffer.from(trusted.canonicalize(value));
test('canonical protected delivery authorization has a positive installed-validator control', () => {
 const a=fixture(); assert.deepEqual(trusted.validateDeliveryAuthorization(bytes(a),a,{now}),a);
});
test('closed delivery schema rejects mismatched binding, time, target, operation and verbs', () => {
 const original=fixture();
 for(const key of ['sourceSha','sourceTree','candidateManifestSha256','baseManifestSha256','candidateRunId','candidateRunAttempt','deliveryRunId','deliveryRunAttempt','workflowPath','workflowRef','environment','target','operation','configSha256','transitionAuthorizationSha256','laneState']) {
  const a=fixture(); a[key]=typeof a[key]==='number'?a[key]+1:'wrong';
  assert.throws(()=>trusted.validateDeliveryAuthorization(bytes(a),original,{now}),key);
 }
 for(const mutate of [a=>a.extra='secret',a=>a.verbs.pop(),a=>a.verbs.push('shell'),a=>a.authorizedAt=new Date(now+1).toISOString(),a=>a.expiresAt=new Date(now).toISOString(),a=>a.expiresAt=new Date(now+900001).toISOString(),a=>a.authorizedAt='2026-09-11T00:00:00Z',a=>a.environment='staging']) {
  const a=fixture();mutate(a);assert.throws(()=>trusted.validateDeliveryAuthorization(bytes(a),{}, {now}));
 }
 assert.throws(()=>trusted.validateDeliveryAuthorization(Buffer.from(JSON.stringify(original)),{}, {now}),/canonical/);
});
test('production promote requires a transition digest; rollback uses only rollback verb',()=>{
 const a={...fixture(),laneState:'oci-production',target:'production',environment:'production',verbs:['prepare','preflight','migrate','replace','status','rollback']};
 assert.throws(()=>trusted.validateDeliveryAuthorization(bytes(a),{}, {now}),/transition/);
 a.transitionAuthorizationSha256=digest;trusted.validateDeliveryAuthorization(bytes(a),{}, {now});
 a.operation='rollback';assert.throws(()=>trusted.validateDeliveryAuthorization(bytes(a),{}, {now}));
 a.verbs=['rollback'];a.transitionAuthorizationSha256=null;trusted.validateDeliveryAuthorization(bytes(a),{}, {now});
});
test('production preparation has no mutable transition-directory fallback',()=>{
 const source=readFileSync('deploy/hb-deploy-root','utf8');
 assert.doesNotMatch(source,/readonly TRANSITION_EVIDENCE=/);
 assert.doesNotMatch(source,/require_transition_producer|production preparation disabled/);
 assert.match(source,/admit_transition_evidence "\$input_root" "\$temp\/transition"/);
});
function transaction(a = fixture()) {
 return {sourceSha:a.sourceSha,sourceTree:a.sourceTree,manifestSha256:a.candidateManifestSha256,baseManifestSha256:a.baseManifestSha256,
 workflowRunId:a.candidateRunId,workflowRunAttempt:a.candidateRunAttempt,target:a.target,targetConfigSha256:a.configSha256,
 phase:'prepared',deliveryAuthorization:a,deliveryAuthorizationSha256:trusted.publicConfigSha256(bytes(a))};
}
const invocation = (extra={}) => ({deliveryRunId:'34',deliveryRunAttempt:2,target:'shadow',verb:'preflight',...extra});
test('every artifact verb rejects wrong delivery run and attempt and missing persisted authority',()=>{
 for(const verb of ['prepare','preflight','migrate','replace','status','rollback']) {
  const a={...fixture(),target:'production',environment:'production',laneState:'oci-production',verbs:['prepare','preflight','migrate','replace','status','rollback'],transitionAuthorizationSha256:digest};
  const r=transaction(a); const i=invocation({verb,target:'production',activeRunId:a.candidateRunId});
  trusted.validateDeliveryInvocation(r,i,now);
  for(const bad of [{deliveryRunId:'35'},{deliveryRunAttempt:3},{target:'shadow'}]) assert.throws(()=>trusted.validateDeliveryInvocation(r,{...i,...bad},now));
  delete r.deliveryAuthorization;assert.throws(()=>trusted.validateDeliveryInvocation(r,i,now));
 }
});
test('active exact failure rollback resumes after expiry; promote cannot start committed markerless rollback',()=>{
 const a={...fixture(),target:'production',environment:'production',laneState:'oci-production',verbs:['prepare','preflight','migrate','replace','status','rollback'],transitionAuthorizationSha256:digest};
 const r={...transaction(a),phase:'migrated'};
 const i=invocation({verb:'rollback',target:'production',activeRunId:a.candidateRunId});
 trusted.validateDeliveryInvocation(r,i,now+3600000);
 r.phase='committed';assert.throws(()=>trusted.validateDeliveryInvocation(r,{...i,activeRunId:null},now),/fresh rollback/);
 assert.throws(()=>trusted.validateDeliveryInvocation(r,{...i,activeRunId:'999'},now),/fresh rollback/);
});
test('fresh rollback permits only its exact durable intent; expired intent resumes and replay has no new authority',()=>{
 const original={...fixture(),target:'production',environment:'production',laneState:'oci-production',verbs:['prepare','preflight','migrate','replace','status','rollback'],transitionAuthorizationSha256:digest};
 const rollback={...original,operation:'rollback',deliveryRunId:'99',verbs:['rollback'],transitionAuthorizationSha256:null};
 const r={...transaction(original),phase:'committed',rollbackIntent:true,rollbackDeliveryAuthorization:rollback,rollbackDeliveryAuthorizationSha256:trusted.publicConfigSha256(bytes(rollback))};
 const i=invocation({deliveryRunId:'99',target:'production',verb:'rollback'});
 trusted.validateDeliveryInvocation(r,i,now+3600000);
 for(const verb of ['prepare','preflight','migrate','replace','status']) assert.throws(()=>trusted.validateDeliveryInvocation(r,{...i,verb},now));
 assert.throws(()=>trusted.validateDeliveryInvocation(r,{...i,deliveryRunId:'34'},now));
 r.rollbackIntent=false;assert.throws(()=>trusted.validateDeliveryInvocation(r,i,now));
});
test('expired authority resumes only exact root-derived markerless prepare and shadowed cleanup states',()=>{
 const production={...fixture(),target:'production',environment:'production',laneState:'oci-production',verbs:['prepare','preflight','migrate','replace','status','rollback'],transitionAuthorizationSha256:digest};
 const markerless={...transaction(production),phase:'prepared'};
 const productionInvocation=invocation({target:'production',verb:'prepare',activeRunId:null});
 assert.throws(()=>trusted.validateDeliveryInvocation(markerless,productionInvocation,now+900000),/stale delivery authorization/);
 trusted.validateDeliveryInvocation(markerless,{...productionInvocation,durableResume:'production-markerless-prepared'},now+900000);

 const shadowed={...transaction(),phase:'shadowed'};
 const shadowInvocation=invocation({target:'shadow',verb:'status',activeRunId:null});
 assert.throws(()=>trusted.validateDeliveryInvocation(shadowed,shadowInvocation,now+900000),/stale delivery authorization/);
 trusted.validateDeliveryInvocation(shadowed,{...shadowInvocation,durableResume:'shadowed-cleanup'},now+900000);

 for(const [receipt,invocationValue] of [
  [markerless,{...productionInvocation,durableResume:'production-markerless-prepared',activeRunId:'999'}],
  [{...markerless,phase:'migrated'},{...productionInvocation,durableResume:'production-markerless-prepared'}],
  [markerless,{...productionInvocation,durableResume:'production-markerless-prepared',deliveryRunAttempt:3}],
  [{...markerless,manifestSha256:'e'.repeat(64)},{...productionInvocation,durableResume:'production-markerless-prepared'}],
  [markerless,{...productionInvocation,durableResume:'shadowed-cleanup'}],
  [shadowed,{...shadowInvocation,durableResume:'shadowed-cleanup',activeRunId:'999'}],
  [{...shadowed,phase:'prepared'},{...shadowInvocation,durableResume:'shadowed-cleanup'}],
  [shadowed,{...shadowInvocation,durableResume:'shadowed-cleanup',target:'production'}],
  [shadowed,{...shadowInvocation,durableResume:'unknown'}],
 ]) assert.throws(()=>trusted.validateDeliveryInvocation(receipt,invocationValue,now+900000));
});
import { mkdtempSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { stateFixture } from './b3-fixture.mjs';
test('installed rollback admission binds exact current publication and rejects expired, reused or obsolete intent',()=>{
 const root=mkdtempSync(join(process.cwd(),'.delivery-test-'));
 try {
  const state=stateFixture('b');const a={...fixture(),target:'production',environment:'production',laneState:'oci-production',operation:'rollback',verbs:['rollback'],deliveryRunId:'99',candidateManifestSha256:state.manifestSha256,authorizedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()};
  const r={...transaction({...a,operation:'promote',deliveryRunId:'34',transitionAuthorizationSha256:digest,verbs:fixture().verbs}),phase:'committed',candidatePublication:state.publication};
  const run=(auth=a,receipt=r,current=state)=>{
   for(const [name,v] of Object.entries({authorization:auth,receipt,state:current})) writeFileSync(join(root,name),bytes(v));
   rmSync(join(root,'out'),{force:true});
   return spawnSync(process.execPath,['scripts/ci/release-manifest.mjs','bind-rollback-delivery','--authorization',join(root,'authorization'),'--receipt',join(root,'receipt'),'--state',join(root,'state'),'--delivery-run-id','99','--delivery-run-attempt','2','--output',join(root,'out')],{encoding:'utf8'});
  };
  assert.equal(run().status,0);
  const persisted=JSON.parse(readFileSync(join(root,'out')));assert.equal(persisted.rollbackIntent,true);assert.equal(persisted.rollbackDeliveryAuthorizationSha256,trusted.publicConfigSha256(bytes(a)));
  for(const [auth,receipt,current] of [[a,persisted,state],[a,r,{...state,publication:{...state.publication,id:'f'.repeat(64)}}],[{...a,expiresAt:new Date(Date.now()-1).toISOString()},r,state],[{...a,deliveryRunId:'34'},r,state],[{...a,operation:'promote',verbs:fixture().verbs,transitionAuthorizationSha256:digest},r,state]]) {
   assert.notEqual(run(auth,receipt,current).status,0);assert.equal(existsSync(join(root,'out')),false);
  }
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('root delivery admission authenticates exact admitted bytes with promotion identity before parsing',()=>{
 const helper=readFileSync('deploy/hb-deploy-root','utf8');
 const fn=helper.slice(helper.indexOf('admit_delivery_authorization() {'),helper.indexOf('\nrequire_delivery_invocation()'));
 const root=mkdtempSync(join(process.cwd(),'.delivery-auth-'));
 try {
  const q=value=>`'${value.replaceAll("'","'\\''")}'`;
  const prelude=`set -e\ndie() { exit 9; }\ninstall() { mkdir -p "$8"; }\nadmit_signature() { cp "$1" "$2"; }\n`;
  for(const name of ['delivery-authorization.json','delivery-authorization.signature.bundle.json']) writeFileSync(join(root,name),'not JSON');
  const dest=join(root,'admitted');
  const call=`\nadmit_delivery_authorization ${q(root)} ${q(dest)}\nprintf parsed`;
  for(const reject of [true,false]) {
   const result=spawnSync('bash',['-c',prelude+`cosign() { printf '%s\\n' "$*" >&2; return ${reject?1:0}; }\n`+fn+call],{encoding:'utf8'});
   assert.equal(result.status,reject?9:0,result.stderr);
   assert.match(result.stderr,/oci-promote.yml@refs\/heads\/main/);
   assert.match(result.stderr,/https:\/\/token.actions.githubusercontent.com/);
   assert.equal(result.stdout.includes('parsed'),!reject);
  }
 } finally {rmSync(root,{recursive:true,force:true});}
});
test('workflow protects hosted signer only and binds every Mona artifact call to delivery run/attempt',()=>{
 const workflow=readFileSync('.github/workflows/oci-promote.yml','utf8');
 const authorize=workflow.slice(workflow.indexOf('\n  authorize:'),workflow.indexOf('\n  promote:'));
 const promote=workflow.slice(workflow.indexOf('\n  promote:'));
 assert.match(authorize,/runs-on: ubuntu-24.04/);assert.match(authorize,/environment: \$\{\{ inputs.target \}\}/);assert.match(authorize,/id-token: write/);
 assert.match(authorize,/npm ci --ignore-scripts/);assert.match(authorize,/node scripts\/ci\/authorize-delivery.mjs/);assert.match(authorize,/cosign sign-blob --yes --bundle candidate\/delivery-authorization.signature.bundle.json candidate\/delivery-authorization.json/);
 assert.match(promote,/needs: \[resolve, authorize\]/);assert.doesNotMatch(promote,/id-token|environment:/);
 assert.match(workflow,/options: \[promote, rollback\]/);assert.match(workflow,/base_candidate_run_id:/);
 assert.match(authorize,/promotion-base-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
 assert.match(promote,/authorized-promotion-\$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
 for(const call of promote.matchAll(/sudo \/usr\/local\/sbin\/hb-deploy artifact-[^\n]+/g)) assert.match(call[0],/artifact-[a-z-]+ "\$DELIVERY_RUN_ID" "\$DELIVERY_RUN_ATTEMPT"/);
 for(const action of workflow.matchAll(/uses: \S+@(\S+)/g)) assert.match(action[1],/^[a-f0-9]{40}$/);
 // YAML run bodies end at the next peer key/step; no expression is executable shell.
 for(const body of workflow.matchAll(/\n        run: ([\s\S]*?)(?=\n      -|\n  [a-z]|$)/g)) assert.doesNotMatch(body[1],/\$\{\{/);
});
test('delivery bytes and digest persist before effects; every root dispatch checks authorization',()=>{
 const source=readFileSync('deploy/hb-deploy-root','utf8');
 const prepare=source.slice(source.indexOf('artifact_prepare() {'),source.indexOf('\nartifact_preflight()'));
 assert.ok(prepare.indexOf('admit_delivery_authorization')<prepare.indexOf('validate-delivery'));
 assert.ok(prepare.indexOf('validate-delivery')<prepare.indexOf('"$ARTIFACT_VERIFY"'));
 assert.ok(prepare.indexOf('sync -f "$temp/receipt.json"')<prepare.indexOf('docker login'));
 assert.ok(prepare.indexOf('--verb prepare')<prepare.indexOf('docker login'));
 assert.ok(prepare.indexOf('delivery authorization already consumed')<prepare.indexOf('docker login'));
 for(const verb of ['preflight','migrate','replace','status','rollback']) {
  const line=source.split('\n').find(line=>line.startsWith(`  artifact-${verb})`));
  assert.ok(line.indexOf('require_delivery_invocation')<line.indexOf(`artifact_${verb} "$@"`));
 }
});

import { createRequire } from 'node:module';
const { parse: parseYaml } = createRequire(import.meta.url)('yaml');
test('hosted rehearsal is protected and job dependency truth table preserves shadow and rollback', () => {
 const {jobs}=parseYaml(readFileSync('.github/workflows/oci-promote.yml','utf8'));
 assert.equal(jobs.rehearse['runs-on'],'ubuntu-24.04');assert.equal(jobs.rehearse.environment,'shadow');
 assert.deepEqual(jobs.rehearse.permissions,{contents:'read',actions:'read',packages:'read','id-token':'write'});
 assert.deepEqual(jobs.authorize.needs,['resolve','rehearse']);
 assert.deepEqual(jobs.promote.needs,['resolve','authorize']);
 const evaluate=(expression,inputs,needs,vars)=>Function('inputs','needs','vars','always','cancelled',`return (${expression});`)(inputs,needs,vars,()=>true,()=>false);
 for(const [target,operation] of [['production','promote'],['shadow','promote'],['production','rollback']]) {
  const inputs={target,operation};const vars={HB_RELEASE_LANE_STATE:target==='shadow'?'legacy-shadow':'oci-production'};
  const required=target==='production'&&operation==='promote';
  assert.equal(evaluate(jobs.rehearse.if,inputs,{},vars),required);
  for(const result of ['success','skipped','failure','cancelled']) {
   const needs={resolve:{result:'success'},rehearse:{result},authorize:{result:'success'}};
   assert.equal(evaluate(jobs.authorize.if,inputs,needs,vars),required?result==='success':result==='skipped');
  }
  for(const result of ['success','skipped','failure','cancelled']) {
   assert.equal(evaluate(jobs.promote.if,inputs,{resolve:{result:'success'},authorize:{result}},vars),result==='success');
  }
 }
 for(const job of Object.values(jobs)) for(const step of job.steps) {
  if(step.run) assert.doesNotMatch(step.run,/\$\{\{/);
  if(step.uses) assert.match(step.uses,/@[a-f0-9]{40}$/);
 }
 for(const job of [jobs.rehearse,jobs.authorize]) assert.equal(job.steps.find(s=>s.uses?.startsWith('sigstore/cosign-installer')).with['cosign-release'],'v2.4.3');
 const download=jobs.authorize.steps.find(s=>s.with?.path==='candidate/transition');
 assert.equal(download.with.name,'transition-${{ github.run_id }}-${{ github.run_attempt }}');
 assert.equal(download.if,"inputs.operation == 'promote' && inputs.target == 'production'");
 assert.equal(jobs.promote.steps.find(s=>s.uses?.startsWith('actions/download-artifact')).with.name,'authorized-promotion-${{ github.run_id }}-${{ github.run_attempt }}');
});
test('transition authentication and delivery digest validation precede registry verifier and effect admission',()=>{
 const source=readFileSync('deploy/hb-deploy-root','utf8');
 const prepare=source.slice(source.indexOf('artifact_prepare() {'),source.indexOf('\nartifact_preflight()'));
 const admit=prepare.indexOf('admit_transition_evidence');const verify=prepare.indexOf('require_oci_transition_evidence');const delivery=prepare.indexOf('validate-delivery');
 assert.ok(admit>0 && admit<verify && verify<delivery && delivery<prepare.indexOf('"$ARTIFACT_VERIFY"'));
 assert.ok(prepare.indexOf('sync -f "$temp/receipt.json"')<prepare.indexOf('docker login'));
 const fn=source.slice(source.indexOf('require_oci_transition_evidence() {'),source.indexOf('\natomic_install_release_state()'));
 assert.ok(fn.indexOf('for stage in authorization shadow rollback forward-repair')<fn.indexOf('validate-transition'));
 assert.ok(fn.indexOf('cosign verify-blob')<fn.indexOf('validate-transition'));
 assert.doesNotMatch(source,/require_transition_producer|readonly TRANSITION_EVIDENCE|production preparation disabled/);
});
