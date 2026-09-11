import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const contractRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(contractRoot, '../../..');
const validator = path.join(repositoryRoot, 'scripts/listener-delivery/validate-request.mjs');
const receiptTool = path.join(repositoryRoot, 'scripts/listener-delivery/receipt.mjs');
const helper = path.join(contractRoot, 'listener-delivery-root');
const staging = path.join(repositoryRoot, 'scripts/listener-delivery/staging-preview.sh');
const sha = 'a'.repeat(40);
const authorityHash = 'b'.repeat(64);
const configHash = 'c'.repeat(64);
const artifactId = `sha256:${'d'.repeat(64)}`;

const run = (command, args, options = {}) => spawnSync(command, args, {
  cwd: repositoryRoot,
  encoding: 'utf8',
  ...options,
});

const git = (root, ...args) => {
  const result = run('git', ['-C', root, ...args]);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

const commit = async (root, name) => {
  await fsp.writeFile(path.join(root, 'value'), `${name}\n`);
  git(root, 'add', 'value');
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', name);
  return git(root, 'rev-parse', 'HEAD');
};

const validReceipt = () => ({
  schema_version: 'listen-delivery-receipt.v1',
  service: 'listen',
  target: 'staging',
  operation: 'deploy',
  outcome: 'succeeded',
  observed_at: '2026-09-10T21:00:00Z',
  source: { sha },
  artifact: {
    image: `harmonic-beacon/earlybirds-preview-listener:${sha}`,
    image_id: artifactId,
    digest: null,
    digest_status: 'unavailable_local_build',
  },
  configuration: { requested_sha256: configHash, current_sha256: configHash },
  runtime: {
    previous: { image: `harmonic-beacon/earlybirds-preview-listener:${'e'.repeat(40)}`, mode: 'account-off' },
    current: { image: `harmonic-beacon/earlybirds-preview-listener:${sha}`, mode: 'account-on' },
  },
  probes: { health: 'passed', readiness: 'passed' },
  authority: { membership_contract_sha256: authorityHash, proof_sha256: 'e'.repeat(64), status: 'matched' },
  alert_recipient: { status: 'verified', proof_sha256: 'f'.repeat(64) },
  github: {
    repository: 'AlterMundi/harmonic-beacon-webapp',
    lane: 'early-birds',
    workflow: '.github/workflows/listener-delivery.yml',
    run_id: '123456',
    run_attempt: 1,
    ci_workflow: '.github/workflows/early-birds-fast-forward.yml',
    ci_run_id: '123400',
    ci_run_attempt: 2,
  },
  rollback: { result: 'not_requested', restored_image: null, restored_mode: null },
  recovery: { evidence_status: 'captured', cleanup_status: 'not_applicable' },
});

test('request binding rejects stale and foreign SHAs while accepting the exact early-birds head', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-delivery-git-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  const old = await commit(root, 'old');
  git(root, 'branch', '-M', 'early-birds');
  const current = await commit(root, 'current');
  git(root, 'update-ref', 'refs/remotes/origin/early-birds', current);
  git(root, 'checkout', '-q', '-b', 'foreign', old);
  const foreign = await commit(root, 'foreign');

  const accepted = run('node', [validator, root, 'deploy', 'staging', current]);
  assert.equal(accepted.status, 0, accepted.stderr);

  const stale = run('node', [validator, root, 'deploy', 'staging', old]);
  assert.equal(stale.status, 2);
  assert.match(stale.stderr, /stale source SHA/);

  const unrelated = run('node', [validator, root, 'deploy', 'staging', foreign]);
  assert.equal(unrelated.status, 2);
  assert.match(unrelated.stderr, /foreign source SHA/);
});

test('receipt validation accepts a complete source-bound receipt', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-receipt-valid-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const receipt = path.join(root, 'receipt.json');
  await fsp.writeFile(receipt, JSON.stringify(validReceipt()));
  const result = run('node', [receiptTool, 'validate', receipt, authorityHash]);
  assert.equal(result.status, 0, result.stderr);
});

test('receipt validation represents a successful recovery to the prior stopped state', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-receipt-stopped-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const value = validReceipt();
  value.operation = 'rollback';
  value.runtime.current = { image: null, mode: 'stopped' };
  value.rollback = { result: 'succeeded', restored_image: null, restored_mode: 'stopped' };
  value.recovery = { evidence_status: 'used', cleanup_status: 'proved' };
  const receipt = path.join(root, 'receipt.json');
  await fsp.writeFile(receipt, JSON.stringify(value));
  const result = run('node', [receiptTool, 'validate', receipt, authorityHash]);
  assert.equal(result.status, 0, result.stderr);
});

