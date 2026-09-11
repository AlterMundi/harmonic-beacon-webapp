import assert from 'node:assert/strict';
import test from 'node:test';
import * as trusted from '../release-manifest.mjs';
import { validateQualificationEvidence as producer } from '../qualify-oci.mjs';

test('B2 producer rejects unknown nested acceptance fields', () => {
  const evidence = { browser: { engine: 'chromium', passed: 1, failed: 0, skipped: 0, forged: true }, syntheticSession: { created: 1, authenticatedRole: 'ADMIN' }, commerce: { workerHeartbeatAgeMs: 0, pending: 0, processing: 0 }, schema: { expectedHead: '20260909120000_example', observedHead: '20260909120000_example' }, isolation: { internalNetworks: ['database', 'media'], forbiddenSecretNamesFound: [] }, restore: { backupSha256: `sha256:${'a'.repeat(64)}`, backupBytes: 1, restoredSessionCount: 1 } };
  assert.throws(() => producer(evidence));
});
test('B2 root and producer share trusted acceptance semantics', () => {
  assert.equal(producer, trusted.validateQualificationEvidence);
  assert.equal(typeof trusted.validateQualificationReceipt, 'function');
});

import { validManifest } from './b2-fixture.mjs';
import { validTransitionFixture, resealStage } from './b2-transition-fixture.mjs';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const bytes = value => Buffer.from(trusted.canonicalize(value));
const hash = trusted.publicConfigSha256;
const d = `sha256:${'a'.repeat(64)}`;
function operationFreeFixture() {
  const manifest = validManifest();
  const qualification = {
    qualificationJob: 'qualify', measurementStartedAt: '2026-09-10T17:40:00.000Z', measurementCompletedAt: '2026-09-10T17:49:00.000Z', issuedAt: manifest.qualification.qualifiedAt,
    schemaVersion: 'oci-qualification.v3', result: 'success', workflowRunId: manifest.build.workflowRunId,
    workflowRunAttempt: 1, candidateIdentitySha256: trusted.candidateIdentitySha256(manifest),
    imageRefs: Object.fromEntries([...manifest.artifacts, ...manifest.externalImages].map(e => [e.artifactId ?? e.serviceId, `${e.repository}@${e.digest}`])),
    checkedServices: ['postgres', 'livekit', 'app', 'commerce-reconciler', 'tapestry', 'playlist-bot', 'analytics'],
    acceptance: { browser: { engine: 'chromium', passed: 1, failed: 0, skipped: 0 }, syntheticSession: { created: 1, authenticatedRole: 'ADMIN' }, commerce: { workerHeartbeatAgeMs: 0, pending: 0, processing: 0 }, schema: { expectedHead: manifest.migrationSet.head, observedHead: manifest.migrationSet.head }, isolation: { internalNetworks: ['database', 'media'], forbiddenSecretNamesFound: [] }, restore: { backupSha256: d, backupBytes: 1, restoredSessionCount: 1 } },
  };
  manifest.qualification.receiptSha256 = hash(bytes(qualification));
  const manifestBytes = bytes(manifest);
  const binding = { candidateManifestSha256: hash(manifestBytes).slice(7), baseManifestSha256: manifest.promotion.baseManifestSha256, qualificationReceiptSha256: manifest.qualification.receiptSha256, workflowRunId: manifest.build.workflowRunId, workflowRunAttempt: 1 };
  const at = '2026-09-10T18:00:00.000Z';
  const authorization = { schemaVersion: 'harmonic-beacon.oci-transition.v4', laneState: 'oci-production', ...binding, authorizedAt: at, expiresAt: '2026-09-10T19:00:00.000Z', stages: {} };
  const stages = {};
  for (const stage of ['shadow', 'rollback', 'forward-repair']) {
    const runtime = manifestSha256 => ({ manifestSha256, configSha256: manifest.configProfiles[stage === 'shadow' ? 'live-staging' : 'production'].sha256, commandStart: 0, commandEnd: 1, runtimeCommandTranscriptSha256: d, healthCommandTranscriptSha256: d, privateBoundaryCommandTranscriptSha256: d });
    const execution = { schemaVersion: `harmonic-beacon.${stage}-execution.v4`, stage, ...binding, startedAt: at, completedAt: at, commands: [{ operation: 'measure-runtime-inventory', executableIdentity: '/usr/bin/docker', executableSha256: d, argvSha256: d, environmentSha256: d, stdinSha256: d, startedAt: at, completedAt: at, exitCode: 0, stdoutSha256: d, stderrSha256: d }], runtimeBefore: runtime(stage === 'rollback' ? binding.candidateManifestSha256 : binding.baseManifestSha256), runtimeAfter: runtime(stage === 'rollback' ? binding.baseManifestSha256 : binding.candidateManifestSha256), ...(stage === 'shadow' ? {} : { observedRecoveryMs: 0, maxRecoveryMs: 1000 }) };
    const executionBytes = bytes(execution);
    const receiptBytes = bytes({ schemaVersion: `harmonic-beacon.${stage}-receipt.v4`, stage, ...binding, executionEvidenceSha256: hash(executionBytes), issuedAt: at });
    stages[stage] = { executionBytes, receiptBytes };
    authorization.stages[stage] = { receiptSha256: hash(receiptBytes), executionEvidenceSha256: hash(executionBytes) };
  }
  return { manifest, manifestBytes, qualificationBytes: bytes(qualification), authorizationBytes: bytes(authorization), stages, now: Date.parse(at) };
}
test('operation-free zero-duration transition self-attestation is rejected', () => {
  const f = operationFreeFixture();
  trusted.validateQualificationReceipt(JSON.parse(f.qualificationBytes), f.manifest);
  assert.throws(() => trusted.validateTransitionEvidence(f));
});
test('full qualification and closed v4 measured transition evidence pass', () => {
  const f = validTransitionFixture();
  trusted.validateQualificationReceipt(JSON.parse(f.qualificationBytes), f.manifest);
  trusted.validateTransitionEvidence(f);
});
test('old incomplete receipt, null schema and negative heartbeat reject at producer and root semantics', () => {
  const f = operationFreeFixture();
  const mutations = [
    e => { e.schema = {}; e.commerce = { workerHeartbeatAgeMs: -1 }; e.syntheticSession = { created: 1 }; e.restore = { restoredSessionCount: 1 }; e.isolation = { forbiddenSecretNamesFound: [] }; },
    e => { e.schema.expectedHead = null; e.schema.observedHead = null; },
    e => { e.commerce.workerHeartbeatAgeMs = -1; },
    e => { e.commerce.workerHeartbeatAgeMs = 10001; },
    e => { e.restore.backupBytes = Number.MAX_SAFE_INTEGER + 1; },
    e => { e.syntheticSession.authenticatedRole = null; },
    e => { e.browser.skipped = 1; },
    e => { e.commerce.pending = -1; },
    e => { e.isolation.internalNetworks = ['database']; },
    e => { e.isolation.forbiddenSecretNamesFound = ['GITHUB_TOKEN']; },
  ];
  for (const mutate of mutations) {
    const q = JSON.parse(f.qualificationBytes); mutate(q.acceptance);
    assert.throws(() => producer(q.acceptance));
    assert.throws(() => trusted.validateQualificationReceipt(q, f.manifest));
  }
  for (const key of Object.keys(JSON.parse(f.qualificationBytes).acceptance)) {
    const q = JSON.parse(f.qualificationBytes); q.acceptance[key].unknown = true;
    assert.throws(() => producer(q.acceptance));
    assert.throws(() => trusted.validateQualificationReceipt(q, f.manifest));
  }
  for (const mutate of [q => q.qualificationJob = 'build', q => q.measurementStartedAt = q.measurementCompletedAt, q => q.issuedAt = '2026-09-10T17:51:00.000Z', q => q.measurementCompletedAt = '2026-09-10T17:49:00Z', q => q.workflowRunAttempt++, q => q.workflowRunId = '2', q => q.candidateIdentitySha256 = 'b'.repeat(64), q => q.imageRefs.app = 'wrong', q => q.checkedServices.pop(), q => q.extra = true]) {
    const q = JSON.parse(f.qualificationBytes); mutate(q);
    assert.throws(() => trusted.validateQualificationReceipt(q, f.manifest));
  }
});
test('transition rejects static receipts, digest tampering, wrong stages, nested extras and expired authorization', () => {
  for (const mutate of [e => e.exactStateVerified = true, e => e.commands[0].operation = 'secret-api-key', e => e.commands[0].stdout = 'private output', e => e.startedAt = '2026-09-10T18:00:00Z', e => e.runtimeAfter.manifestSha256 = 'f'.repeat(64), e => e.commands[0].exitCode = 1, e => e.commands = [], e => e.commands[0].extra = true, e => e.runtimeBefore.extra = true, e => e.observedRecoveryMs = -1, e => e.workflowRunAttempt++]) {
    const f = validTransitionFixture(); const stage = f.stages.rollback; const e = JSON.parse(stage.executionBytes); mutate(e); stage.executionBytes = bytes(e);
    resealStage(f, 'rollback');
    assert.throws(() => trusted.validateTransitionEvidence(f));
  }
  const f = validTransitionFixture(); f.now += 3600000; assert.throws(() => trusted.validateTransitionEvidence(f));
  const g = validTransitionFixture(); g.stages.shadow.receiptBytes = bytes({ exactStateVerified: true }); assert.throws(() => trusted.validateTransitionEvidence(g));
});

