import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const contractRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(contractRoot, '../../..');
const helper = path.join(contractRoot, 'listener-delivery-root');
const bundleRoot = path.join(contractRoot, 'libexec');
const manifestPath = path.join(contractRoot, 'bundle.manifest.json');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('blocker 1: root helper executes only an externally installed immutable lifecycle bundle', async () => {
  const source = await fsp.readFile(helper, 'utf8');
  assert.match(source, /bundle_root=\/usr\/local\/libexec\/hb-listener-delivery\/v1/);
  assert.match(source, /expected_bundle_manifest_sha256=[0-9a-f]{64}/);
  assert.doesNotMatch(source, /\/srv\/harmonic-beacon|\bgit -C|\bdocker compose|docker-compose|scripts\/|ops\/early-birds/i);
  assert.match(source, /test "\$\(stat -c '%U:%G:%a:%h' "\$bundle_file"\)" = root:root:500:1/);
  assert.match(source, /for ancestor in \/usr \/usr\/local \/usr\/local\/libexec \/usr\/local\/libexec\/hb-listener-delivery/);

  const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  assert.deepEqual(Object.keys(manifest).sort(), ['files', 'schema_version']);
  assert.equal(manifest.schema_version, 'listen-delivery-bundle.v1');
  assert.ok(Object.keys(manifest.files).length >= 3);
  for (const [relative, digest] of Object.entries(manifest.files)) {
    assert.match(relative, /^[a-z0-9][a-z0-9.-]*\.(?:mjs|json)$/);
    assert.match(digest, /^[0-9a-f]{64}$/);
    const absolute = path.join(bundleRoot, relative);
    assert.equal(sha256(await fsp.readFile(absolute)), digest, relative);
    assert.equal(fs.lstatSync(absolute).isFile(), true);
  }
  const expected = source.match(/expected_bundle_manifest_sha256=([0-9a-f]{64})/)[1];
  assert.equal(sha256(await fsp.readFile(manifestPath)), expected);

  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-root-script-exploit-'));
  try {
    const marker = path.join(fixture, 'root-script-ran');
    await fsp.writeFile(path.join(fixture, 'candidate.sh'), `#!/bin/sh\nprintf exploited > ${JSON.stringify(marker)}\n`, { mode: 0o755 });
    assert.equal(fs.existsSync(marker), false);
    assert.doesNotMatch(source, /candidate\.sh|\$repository/);
  } finally {
    await fsp.rm(fixture, { recursive: true, force: true });
  }
});

test('blocker 1: repository contains no installer or activation fallback for the privileged bundle', async () => {
  const names = await fsp.readdir(contractRoot);
  assert.equal(names.some((name) => /install|provision|activate/i.test(name)), false);
  const workflow = await fsp.readFile(path.join(repositoryRoot, '.github/workflows/listener-delivery.yml'), 'utf8');
  assert.doesNotMatch(workflow, /\b(?:cp|install|rsync|chmod|chown)\b.*(?:hb-listener-delivery|libexec)/);
  assert.doesNotMatch(workflow, /cmp .*ops\/listener-delivery/);
  assert.match(workflow, /LISTENER_DELIVERY_BUNDLE_MANIFEST_SHA256/);
});

