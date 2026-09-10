#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const fail = (message) => {
  process.stderr.write(`Listen delivery receipt: ${message}\n`);
  process.exit(2);
};
const sha40 = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const imageId = /^sha256:[0-9a-f]{64}$/;
const runtimeImage = /^harmonic-beacon\/earlybirds-preview-listener:[0-9a-f]{40}$/;
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const allowedKeys = new Set([
  'schema_version', 'service', 'target', 'operation', 'outcome', 'observed_at',
  'source', 'sha', 'artifact', 'image', 'image_id', 'digest', 'digest_status',
  'configuration', 'contract_sha256', 'runtime', 'previous', 'current', 'mode',
  'probes', 'health', 'readiness', 'authority', 'membership_contract_sha256',
  'status', 'alert_recipient', 'proof_sha256', 'github', 'repository', 'lane',
  'workflow', 'run_id', 'run_attempt', 'ci_workflow', 'ci_run_id', 'ci_run_attempt',
  'rollback', 'result', 'restored_image', 'restored_mode', 'recovery',
  'evidence_status', 'cleanup_status',
]);

const object = (value, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} evidence is missing`);
  return value;
};
const exactKeys = (value, keys, label) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} evidence has missing or unexpected fields`);
  }
};
const choice = (value, values, label) => {
  if (!values.includes(value)) fail(`${label} evidence is invalid`);
};

