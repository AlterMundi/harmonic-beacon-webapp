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
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const bytes = value => Buffer.from(JSON.stringify(value));
const hash = trusted.publicConfigSha256;
const d = `sha256:${'a'.repeat(64)}`;
function fixture() {
  const manifest = validManifest();
  const qualification = {
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
  const authorization = { schemaVersion: 'harmonic-beacon.oci-transition.v3', laneState: 'oci-production', ...binding, authorizedAt: at, expiresAt: '2026-09-10T19:00:00.000Z', stages: {} };
  const stages = {};
  for (const stage of ['shadow', 'rollback', 'forward-repair']) {
    const runtime = manifestSha256 => ({ manifestSha256, configSha256: manifest.configProfiles[stage === 'shadow' ? 'live-staging' : 'production'].sha256, healthSha256: d, privateBoundarySha256: d });
    const execution = { schemaVersion: `harmonic-beacon.${stage}-execution.v3`, stage, ...binding, startedAt: at, completedAt: at, commands: [{ name: 'measure-runtime', argvSha256: d, startedAt: at, completedAt: at, exitCode: 0, stdoutSha256: d, stderrSha256: d }], runtimeBefore: runtime(stage === 'forward-repair' ? binding.baseManifestSha256 : binding.candidateManifestSha256), runtimeAfter: runtime(stage === 'rollback' ? binding.baseManifestSha256 : binding.candidateManifestSha256), ...(stage === 'shadow' ? {} : { observedRecoveryMs: 0, maxRecoveryMs: 1000 }) };
    const executionBytes = bytes(execution);
    const receiptBytes = bytes({ schemaVersion: `harmonic-beacon.${stage}-receipt.v3`, stage, ...binding, executionEvidenceSha256: hash(executionBytes), issuedAt: at });
    stages[stage] = { executionBytes, receiptBytes };
    authorization.stages[stage] = { receiptSha256: hash(receiptBytes), executionEvidenceSha256: hash(executionBytes) };
  }
  return { manifest, manifestBytes, qualificationBytes: bytes(qualification), authorizationBytes: bytes(authorization), stages, now: Date.parse(at) };
}
test('full qualification and closed v3 measured transition evidence pass', () => {
  const f = fixture();
  trusted.validateQualificationReceipt(JSON.parse(f.qualificationBytes), f.manifest);
  trusted.validateTransitionEvidence(f);
});
test('old incomplete receipt, null schema and negative heartbeat reject at producer and root semantics', () => {
  const f = fixture();
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
  for (const mutate of [q => q.workflowRunAttempt++, q => q.workflowRunId = '2', q => q.candidateIdentitySha256 = 'b'.repeat(64), q => q.imageRefs.app = 'wrong', q => q.checkedServices.pop(), q => q.extra = true]) {
    const q = JSON.parse(f.qualificationBytes); mutate(q);
    assert.throws(() => trusted.validateQualificationReceipt(q, f.manifest));
  }
});
test('transition rejects static receipts, digest tampering, wrong stages, nested extras and expired authorization', () => {
  for (const mutate of [e => e.exactStateVerified = true, e => e.runtimeAfter.manifestSha256 = 'f'.repeat(64), e => e.commands[0].exitCode = 1, e => e.commands = [], e => e.commands[0].extra = true, e => e.runtimeBefore.extra = true, e => e.observedRecoveryMs = -1, e => e.workflowRunAttempt++]) {
    const f = fixture(); const stage = f.stages.rollback; const e = JSON.parse(stage.executionBytes); mutate(e); stage.executionBytes = bytes(e);
    const r = JSON.parse(stage.receiptBytes); r.executionEvidenceSha256 = hash(stage.executionBytes); stage.receiptBytes = bytes(r);
    const a = JSON.parse(f.authorizationBytes); a.stages.rollback = { executionEvidenceSha256: hash(stage.executionBytes), receiptSha256: hash(stage.receiptBytes) }; f.authorizationBytes = bytes(a);
    assert.throws(() => trusted.validateTransitionEvidence(f));
  }
  const f = fixture(); f.now += 3600000; assert.throws(() => trusted.validateTransitionEvidence(f));
  const g = fixture(); g.stages.shadow.receiptBytes = bytes({ exactStateVerified: true }); assert.throws(() => trusted.validateTransitionEvidence(g));
});
test('root authenticates all three receipts before trusted validation and rejects unsigned evidence', () => {
  const helper = readFileSync(new URL('../../../deploy/hb-deploy-root', import.meta.url), 'utf8');
  const fn = helper.slice(helper.indexOf('require_oci_transition_evidence() {'), helper.indexOf('\natomic_install_release_state()'));
  const prelude = `set -e\nTRANSITION_EVIDENCE=/root/evidence\nRELEASE_MANIFEST=/trusted/release-manifest.mjs\nrequire_secure_root_file() { :; }\ndie() { exit 9; }\n`;
  const success = spawnSync('bash', ['-c', prelude + `cosign() { printf '%s\\n' "$*"; }\nnode() { printf '%s\\n' "$*"; }\n` + fn.replace('>/dev/null', '') + '\nrequire_oci_transition_evidence /root/manifest.json'], { encoding: 'utf8' });
  assert.equal(success.status, 0, success.stderr);
  assert.equal((success.stdout.match(/verify-blob/g) ?? []).length, 3);
  assert.equal((success.stdout.match(/https:\/\/token.actions.githubusercontent.com/g) ?? []).length, 3);
  assert.equal((success.stdout.match(/oci-promote.yml@refs\/heads\/main/g) ?? []).length, 3);
  assert.match(success.stdout, /\/trusted\/release-manifest.mjs validate-transition --manifest/);
  const unsigned = spawnSync('bash', ['-c', prelude + 'cosign() { return 1; }\nnode() { echo UNSAFE; }\n' + fn + '\nrequire_oci_transition_evidence /root/manifest.json'], { encoding: 'utf8' });
  assert.equal(unsigned.status, 9); assert.doesNotMatch(unsigned.stdout, /UNSAFE/);
});
