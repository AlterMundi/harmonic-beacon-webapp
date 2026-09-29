import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const workflow=readFileSync(new URL('../../../.github/workflows/analytics-delivery.yml',import.meta.url),'utf8');
const checks=workflow.split('\n').filter(line=>line.includes("throw new Error('foreign build workflow')") || line.includes("throw new Error('build attempt mismatch')")).map(line=>line.trim()).join('\n');
const env={SOURCE_SHA:'a'.repeat(40),BUILD_RUN_ID:'123',BUILD_RUN_ATTEMPT:'1'};
const build={name:'Analytics OCI Build',path:'.github/workflows/analytics-build.yml',event:'workflow_run',head_branch:'main',head_sha:'b'.repeat(40),id:123,run_attempt:1,conclusion:'success'};
test('accepts actual workflow_run metadata without confusing workflow SHA with artifact source',()=>{
 assert.ok(checks.length);assert.doesNotThrow(()=>vm.runInNewContext(checks,{build,env}));
 for(const change of [{head_branch:'untrusted'},{event:'push'},{path:'other.yml'},{id:124},{run_attempt:2},{conclusion:'failure'},{head_sha:'invalid'}]) assert.throws(()=>vm.runInNewContext(checks,{build:{...build,...change},env}));
 assert.match(workflow,/p\.sourceSha === e\.SOURCE_SHA/);
 assert.match(workflow,/p\.ci\?\.runId === e\.CI_RUN_ID/);
 assert.match(workflow,/cosign verify-blob/);
 assert.match(workflow,/gh attestation verify/);
});
test('binds signed artifact provenance to exact source, digest and CI/build attempts',()=>{
 const code=workflow.slice(workflow.indexOf('          const exact = p.schemaVersion'),workflow.indexOf("          gh attestation verify")).replace(/          NODE\s*$/,'');
 const e={...env,IMAGE_DIGEST:`sha256:${'c'.repeat(64)}`,CI_RUN_ID:'456',CI_RUN_ATTEMPT:'2'};
 const valid={schemaVersion:'hb.analytics.build-provenance.v1',sourceSha:e.SOURCE_SHA,subject:{repository:'ghcr.io/altermundi/harmonic-beacon-analytics',digest:e.IMAGE_DIGEST},ci:{workflow:'CI',runId:'456',runAttempt:2},build:{workflow:'Analytics OCI Build',workflowPath:'.github/workflows/analytics-build.yml',runId:'123',runAttempt:1}};
 assert.doesNotThrow(()=>vm.runInNewContext(code,{p:valid,e}));
 for(const change of [{sourceSha:'d'.repeat(40)},{subject:{...valid.subject,digest:`sha256:${'e'.repeat(64)}`}},{ci:{...valid.ci,runId:'457'}},{ci:{...valid.ci,runAttempt:1}},{build:{...valid.build,runId:'124'}},{build:{...valid.build,runAttempt:2}}]) assert.throws(()=>vm.runInNewContext(code,{p:{...valid,...change},e}));
});