test('receipt validation rejects runtime images outside the bounded Listen namespace', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-receipt-runtime-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const value = validReceipt();
  value.runtime.previous.image = 'attacker-controlled:latest';
  const receipt = path.join(root, 'receipt.json');
  await fsp.writeFile(receipt, JSON.stringify(value));
  const result = run('node', [receiptTool, 'validate', receipt, authorityHash]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /runtime previous image is invalid/);
});

test('receipt validation rejects a mismatched Authority membership contract', async (t) => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-receipt-authority-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const receipt = path.join(root, 'receipt.json');
  await fsp.writeFile(receipt, JSON.stringify(validReceipt()));
  const result = run('node', [receiptTool, 'validate', receipt, '0'.repeat(64)]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Authority membership contract hash mismatch/);
});

test('receipt validation fails closed on missing artifact, config, recipient, or recovery evidence', async (t) => {
  const cases = [
    ['artifact', (value) => { delete value.artifact.image_id; delete value.artifact.digest; }],
    ['configuration', (value) => { delete value.configuration.current_sha256; }],
    ['alert recipient', (value) => { delete value.alert_recipient.proof_sha256; }],
    ['Authority', (value) => { delete value.authority.proof_sha256; }],
    ['recovery', (value) => { delete value.recovery.evidence_status; }],
  ];
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-receipt-evidence-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  for (const [name, mutate] of cases) {
    const value = validReceipt();
    mutate(value);
    const receipt = path.join(root, `${name.replace(' ', '-')}.json`);
    await fsp.writeFile(receipt, JSON.stringify(value));
    const result = run('node', [receiptTool, 'validate', receipt, authorityHash]);
    assert.equal(result.status, 2, `${name} unexpectedly accepted`);
    assert.match(result.stderr, new RegExp(name, 'i'));
  }
});

test('the privileged adapter rejects a concurrent run', async (t) => {
  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-delivery-lock-'));
  t.after(() => fsp.rm(fixture, { recursive: true, force: true }));
  await fsp.writeFile(path.join(fixture, 'synthetic-listener-preview.fixture.v1'), 'synthetic\n');
  await fsp.writeFile(path.join(fixture, 'hold-seconds'), '2\n');
  const current = git(repositoryRoot, 'rev-parse', 'HEAD');
  const env = { ...process.env, LISTENER_DELIVERY_SYNTHETIC_FIXTURE_ROOT: fixture };
  const first = spawn(helper, ['probe', 'staging', current, '101', '1', '99', '1', 'deliver'], {
    cwd: repositoryRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve) => setTimeout(resolve, 250));
  const second = run(helper, ['probe', 'staging', current, '102', '1', '99', '1', 'deliver'], { env });
  assert.equal(second.status, 2);
  assert.match(second.stderr, /another Listen delivery operation is active/);
  first.kill('SIGTERM');
});

test('an interrupted synthetic staging checkpoint restores the prior preview and proves cleanup', async (t) => {
  const fixture = await fsp.mkdtemp(path.join(os.tmpdir(), 'listen-staging-interrupt-'));
  t.after(() => fsp.rm(fixture, { recursive: true, force: true }));
  await fsp.writeFile(path.join(fixture, 'synthetic-listener-preview.fixture.v1'), 'synthetic\n');
  await fsp.writeFile(path.join(fixture, 'current-state'), 'running|previous-image|account-off\n');
  const result = run(staging, [sha, 'interrupt'], {
    env: { ...process.env, LISTENER_DELIVERY_SYNTHETIC_FIXTURE_ROOT: fixture },
  });
  assert.equal(result.status, 130, result.stderr);
  assert.equal(await fsp.readFile(path.join(fixture, 'current-state'), 'utf8'), 'running|previous-image|account-off\n');
  const proof = JSON.parse(await fsp.readFile(path.join(fixture, 'cleanup-proof.json'), 'utf8'));
  assert.deepEqual(proof, { schema_version: 'listen-staging-cleanup.v1', restored: true, candidate_removed: true });
  assert.equal(fs.existsSync(path.join(fixture, 'candidate-active')), false);
});