test('transition command and measurement contract rejects missing, extra, null, wrong order, reuse, zero duration, and wrong executable', () => {
  const mutations = [
    e => { delete e.commands[0].environmentSha256; },
    e => { e.commands[0].rawArgv = ['private']; },
    e => { e.commands[0].stdinSha256 = null; },
    e => { e.commands[0].exitCode = -1; },
    e => { [e.commands[0], e.commands[1]] = [e.commands[1], e.commands[0]]; },
    e => { e.runtimeAfter = structuredClone(e.runtimeBefore); },
    e => { e.completedAt = e.startedAt; },
    e => { e.commands[0].completedAt = e.commands[0].startedAt; },
    e => { e.commands[0].executableIdentity = '/usr/bin/curl'; },
    e => { e.commands[0].executableSha256 = null; },
    e => { e.observedRecoveryMs = 0; },
  ];
  for (const mutate of mutations) {
    const f = validTransitionFixture();
    const execution = JSON.parse(f.stages.rollback.executionBytes);
    mutate(execution);
    f.stages.rollback.executionBytes = bytes(execution);
    resealStage(f, 'rollback');
    assert.throws(() => trusted.validateTransitionEvidence(f));
  }
});
test('transition rejects copied static runtime outputs despite fresh timestamps and argv digests', () => {
  const f = validTransitionFixture();
  const stage = 'rollback';
  const execution = JSON.parse(f.stages[stage].executionBytes);
  const contract = trusted.transitionStageContract(stage);
  const before = execution.commands.slice(...contract.before);
  const after = execution.commands.slice(...contract.after);
  for (let index = 0; index < after.length; index += 1) {
    after[index].stdoutSha256 = before[index].stdoutSha256;
    after[index].stderrSha256 = before[index].stderrSha256;
  }
  execution.commands.splice(contract.after[0], after.length, ...after);
  const transcript = execution.commands.slice(...contract.after);
  const health = transcript.filter(command => command.operation.startsWith('measure-runtime-endpoint-'));
  const privateBoundary = transcript.filter(command => command.operation.startsWith('measure-runtime-container-') || command.operation.startsWith('measure-private-network-'));
  execution.runtimeAfter.runtimeCommandTranscriptSha256 = trusted.transitionCommandTranscriptSha256(transcript);
  execution.runtimeAfter.healthCommandTranscriptSha256 = trusted.transitionOutputTranscriptSha256(health);
  execution.runtimeAfter.privateBoundaryCommandTranscriptSha256 = trusted.transitionOutputTranscriptSha256(privateBoundary);
  f.stages[stage].executionBytes = bytes(execution);
  resealStage(f, stage);
  assert.throws(() => trusted.validateTransitionEvidence(f), /reused before\/after runtime measurement|reused runtime measurement/);
});