function validate(value, expectedAuthorityHash) {
  const root = object(value, 'root');
  exactKeys(root, [
    'schema_version', 'service', 'target', 'operation', 'outcome', 'observed_at',
    'source', 'artifact', 'configuration', 'runtime', 'probes', 'authority',
    'alert_recipient', 'github', 'rollback', 'recovery',
  ], 'root');
  if (root.schema_version !== 'listen-delivery-receipt.v1' || root.service !== 'listen') fail('schema identity is invalid');
  choice(root.target, ['staging', 'production'], 'target');
  choice(root.operation, ['deploy', 'rollback'], 'operation');
  choice(root.outcome, ['succeeded', 'failed', 'interrupted'], 'outcome');
  if (!timestamp.test(root.observed_at)) fail('observed timestamp is invalid');

  exactKeys(object(root.source, 'source'), ['sha'], 'source');
  if (!sha40.test(root.source.sha)) fail('source SHA must be exact lowercase sha40');

  const artifact = object(root.artifact, 'artifact');
  exactKeys(artifact, ['image', 'image_id', 'digest', 'digest_status'], 'artifact');
  if (typeof artifact.image !== 'string' || artifact.image !== `harmonic-beacon/earlybirds-preview-listener:${root.source.sha}`) {
    fail('artifact image is not bound to source SHA');
  }
  if (artifact.image_id !== null && !imageId.test(artifact.image_id)) fail('artifact image ID is invalid');
  if (artifact.digest !== null && !imageId.test(artifact.digest)) fail('artifact digest is invalid');
  choice(artifact.digest_status, ['available', 'unavailable_local_build', 'unavailable_after_rollback'], 'artifact digest');
  if (artifact.image_id === null && artifact.digest === null && !artifact.digest_status.startsWith('unavailable_')) {
    fail('artifact evidence requires an image ID, digest, or explicit unavailable status');
  }

  exactKeys(object(root.configuration, 'configuration'), ['contract_sha256'], 'configuration');
  if (!sha256.test(root.configuration.contract_sha256)) fail('configuration contract hash is missing or invalid');

  const runtime = object(root.runtime, 'runtime');
  exactKeys(runtime, ['previous', 'current'], 'runtime');
  for (const name of ['previous', 'current']) {
    const state = object(runtime[name], `runtime ${name}`);
    exactKeys(state, ['image', 'mode'], `runtime ${name}`);
    if (state.image !== null && (typeof state.image !== 'string' || !runtimeImage.test(state.image))) fail(`runtime ${name} image is invalid`);
    choice(state.mode, ['account-off', 'account-on', 'stopped', 'unknown'], `runtime ${name} mode`);
  }

  const probes = object(root.probes, 'probe');
  exactKeys(probes, ['health', 'readiness'], 'probe');
  choice(probes.health, ['passed', 'failed', 'not_observed'], 'health');
  choice(probes.readiness, ['passed', 'failed', 'not_observed'], 'readiness');

  const authority = object(root.authority, 'Authority');
  exactKeys(authority, ['membership_contract_sha256', 'status'], 'Authority');
  if (!sha256.test(authority.membership_contract_sha256)) fail('Authority membership contract hash is invalid');
  choice(authority.status, ['matched', 'mismatched', 'unresolved'], 'Authority status');
  if (authority.membership_contract_sha256 !== expectedAuthorityHash) fail('Authority membership contract hash mismatch');
  if (authority.status !== 'matched') fail('Authority membership contract is not currently matched');

  const recipient = object(root.alert_recipient, 'alert recipient');
  exactKeys(recipient, ['status', 'proof_sha256'], 'alert recipient');
  if (recipient.status !== 'verified' || !sha256.test(recipient.proof_sha256)) fail('alert recipient proof is missing or unresolved');

  const github = object(root.github, 'GitHub');
  exactKeys(github, [
    'repository', 'lane', 'workflow', 'run_id', 'run_attempt',
    'ci_workflow', 'ci_run_id', 'ci_run_attempt',
  ], 'GitHub');
  if (github.repository !== 'AlterMundi/harmonic-beacon-webapp' || github.lane !== 'early-birds') fail('GitHub lane binding is invalid');
  if (github.workflow !== '.github/workflows/listener-delivery.yml') fail('delivery workflow binding is invalid');
  if (github.ci_workflow !== '.github/workflows/early-birds-fast-forward.yml') fail('CI workflow binding is invalid');
  for (const key of ['run_id', 'ci_run_id']) if (!/^[1-9][0-9]*$/.test(github[key])) fail(`${key} is invalid`);
  for (const key of ['run_attempt', 'ci_run_attempt']) if (!Number.isSafeInteger(github[key]) || github[key] < 1) fail(`${key} is invalid`);

  const rollback = object(root.rollback, 'rollback');
  exactKeys(rollback, ['result', 'restored_image', 'restored_mode'], 'rollback');
  choice(rollback.result, ['not_requested', 'succeeded', 'failed', 'not_available'], 'rollback result');
  if (rollback.result === 'succeeded') {
    if (rollback.restored_mode === 'stopped') {
      if (rollback.restored_image !== null) fail('stopped rollback must not claim a restored image');
    } else if (!runtimeImage.test(rollback.restored_image ?? '')) {
      fail('rollback restored image evidence is missing');
    }
  }
  if (rollback.restored_mode !== null) choice(rollback.restored_mode, ['account-off', 'account-on', 'stopped', 'unknown'], 'rollback restored mode');

  const recovery = object(root.recovery, 'recovery');
  exactKeys(recovery, ['evidence_status', 'cleanup_status'], 'recovery');
  choice(recovery.evidence_status, ['captured', 'used', 'unavailable'], 'recovery evidence');
  choice(recovery.cleanup_status, ['proved', 'not_applicable', 'failed'], 'recovery cleanup');
  if (recovery.evidence_status === 'unavailable') fail('recovery evidence is unavailable');

  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') {
      if (typeof node === 'string' && node.startsWith('/')) fail('private or absolute paths are forbidden');
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (!allowedKeys.has(key) || /secret|token|password|private.*path/i.test(key)) fail('secret or private-path fields are forbidden');
      walk(child);
    }
  };
  walk(root);
  return root;
}

const [command, file, expectedAuthorityHash] = process.argv.slice(2);
if (!['validate', 'write'].includes(command) || !file || !sha256.test(expectedAuthorityHash ?? '')) {
  fail('usage: receipt.mjs validate|write FILE EXPECTED_AUTHORITY_SHA256');
}

let value;
try {
  value = JSON.parse(command === 'write' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8'));
} catch {
  fail('receipt is not valid JSON');
}
validate(value, expectedAuthorityHash);
if (command === 'write') {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  fs.renameSync(temporary, file);
}
process.stdout.write('Listen delivery receipt is valid.\n');
