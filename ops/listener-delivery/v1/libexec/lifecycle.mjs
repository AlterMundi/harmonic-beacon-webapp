#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fetchAndValidateCi, fetchAndValidateDelivery } from './github-gate.mjs';
import { validateProof } from './proof.mjs';
import { validateReceipt, withMeasuredProbes } from './receipt.mjs';
import { advancePhase, beginOrResume, commitReceipt, readCommittedReceipt, transactionKey } from './transaction.mjs';

const STATE_ROOT = '/var/lib/harmonic-beacon/listener-delivery';
const CONFIG_ROOT = '/etc/harmonic-beacon/listener-delivery';
const PROOF_MAX_AGE_SECONDS = 7200;

export function canonicalUtcNow(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) fail('current time is invalid');
  return `${date.toISOString().slice(0, 19)}Z`;
}

function fail(message) { throw new Error(`Listen lifecycle: ${message}`); }
function exactKeys(value, keys, label) {
  const actual = Object.keys(value ?? {}).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) fail(`${label} fields are not closed`);
}
function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}
function readBoundedRegular(file, { rootOnly = false, max = 1_048_576 } = {}) {
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > max) fail('protected file metadata is unsafe');
  if (rootOnly && (before.uid !== 0 || (before.mode & 0o077) !== 0)) fail('protected file ownership or mode is unsafe');
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.nlink !== 1 || opened.size !== before.size || (rootOnly && (opened.uid !== 0 || (opened.mode & 0o077) !== 0))) fail('protected file changed while opening');
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}
function readJson(file, options) {
  let value;
  try { value = JSON.parse(readBoundedRegular(file, options).toString('utf8')); } catch (error) {
    if (error instanceof SyntaxError) fail('protected JSON is malformed');
    throw error;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('protected JSON root is invalid');
  return value;
}
function readResource(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value?.listener || !value?.withdrawal || !/^[0-9a-f]{64}$/.test(value.environment_sha256 ?? '')) fail('fixture resources are incomplete');
  return value;
}
function writeResource(file, value) {
  const temporary = path.join(path.dirname(file), `.resources.${process.pid}.tmp`);
  const descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value)}\n`);
    fs.fsyncSync(descriptor);
  } finally { fs.closeSync(descriptor); }
  fs.renameSync(temporary, file);
  fsyncDirectory(path.dirname(file));
}

export function runStagingFixture(root, binding, options = {}) {
  if (binding.target !== 'staging' || binding.operation !== 'deploy') fail('fixture requires staging deploy');
  const checkpointMode = options.checkpoint_mode ?? 'deliver';
  if (!['deliver', 'interrupt'].includes(checkpointMode)) fail('invalid fixture checkpoint');
  const effectiveBinding = { ...binding, checkpoint_mode: checkpointMode };
  const resourceFile = path.join(root, 'resources.json');
  const resumed = beginOrResume(root, effectiveBinding);
  if (resumed.kind === 'receipt') return resumed.value;
  let journal = resumed.value;
  if (journal.phase === 'admitted') {
    journal = advancePhase(root, journal, 'admitted', 'prepared', { original_resources: readResource(resourceFile) });
  }
  if (journal.phase === 'prepared') {
    const candidate = {
      listener: { running: true, image: `harmonic-beacon/earlybirds-preview-listener:${binding.source_sha}`, mode: journal.original_resources.listener.mode },
      environment_sha256: binding.configuration_sha256,
      withdrawal: { ...journal.original_resources.withdrawal, running: false },
    };
    writeResource(resourceFile, candidate);
    journal = advancePhase(root, journal, 'prepared', 'mutated', { candidate_resources: candidate });
    if (options.fault === 'lost_return_after_mutation') throw new Error('injected lost return after mutation');
  }
  if (checkpointMode === 'interrupt' && journal.phase === 'mutated') {
    writeResource(resourceFile, journal.original_resources);
    journal = advancePhase(root, journal, 'mutated', 'rolled_back', { cleanup: { result: 'proved', candidate_removed: true, withdrawal_restored: true } });
  }
  const rolledBack = journal.phase === 'rolled_back';
  const current = readResource(resourceFile);
  return commitReceipt(root, journal, {
    schema_version: 'listen-staging-fixture-receipt.v1', transaction_id: journal.transaction_id,
    outcome: rolledBack ? 'interrupted' : 'succeeded', runtime: { previous: journal.original_resources, current },
    cleanup: rolledBack ? journal.cleanup : { result: 'not_applicable', candidate_removed: false, withdrawal_restored: false },
    rollback: rolledBack ? { result: 'succeeded' } : { result: 'not_requested' },
  });
}

function validateArguments(args) {
  const [operation, target, sourceSha, deliveryRunId, deliveryRunAttempt, ciRunId, ciRunAttempt, checkpointMode] = args;
  if (!['probe', 'status', 'preflight', 'deploy', 'smoke', 'rollback'].includes(operation)) fail('unsupported operation');
  if (!['staging', 'production'].includes(target)) fail('unsupported target');
  if (!/^[0-9a-f]{40}$/.test(sourceSha ?? '')) fail('invalid source SHA');
  for (const value of [deliveryRunId, deliveryRunAttempt, ciRunId, ciRunAttempt]) if (!/^[1-9][0-9]*$/.test(value ?? '')) fail('invalid run binding');
  if (!['deliver', 'interrupt'].includes(checkpointMode)) fail('invalid checkpoint mode');
  if (target === 'production' && checkpointMode !== 'deliver') fail('production interruption is forbidden');
  if (operation !== 'deploy' && checkpointMode !== 'deliver') fail('interruption requires staging deploy');
  return { operation, target, sourceSha, deliveryRunId, deliveryRunAttempt, ciRunId, ciRunAttempt, checkpointMode };
}

function loadConfig(target) {
  const config = readJson(path.join(CONFIG_ROOT, `${target}.json`), { rootOnly: true, max: 65_536 });
  exactKeys(config, ['schema_version', 'target', 'configuration_sha256', 'membership_contract_sha256'], 'host configuration');
  if (config.schema_version !== 'listen-delivery-host-config.v1' || config.target !== target || !/^[0-9a-f]{64}$/.test(config.configuration_sha256) || !/^[0-9a-f]{64}$/.test(config.membership_contract_sha256)) fail('host configuration is invalid');
  return config;
}
function loadProofs(config, now) {
  const proofRoot = path.join(STATE_ROOT, 'proofs');
  const authority = validateProof(
    readBoundedRegular(path.join(proofRoot, 'authority-proof.json'), { rootOnly: true, max: 65_536 }),
    readBoundedRegular(path.join(proofRoot, 'authority-evidence.bin'), { rootOnly: true }),
    { kind: 'authority', now, max_age_seconds: PROOF_MAX_AGE_SECONDS, expected_membership_sha256: config.membership_contract_sha256 },
  );
  const recipient = validateProof(
    readBoundedRegular(path.join(proofRoot, 'recipient-proof.json'), { rootOnly: true, max: 65_536 }),
    readBoundedRegular(path.join(proofRoot, 'recipient-evidence.bin'), { rootOnly: true }),
    { kind: 'recipient', now, max_age_seconds: PROOF_MAX_AGE_SECONDS, expected_membership_sha256: config.membership_contract_sha256 },
  );
  return { authority, recipient };
}

function unitResultPath(transactionId, phase) { return path.join(STATE_ROOT, 'unit-results', `${transactionId}-${phase}.json`); }
function invokeTypedUnit(target, phase, transactionId) {
  if (!['staging', 'production'].includes(target) || !['snapshot', 'probe', 'status', 'preflight', 'deploy', 'smoke', 'rollback'].includes(phase) || !/^[0-9a-f]{64}$/.test(transactionId)) fail('unit request is invalid');
  const resultFile = unitResultPath(transactionId, phase);
  if (!fs.existsSync(resultFile)) {
    const unit = `hb-listener-delivery-${target}-${phase}@${transactionId}.service`;
    execFileSync('/usr/bin/systemctl', ['start', '--wait', unit], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 900_000, env: { PATH: '/usr/sbin:/usr/bin:/sbin:/bin', HOME: '/root', LC_ALL: 'C', TZ: 'UTC' } });
  }
  return readJson(resultFile, { rootOnly: true });
}
export function validateSnapshot(value, transactionId) {
  exactKeys(value, ['schema_version', 'transaction_id', 'resources', 'runtime'], 'snapshot result');
  if (value.schema_version !== 'listen-delivery-snapshot.v1' || value.transaction_id !== transactionId) fail('snapshot identity is invalid');
  exactKeys(value.runtime, ['image', 'mode'], 'snapshot runtime');
  exactKeys(value.resources, ['environment_sha256', 'listener', 'withdrawal'], 'snapshot resource fields');
  exactKeys(value.resources.listener, ['image', 'mode', 'running'], 'snapshot listener resource fields');
  exactKeys(value.resources.withdrawal, ['image', 'running'], 'snapshot withdrawal resource fields');
  const imagePattern = /^harmonic-beacon\/earlybirds-preview-listener:[0-9a-f]{40}$/;
  if (!/^[0-9a-f]{64}$/.test(value.resources.environment_sha256 ?? '') ||
      typeof value.resources.listener.running !== 'boolean' || !imagePattern.test(value.resources.listener.image ?? '') ||
      !['account-off', 'account-on', 'stopped', 'unknown'].includes(value.resources.listener.mode) ||
      typeof value.resources.withdrawal.running !== 'boolean' || !imagePattern.test(value.resources.withdrawal.image ?? '')) fail('snapshot resource set is incomplete');
  return value;
}
function validateOperationResult(value, transactionId, args) {
  exactKeys(value, ['schema_version', 'transaction_id', 'target', 'operation', 'source_sha', 'outcome', 'observed_at', 'artifact', 'configuration_current_sha256', 'runtime_current', 'probes', 'rollback', 'recovery'], 'operation result');
  if (value.schema_version !== 'listen-delivery-unit-result.v1' || value.transaction_id !== transactionId || value.target !== args.target || value.operation !== args.operation || value.source_sha !== args.sourceSha) fail('operation result identity is invalid');
  return value;
}

export async function runInstalledLifecycle(args, dependencies = {}) {
  const stateRoot = dependencies.stateRoot ?? STATE_ROOT;
  const now = dependencies.now ?? canonicalUtcNow();
  const config = dependencies.loadConfig ? dependencies.loadConfig(args.target) : loadConfig(args.target);
  const binding = {
    target: args.target, operation: args.operation, source_sha: args.sourceSha,
    delivery_run_id: args.deliveryRunId, delivery_run_attempt: args.deliveryRunAttempt,
    ci_run_id: args.ciRunId, ci_run_attempt: args.ciRunAttempt,
    configuration_sha256: config.configuration_sha256, checkpoint_mode: args.checkpointMode,
  };
  if (['deploy', 'rollback'].includes(args.operation)) {
    const committed = readCommittedReceipt(stateRoot, binding);
    if (committed) return committed;
  }
  const proofs = dependencies.loadProofs ? dependencies.loadProofs(config, now) : loadProofs(config, now);
  const context = { config, ...proofs };
  if (dependencies.gateGithub) await dependencies.gateGithub(binding);
  else {
    await fetchAndValidateDelivery(binding);
    await fetchAndValidateCi(binding);
  }
  const invoke = dependencies.invokeTypedUnit ?? invokeTypedUnit;
  if (!['deploy', 'rollback'].includes(args.operation)) {
    const requestId = createHash('sha256').update(JSON.stringify(binding)).digest('hex');
    return invoke(args.target, args.operation, requestId);
  }
  const resumed = beginOrResume(stateRoot, binding);
  if (resumed.kind === 'receipt') return resumed.value;
  let journal = resumed.value;
  if (journal.phase === 'admitted') {
    const snapshot = validateSnapshot(invoke(args.target, 'snapshot', journal.transaction_id), journal.transaction_id);
    journal = advancePhase(stateRoot, journal, 'admitted', 'prepared', { original_resources: snapshot.resources, original_runtime: snapshot.runtime });
  }
  if (journal.phase === 'prepared') {
    const observed = validateOperationResult(invoke(args.target, args.operation, journal.transaction_id), journal.transaction_id, args);
    journal = advancePhase(stateRoot, journal, 'prepared', 'mutated', { operation_result: observed });
  }
  const observed = journal.operation_result;
  const draft = withMeasuredProbes({
    schema_version: 'listen-delivery-receipt.v1', service: 'listen', target: args.target,
    operation: args.operation, outcome: observed.outcome, observed_at: observed.observed_at,
    source: { sha: args.sourceSha }, artifact: observed.artifact,
    configuration: { requested_sha256: binding.configuration_sha256, current_sha256: observed.configuration_current_sha256 },
    runtime: { previous: journal.original_runtime, current: observed.runtime_current },
    authority: { membership_contract_sha256: context.config.membership_contract_sha256, proof_sha256: context.authority.proof_sha256, status: 'matched' },
    alert_recipient: { status: 'verified', proof_sha256: context.recipient.proof_sha256 },
    github: { repository: 'AlterMundi/harmonic-beacon-webapp', lane: 'early-birds', workflow: '.github/workflows/listener-delivery.yml', run_id: args.deliveryRunId, run_attempt: Number(args.deliveryRunAttempt), ci_workflow: '.github/workflows/early-birds-fast-forward.yml', ci_run_id: args.ciRunId, ci_run_attempt: Number(args.ciRunAttempt) },
    rollback: observed.rollback, recovery: observed.recovery,
  }, () => observed.probes);
  validateReceipt(draft, context.config.membership_contract_sha256);
  return commitReceipt(stateRoot, journal, draft);
}

async function main() {
  const args = validateArguments(process.argv.slice(2));
  const fixtureRoot = process.env.LISTENER_DELIVERY_SYNTHETIC_FIXTURE_ROOT;
  if (fixtureRoot) {
    if (args.operation !== 'probe') fail('wrapper fixture permits probe only');
    process.stdout.write('synthetic Listen lifecycle probe passed\n');
    return;
  }
  const result = await runInstalledLifecycle(args);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Listen lifecycle failed'}\n`);
    process.exitCode = 2;
  });
}