test('root authenticates aggregate and all three receipts before trusted validation and rejects unsigned evidence', () => {
  const helper = readFileSync(new URL('../../../deploy/hb-deploy-root', import.meta.url), 'utf8');
  const fn = helper.slice(helper.indexOf('require_oci_transition_evidence() {'), helper.indexOf('\natomic_install_release_state()'));
  const prelude = `set -e\nTRANSITION_EVIDENCE=/root/evidence\nRELEASE_MANIFEST=/trusted/release-manifest.mjs\nrequire_secure_root_file() { :; }\ndie() { exit 9; }\n`;
  const success = spawnSync('bash', ['-c', prelude + `cosign() { printf '%s\\n' "$*"; }\nnode() { printf '%s\\n' "$*"; }\n` + fn.replace('>/dev/null', '') + '\nrequire_oci_transition_evidence /root/manifest.json /root/evidence'], { encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr);
  assert.equal((success.stdout.match(/verify-blob/g) ?? []).length, 4);
  assert.equal((success.stdout.match(/https:\/\/token.actions.githubusercontent.com/g) ?? []).length, 4);
  assert.equal((success.stdout.match(/oci-promote.yml@refs\/heads\/main/g) ?? []).length, 4);
  assert.match(success.stdout, /\/trusted\/release-manifest.mjs validate-transition --manifest/);
  const unsigned = spawnSync('bash', ['-c', prelude + 'cosign() { return 1; }\nnode() { echo UNSAFE; }\n' + fn + '\nrequire_oci_transition_evidence /root/manifest.json /root/evidence'], { encoding: 'utf8' });
  assert.equal(unsigned.status, 9); assert.doesNotMatch(unsigned.stdout, /UNSAFE/);
});