test('blocker 2: privileged path has no Git execution and ignores fsmonitor configuration', async () => {
  const gate = path.join(bundleRoot, 'github-gate.mjs');
  const sources = await Promise.all([
    fsp.readFile(helper, 'utf8'),
    fsp.readFile(path.join(bundleRoot, 'lifecycle.mjs'), 'utf8'),
    fsp.readFile(gate, 'utf8'),
  ]);
  assert.doesNotMatch(sources.join('\n'), /execFile(?:Sync)?\(['"]git|spawn(?:Sync)?\(['"]git|\bgit\s+-C\b/);
  assert.match(sources[2], /api\.github\.com\/repos\/AlterMundi\/harmonic-beacon-webapp/);

  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-fsmonitor-exploit-'));
  try {
    const marker = path.join(fixture, 'fsmonitor-ran');
    const monitor = path.join(fixture, 'monitor.sh');
    await fsp.writeFile(monitor, `#!/bin/sh\nprintf exploited > ${JSON.stringify(marker)}\n`, { mode: 0o755 });
    await fsp.writeFile(path.join(fixture, 'synthetic-listener-preview.fixture.v1'), 'synthetic\n');
    const result = spawnSync(helper, ['probe', 'staging', 'a'.repeat(40), '1', '1', '1', '1', 'deliver'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        LISTENER_DELIVERY_SYNTHETIC_FIXTURE_ROOT: fixture,
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: 'core.fsmonitor',
        GIT_CONFIG_VALUE_0: monitor,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(marker), false);
  } finally {
    await fsp.rm(fixture, { recursive: true, force: true });
  }
});

test('blocker 3: durable transaction CAS rejects conflicts and preserves immutable replay results', async () => {
  const tx = await import(`${path.join(bundleRoot, 'transaction.mjs')}?b3=${Date.now()}`);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-transaction-'));
  try {
    const binding = {
      target: 'staging', operation: 'deploy', source_sha: 'a'.repeat(40),
      delivery_run_id: '101', delivery_run_attempt: '2', ci_run_id: '99', ci_run_attempt: '3',
      configuration_sha256: 'b'.repeat(64),
    };
    const admitted = tx.beginOrResume(root, binding);
    assert.equal(admitted.kind, 'journal');
    assert.equal(admitted.value.phase, 'admitted');
    const activeFile = path.join(root, 'active-staging.json');
    const immutableActive = await fsp.readFile(activeFile, 'utf8');
    const mutated = tx.advancePhase(root, admitted.value, 'admitted', 'mutated', { effect_id: 'deploy-101-2' });
    assert.equal(await fsp.readFile(activeFile, 'utf8'), immutableActive);
    assert.deepEqual(await fsp.readdir(path.join(root, 'journals', mutated.transaction_id)), ['0.json', '1.json']);
    const receipt = { schema_version: 'fixture-receipt.v1', transaction_id: mutated.transaction_id, outcome: 'succeeded' };
    const committed = tx.commitReceipt(root, mutated, receipt);
    assert.deepEqual(committed, receipt);
    assert.deepEqual(await fsp.readdir(path.join(root, 'journals', mutated.transaction_id)), ['0.json', '1.json', '2.json']);

    const replay = tx.beginOrResume(root, binding);
    assert.equal(replay.kind, 'receipt');
    assert.deepEqual(replay.value, receipt);
    assert.throws(() => tx.commitReceipt(root, mutated, { ...receipt, outcome: 'failed' }), /receipt CAS conflict/);

    const conflicting = { ...binding, source_sha: 'c'.repeat(40) };
    assert.throws(() => tx.beginOrResume(root, conflicting), /transaction identity conflict/);

    const next = { ...binding, delivery_run_id: '102', source_sha: 'd'.repeat(40) };
    assert.equal(tx.beginOrResume(root, next).kind, 'journal');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('blocker 3: exact rollback retry returns one receipt without repeating its effect', async () => {
  const tx = await import(`${path.join(bundleRoot, 'transaction.mjs')}?b3rollback=${Date.now()}`);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-rollback-replay-'));
  try {
    const binding = {
      target: 'staging', operation: 'rollback', source_sha: 'a'.repeat(40),
      delivery_run_id: '201', delivery_run_attempt: '1', ci_run_id: '199', ci_run_attempt: '1',
      configuration_sha256: 'e'.repeat(64),
    };
    let effects = 0;
    const first = tx.runFixtureTransaction(root, binding, () => { effects += 1; return { restored: true }; });
    const second = tx.runFixtureTransaction(root, binding, () => { effects += 1; return { restored: false }; });
    assert.equal(effects, 1);
    assert.deepEqual(second, first);
    const receiptFiles = (await fsp.readdir(path.join(root, 'receipts'))).filter((name) => name.endsWith('.json'));
    assert.equal(receiptFiles.length, 1);
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('blocker 4: staging lost return resumes from the original preview and restores withdrawal state', async () => {
  const lifecycle = await import(`${path.join(bundleRoot, 'lifecycle.mjs')}?b4=${Date.now()}`);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-staging-lost-return-'));
  try {
    const original = {
      listener: { running: true, image: `harmonic-beacon/earlybirds-preview-listener:${'e'.repeat(40)}`, mode: 'account-off' },
      environment_sha256: '1'.repeat(64),
      withdrawal: { running: true, image: 'harmonic-beacon/earlybirds-preview-withdrawal:stable' },
    };
    await fsp.writeFile(path.join(root, 'resources.json'), `${JSON.stringify(original)}\n`);
    const binding = {
      target: 'staging', operation: 'deploy', source_sha: 'a'.repeat(40),
      delivery_run_id: '301', delivery_run_attempt: '1', ci_run_id: '299', ci_run_attempt: '4',
      configuration_sha256: '2'.repeat(64),
    };
    assert.throws(() => lifecycle.runStagingFixture(root, binding, { fault: 'lost_return_after_mutation', checkpoint_mode: 'interrupt' }), /injected lost return/);
    const candidate = JSON.parse(await fsp.readFile(path.join(root, 'resources.json'), 'utf8'));
    assert.equal(candidate.listener.image.endsWith('a'.repeat(40)), true);
    assert.equal(candidate.withdrawal.running, false);

    const receipt = lifecycle.runStagingFixture(root, binding, { checkpoint_mode: 'interrupt' });
    assert.deepEqual(JSON.parse(await fsp.readFile(path.join(root, 'resources.json'), 'utf8')), original);
    assert.deepEqual(receipt.runtime.previous, original);
    assert.deepEqual(receipt.runtime.current, original);
    assert.deepEqual(receipt.cleanup, { result: 'proved', candidate_removed: true, withdrawal_restored: true });
    assert.equal(receipt.rollback.result, 'succeeded');
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
});

test('blocker 5: receipt runtime rejects impossible dates and contradictory semantic states', async () => {
  const receipts = await import(`${path.join(bundleRoot, 'receipt.mjs')}?b5=${Date.now()}`);
  const base = {
    schema_version: 'listen-delivery-receipt.v1', service: 'listen', target: 'staging',
    operation: 'deploy', outcome: 'succeeded', observed_at: '2026-09-10T21:00:00Z',
    source: { sha: 'a'.repeat(40) },
    artifact: { image: `harmonic-beacon/earlybirds-preview-listener:${'a'.repeat(40)}`, image_id: `sha256:${'d'.repeat(64)}`, digest: null, digest_status: 'unavailable_local_build' },
    configuration: { requested_sha256: 'c'.repeat(64), current_sha256: 'c'.repeat(64) },
    runtime: { previous: { image: null, mode: 'stopped' }, current: { image: `harmonic-beacon/earlybirds-preview-listener:${'a'.repeat(40)}`, mode: 'account-off' } },
    probes: { health: 'passed', readiness: 'passed' },
    authority: { membership_contract_sha256: 'b'.repeat(64), proof_sha256: 'e'.repeat(64), status: 'matched' },
    alert_recipient: { status: 'verified', proof_sha256: 'f'.repeat(64) },
    github: { repository: 'AlterMundi/harmonic-beacon-webapp', lane: 'early-birds', workflow: '.github/workflows/listener-delivery.yml', run_id: '10', run_attempt: 1, ci_workflow: '.github/workflows/early-birds-fast-forward.yml', ci_run_id: '9', ci_run_attempt: 2 },
    rollback: { result: 'not_requested', restored_image: null, restored_mode: null },
    recovery: { evidence_status: 'captured', cleanup_status: 'not_applicable' },
  };
  assert.doesNotThrow(() => receipts.validateReceipt(base, 'b'.repeat(64)));
  for (const mutate of [
    (value) => { value.observed_at = '2026-02-30T21:00:00Z'; },
    (value) => { value.runtime.current.image = `harmonic-beacon/earlybirds-preview-listener:${'e'.repeat(40)}`; },
    (value) => { value.configuration.current_sha256 = '0'.repeat(64); },
    (value) => { value.artifact.digest_status = 'available'; },
    (value) => { value.probes.health = 'failed'; },
    (value) => { value.rollback = { result: 'succeeded', restored_image: null, restored_mode: 'stopped' }; },
    (value) => {
      value.outcome = 'failed'; value.probes.health = 'failed';
      value.rollback = { result: 'failed', restored_image: null, restored_mode: null };
      value.recovery = { evidence_status: 'used', cleanup_status: 'proved' };
    },
    (value) => { value.outcome = 'interrupted'; value.probes.health = 'failed'; },
    (value) => { value.operation = 'rollback'; },
    (value) => {
      value.outcome = 'failed'; value.probes.health = 'failed';
      value.rollback = { result: 'failed', restored_image: null, restored_mode: null };
      value.recovery = { evidence_status: 'used', cleanup_status: 'not_applicable' };
    },
  ]) {
    const value = structuredClone(base);
    mutate(value);
    assert.throws(() => receipts.validateReceipt(value, 'b'.repeat(64)));
  }
});

test('blocker 5: receipt writer records measured probes rather than fabricating pass', async () => {
  const receipts = await import(`${path.join(bundleRoot, 'receipt.mjs')}?b5writer=${Date.now()}`);
  const draft = { outcome: 'failed', probes: undefined };
  const measured = receipts.withMeasuredProbes(draft, () => ({ health: 'failed', readiness: 'not_observed' }));
  assert.deepEqual(measured.probes, { health: 'failed', readiness: 'not_observed' });
  assert.equal(draft.probes, undefined);
  const schema = JSON.parse(await fsp.readFile(path.join(contractRoot, 'receipt.schema.json'), 'utf8'));
  assert.ok(Array.isArray(schema.allOf) && schema.allOf.length >= 4);
});

test('blocker 6: Authority and recipient proofs are strict, fresh, purpose-bound, and content-address retained evidence', async () => {
  const proofs = await import(`${path.join(bundleRoot, 'proof.mjs')}?b6=${Date.now()}`);
  const evidence = Buffer.from('retained private evidence\n');
  const evidenceDigest = sha256(evidence);
  const authority = {
    schema_version: 'listen-authority-proof.v1', purpose: 'listen-delivery-authority',
    issued_at: '2026-09-10T20:00:00Z', expires_at: '2026-09-10T22:00:00Z', status: 'matched',
    membership_contract_sha256: 'b'.repeat(64), evidence_sha256: evidenceDigest,
  };
  const recipient = {
    schema_version: 'listen-recipient-proof.v1', purpose: 'listen-delivery-alert-recipient',
    issued_at: '2026-09-10T20:00:00Z', expires_at: '2026-09-10T22:00:00Z', status: 'verified',
    evidence_sha256: evidenceDigest,
  };
  const options = { now: '2026-09-10T21:00:00Z', max_age_seconds: 7200, expected_membership_sha256: 'b'.repeat(64) };
  const accepted = proofs.validateProof(Buffer.from(`${JSON.stringify(authority)}\n`), evidence, { ...options, kind: 'authority' });
  assert.match(accepted.proof_sha256, /^[0-9a-f]{64}$/);
  assert.equal(accepted.evidence_sha256, evidenceDigest);
  assert.doesNotThrow(() => proofs.validateProof(Buffer.from(`${JSON.stringify(recipient)}\n`), evidence, { ...options, kind: 'recipient' }));

  for (const [proof, retained, overrides] of [
    [authority, Buffer.from('changed evidence\n'), { kind: 'authority' }],
    [{ ...authority, purpose: 'some-other-purpose' }, evidence, { kind: 'authority' }],
    [{ ...authority, issued_at: '2026-09-09T20:00:00Z', expires_at: '2026-09-11T22:00:00Z' }, evidence, { kind: 'authority' }],
    [{ ...authority, issued_at: '2026-02-30T20:00:00Z' }, evidence, { kind: 'authority' }],
    [{ ...recipient, expires_at: '2026-09-10T20:59:59Z' }, evidence, { kind: 'recipient' }],
  ]) {
    assert.throws(() => proofs.validateProof(Buffer.from(`${JSON.stringify(proof)}\n`), retained, { ...options, ...overrides }));
  }
  const duplicate = Buffer.from(`${JSON.stringify(authority).replace('{', `{"purpose":"listen-delivery-authority",`)}\n`);
  assert.throws(() => proofs.validateProof(duplicate, evidence, { ...options, kind: 'authority' }), /duplicate/);
});

test('blocker 7: external Actions are immutable and delivery paths trigger the exact CI lane', async () => {
  for (const relative of ['.github/workflows/listener-delivery.yml', '.github/workflows/early-birds-fast-forward.yml']) {
    const workflow = await fsp.readFile(path.join(repositoryRoot, relative), 'utf8');
    const uses = [...workflow.matchAll(/^\s*- uses:\s*([^\s#]+)/gm)].map((match) => match[1]);
    assert.ok(uses.length > 0, relative);
    for (const action of uses) assert.match(action, /^[^@]+@[0-9a-f]{40}$/, `${relative}: ${action}`);
  }
  const fastForward = await fsp.readFile(path.join(repositoryRoot, '.github/workflows/early-birds-fast-forward.yml'), 'utf8');
  assert.equal((fastForward.match(/- ops\/listener-delivery\/\*\*/g) ?? []).length, 2);
  assert.equal((fastForward.match(/- scripts\/listener-delivery\/\*\*/g) ?? []).length, 2);
});

test('blocker 7: CI gate rejects missing, skipped, stale-attempt, or non-success checks', async () => {
  const gate = await import(`${path.join(bundleRoot, 'github-gate.mjs')}?b7=${Date.now()}`);
  const names = gate.EXPECTED_CI_CHECKS;
  assert.ok(names.length >= 9);
  const run = {
    id: 500, run_attempt: 2, head_sha: 'a'.repeat(40), head_branch: 'early-birds', event: 'push',
    path: '.github/workflows/early-birds-fast-forward.yml', status: 'completed', conclusion: 'success',
    run_started_at: '2026-09-10T20:00:00Z',
  };
  const jobs = { total_count: names.length, jobs: names.map((name, index) => ({ id: index + 1, name, run_id: 500, run_attempt: 2, status: 'completed', conclusion: 'success', started_at: '2026-09-10T20:00:01Z', completed_at: '2026-09-10T20:01:00Z' })) };
  const checks = { total_count: names.length, check_runs: names.map((name, index) => ({ id: index + 10, name, status: 'completed', conclusion: 'success', started_at: '2026-09-10T20:00:01Z', completed_at: '2026-09-10T20:01:00Z', details_url: `https://github.com/AlterMundi/harmonic-beacon-webapp/actions/runs/500/job/${index + 1}`, app: { slug: 'github-actions' }, check_suite: { head_sha: 'a'.repeat(40) } })) };
  const binding = { source_sha: 'a'.repeat(40), ci_run_id: '500', ci_run_attempt: '2' };
  assert.doesNotThrow(() => gate.validateCiEvidence(run, jobs, checks, binding));
  for (const mutate of [
    (j, c) => { j.jobs.pop(); },
    (j, c) => { c.check_runs[0].conclusion = 'skipped'; },
    (j, c) => { j.jobs[0].run_attempt = 1; },
    (j, c) => { c.check_runs[0].started_at = '2026-09-10T19:59:59Z'; },
  ]) {
    const alteredJobs = structuredClone(jobs);
    const alteredChecks = structuredClone(checks);
    mutate(alteredJobs, alteredChecks);
    assert.throws(() => gate.validateCiEvidence(run, alteredJobs, alteredChecks, binding));
  }
});

test('blocker 7: reviewed delivery workflow binds target and operation to the currently running job step', async () => {
  const gate = await import(`${path.join(bundleRoot, 'github-gate.mjs')}?dispatch=${Date.now()}`);
  const binding = {
    target: 'staging', operation: 'deploy', checkpoint_mode: 'deliver', source_sha: 'a'.repeat(40),
    delivery_run_id: '501', delivery_run_attempt: '3', ci_run_id: '1', ci_run_attempt: '1', configuration_sha256: 'b'.repeat(64),
  };
  const run = { id: 501, run_attempt: 3, head_sha: binding.source_sha, head_branch: 'early-birds', event: 'workflow_dispatch', path: '.github/workflows/listener-delivery.yml', status: 'in_progress' };
  const jobs = { total_count: 2, jobs: [
    { name: 'staging', run_id: 501, run_attempt: 3, status: 'in_progress', conclusion: null, steps: [{ name: 'Deploy staging Listener', status: 'in_progress', conclusion: null }] },
    { name: 'production', run_id: 501, run_attempt: 3, status: 'completed', conclusion: 'skipped', steps: [] },
  ] };
  assert.doesNotThrow(() => gate.validateDeliveryEvidence(run, jobs, binding));
  const wrongStep = structuredClone(jobs);
  wrongStep.jobs[0].steps[0].name = 'Smoke staging Listener';
  assert.throws(() => gate.validateDeliveryEvidence(run, wrongStep, binding), /step/);
  assert.throws(() => gate.validateDeliveryEvidence(run, jobs, { ...binding, target: 'production' }), /job/);
  assert.match(gate.REVIEWED_WORKFLOW_SHA256.delivery, /^[0-9a-f]{64}$/);
  assert.match(gate.REVIEWED_WORKFLOW_SHA256.ci, /^[0-9a-f]{64}$/);
  const deliveryBytes = await fsp.readFile(path.join(repositoryRoot, '.github/workflows/listener-delivery.yml'));
  const ciBytes = await fsp.readFile(path.join(repositoryRoot, '.github/workflows/early-birds-fast-forward.yml'));
  assert.doesNotThrow(() => gate.verifyReviewedWorkflowBytes('delivery', deliveryBytes));
  assert.doesNotThrow(() => gate.verifyReviewedWorkflowBytes('ci', ciBytes));
  assert.throws(() => gate.verifyReviewedWorkflowBytes('delivery', Buffer.concat([deliveryBytes, Buffer.from('# drift\n')])));
});

test('blocker 8: interruption drill input crosses into Bash only through environment', async () => {
  const workflow = await fsp.readFile(path.join(repositoryRoot, '.github/workflows/listener-delivery.yml'), 'utf8');
  const runBlocks = [...workflow.matchAll(/\n\s+run:\s*(?:\||>[-+]?)[^\n]*\n((?:\s{10,}.*\n)*)/g)].map((match) => match[1]).join('\n');
  assert.doesNotMatch(runBlocks, /\$\{\{\s*inputs\.interruption_drill\s*\}\}/);
  assert.match(workflow, /INTERRUPTION_DRILL:\s*\$\{\{\s*inputs\.interruption_drill\s*\}\}/);
  assert.match(workflow, /run: test "\$INTERRUPTION_DRILL" = false/);
});

test('integration: installed lifecycle wires immutable proofs, CI closure, transactions, measured receipts, and typed units', async () => {
  const source = await fsp.readFile(path.join(bundleRoot, 'lifecycle.mjs'), 'utf8');
  assert.match(source, /validateProof/);
  assert.match(source, /fetchAndValidateCi/);
  assert.match(source, /fetchAndValidateDelivery/);
  assert.match(source, /validateReceipt/);
  assert.match(source, /withMeasuredProbes/);
  assert.match(source, /\/usr\/bin\/systemctl/);
  assert.match(source, /hb-listener-delivery-\$\{target\}-\$\{phase\}@\$\{transactionId\}\.service/);
  assert.doesNotMatch(source, /docker compose|docker-compose|\/srv\/harmonic-beacon|scripts\//);
});

test('integration: lifecycle uses canonical UTC time and refuses secret-bearing resource snapshots', async () => {
  const lifecycle = await import(`${path.join(bundleRoot, 'lifecycle.mjs')}?privacy=${Date.now()}`);
  assert.equal(lifecycle.canonicalUtcNow(new Date('2026-09-10T12:13:14.987Z')), '2026-09-10T12:13:14Z');
  const transactionId = 'f'.repeat(64);
  const valid = {
    schema_version: 'listen-delivery-snapshot.v1', transaction_id: transactionId,
    resources: {
      listener: { running: true, image: `harmonic-beacon/earlybirds-preview-listener:${'a'.repeat(40)}`, mode: 'account-off' },
      environment_sha256: 'b'.repeat(64),
      withdrawal: { running: true, image: `harmonic-beacon/earlybirds-preview-listener:${'c'.repeat(40)}` },
    },
    runtime: { image: `harmonic-beacon/earlybirds-preview-listener:${'a'.repeat(40)}`, mode: 'account-off' },
  };
  assert.doesNotThrow(() => lifecycle.validateSnapshot(valid, transactionId));
  const secretBearing = structuredClone(valid);
  secretBearing.resources.api_token = 'must-not-survive';
  assert.throws(() => lifecycle.validateSnapshot(secretBearing, transactionId), /resource fields/);
});

test('integration: installed lifecycle commits measured evidence and exact retry performs no second unit effect', async () => {
  const lifecycle = await import(`${path.join(bundleRoot, 'lifecycle.mjs')}?installed=${Date.now()}`);
  const stateRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-installed-lifecycle-'));
  try {
    const sourceSha = 'a'.repeat(40);
    const configHash = 'b'.repeat(64);
    const membershipHash = 'c'.repeat(64);
    const args = {
      operation: 'deploy', target: 'staging', sourceSha,
      deliveryRunId: '701', deliveryRunAttempt: '2', ciRunId: '699', ciRunAttempt: '4', checkpointMode: 'deliver',
    };
    const context = {
      config: { configuration_sha256: configHash, membership_contract_sha256: membershipHash },
      authority: { proof_sha256: 'd'.repeat(64) }, recipient: { proof_sha256: 'e'.repeat(64) },
    };
    let gateCalls = 0;
    let proofLoads = 0;
    const unitCalls = [];
    const invokeTypedUnit = (target, phase, transactionId) => {
      unitCalls.push(phase);
      if (phase === 'snapshot') return {
        schema_version: 'listen-delivery-snapshot.v1', transaction_id: transactionId,
        resources: {
          listener: { running: true, image: `harmonic-beacon/earlybirds-preview-listener:${'f'.repeat(40)}`, mode: 'account-off' },
          environment_sha256: '1'.repeat(64),
          withdrawal: { running: true, image: `harmonic-beacon/earlybirds-preview-listener:${'2'.repeat(40)}` },
        },
        runtime: { image: `harmonic-beacon/earlybirds-preview-listener:${'f'.repeat(40)}`, mode: 'account-off' },
      };
      return {
        schema_version: 'listen-delivery-unit-result.v1', transaction_id: transactionId, target, operation: 'deploy', source_sha: sourceSha,
        outcome: 'succeeded', observed_at: '2026-09-10T12:13:14Z',
        artifact: { image: `harmonic-beacon/earlybirds-preview-listener:${sourceSha}`, image_id: `sha256:${'3'.repeat(64)}`, digest: null, digest_status: 'unavailable_local_build' },
        configuration_current_sha256: configHash,
        runtime_current: { image: `harmonic-beacon/earlybirds-preview-listener:${sourceSha}`, mode: 'account-off' },
        probes: { health: 'passed', readiness: 'passed' },
        rollback: { result: 'not_requested', restored_image: null, restored_mode: null },
        recovery: { evidence_status: 'captured', cleanup_status: 'not_applicable' },
      };
    };
    const dependencies = {
      stateRoot,
      loadConfig: () => context.config,
      loadProofs: () => { proofLoads += 1; if (proofLoads > 1) throw new Error('fresh proof expired after committed result'); return { authority: context.authority, recipient: context.recipient }; },
      gateGithub: async () => { gateCalls += 1; },
      invokeTypedUnit,
    };
    const first = await lifecycle.runInstalledLifecycle(args, dependencies);
    assert.deepEqual(first.probes, { health: 'passed', readiness: 'passed' });
    const second = await lifecycle.runInstalledLifecycle(args, dependencies);
    assert.deepEqual(second, first);
    assert.deepEqual(unitCalls, ['snapshot', 'deploy']);
    assert.equal(gateCalls, 1);
    assert.equal(proofLoads, 1);
  } finally {
    await fsp.rm(stateRoot, { recursive: true, force: true });
  }
});

test('blocker 3: checkpoint intent is part of replay identity', async () => {
  const tx = await import(`${path.join(bundleRoot, 'transaction.mjs')}?checkpoint=${Date.now()}`);
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-checkpoint-'));
  const binding = {
    target: 'staging', operation: 'deploy', source_sha: 'a'.repeat(40), delivery_run_id: '901',
    delivery_run_attempt: '1', ci_run_id: '902', ci_run_attempt: '1', configuration_sha256: 'b'.repeat(64),
    checkpoint_mode: 'interrupt',
  };
  try {
    assert.equal(tx.beginOrResume(root, binding).kind, 'journal');
    assert.throws(() => tx.beginOrResume(root, { ...binding, checkpoint_mode: 'deliver' }), /conflict/);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});