test('the privileged adapter rejects arbitrary command and target arguments', () => {
  const result = run(helper, ['bash', 'production', sha, '1', '1', '1', '1', 'deliver']);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unsupported Listen delivery operation/);
  const docker = run(helper, ['deploy', 'docker', sha, '1', '1', '1', '1', 'deliver']);
  assert.equal(docker.status, 2);
  assert.match(docker.stderr, /unsupported Listen delivery target/);
});

test('privileged helper fixes its interpreter and clears caller-controlled tool environments', async () => {
  const helperSource = await fsp.readFile(helper, 'utf8');
  assert.match(helperSource, /^#!\/bin\/sh\n/);
  assert.match(helperSource, /^HOME=\/root$/m);
  assert.match(helperSource, /unset .*NODE_OPTIONS.*GIT_DIR.*DOCKER_HOST.*LISTENER_WITHDRAWAL_CONTAINER.*HTTPS_PROXY.*CURL_CA_BUNDLE.*SSL_CERT_FILE/);
});

test('privileged helper validates the installed bundle before executing reviewed code', async () => {
  const helperSource = await fsp.readFile(helper, 'utf8');
  const ownershipCheck = helperSource.indexOf('lifecycle bundle ancestor is writable or not root-owned');
  const installedExecution = helperSource.indexOf('exec /usr/bin/node "$bundle_root/lifecycle.mjs"');
  assert.ok(ownershipCheck >= 0 && installedExecution > ownershipCheck);
  assert.doesNotMatch(helperSource, /\/srv\/harmonic-beacon|scripts\/listener-delivery|docker compose|\bgit -C/);
});

test('privileged helper rejects unsafe bundle ancestors, entries, and durable state', async () => {
  const helperSource = await fsp.readFile(helper, 'utf8');
  assert.match(helperSource, /find "\$ancestor" -maxdepth 0 .* ! -user root -o -perm \/022/);
  assert.match(helperSource, /test -f "\$bundle_file" && test ! -L "\$bundle_file"/);
  assert.match(helperSource, /root:root:500:1/);
  assert.match(helperSource, /stat -c '%U:%G:%a' "\$state_root"\)" = root:root:700/);
  assert.doesNotMatch(helperSource, /stat -c '%U:%G:%a:%h' "\$bundle_root"\)" = root:root:500:1/);
});

test('deploy rejects missing artifact evidence before preparing host state', async () => {
  const lifecycle = await fsp.readFile(path.join(contractRoot, 'libexec/lifecycle.mjs'), 'utf8');
  const resultValidation = lifecycle.indexOf('validateOperationResult(invoke(');
  const receiptCommit = lifecycle.indexOf('return commitReceipt(stateRoot');
  assert.ok(resultValidation >= 0 && receiptCommit > resultValidation, 'measured operation evidence must precede the receipt CAS');
  assert.match(lifecycle, /artifact: observed\.artifact/);
});

test('workflow and sudoers contract expose only the service-specific least-privilege lane', async () => {
  const workflow = await fsp.readFile(path.join(repositoryRoot, '.github/workflows/listener-delivery.yml'), 'utf8');
  const sudoers = await fsp.readFile(path.join(contractRoot, 'listener-delivery.sudoers.example'), 'utf8');
  const helperSource = await fsp.readFile(helper, 'utf8');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /branches: \[early-birds\]/);
  assert.match(workflow, /runs-on: \[self-hosted, mona, listener-staging\]/);
  assert.match(workflow, /runs-on: \[self-hosted, mona, listener-production\]/);
  assert.match(workflow, /environment: listener-staging/);
  assert.match(workflow, /environment: listener-production/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /contents: read/);
  assert.doesNotMatch(workflow, /docker compose|docker-compose/);
  assert.match(workflow, /\/usr\/local\/sbin\/hb-listener-delivery/);
  assert.match(helperSource, /bundle_root=\/usr\/local\/libexec\/hb-listener-delivery\/v1/);
  assert.match(helperSource, /expected_bundle_manifest_sha256=[0-9a-f]{64}/);
  assert.match(helperSource, /verify_bundle_file lifecycle\.mjs [0-9a-f]{64}/);
  assert.match(sudoers, /sha256:[0-9a-f]{64} \/usr\/local\/sbin\/hb-listener-delivery/);
  const helperDigest = createHash('sha256').update(await fsp.readFile(helper)).digest('hex');
  assert.match(sudoers, new RegExp(`sha256:${helperDigest} /usr/local/sbin/hb-listener-delivery`));
  assert.doesNotMatch(sudoers, /\/bin\/(?:ba)?sh|\/usr\/bin\/(?:docker|git)|ALL\s*$/m);
});
