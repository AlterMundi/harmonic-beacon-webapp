#!/usr/bin/env node

export const RECEIPT_SCHEMA = 'listen-delivery-receipt.v1';
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/;
const RUNTIME_IMAGE = /^harmonic-beacon\/earlybirds-preview-listener:[0-9a-f]{40}$/;
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
const ROOT_KEYS = [
  'alert_recipient', 'artifact', 'authority', 'configuration', 'github', 'observed_at',
  'operation', 'outcome', 'probes', 'recovery', 'rollback', 'runtime', 'schema_version',
  'service', 'source', 'target',
];
const ALLOWED_KEYS = new Set([
  ...ROOT_KEYS, 'sha', 'image', 'image_id', 'digest', 'digest_status', 'requested_sha256',
  'current_sha256', 'previous', 'current', 'mode', 'health', 'readiness',
  'membership_contract_sha256', 'status', 'proof_sha256', 'repository', 'lane', 'workflow',
  'run_id', 'run_attempt', 'ci_workflow', 'ci_run_id', 'ci_run_attempt', 'result',
  'restored_image', 'restored_mode', 'evidence_status', 'cleanup_status',
]);

function reject(message) { throw new Error(`Listen delivery receipt: ${message}`); }
function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) reject(`${label} evidence is missing`);
  return value;
}
function exactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    reject(`${label} evidence has missing or unexpected fields`);
  }
}
function choice(value, values, label) { if (!values.includes(value)) reject(`${label} evidence is invalid`); }
function sameRuntime(left, right) { return left.image === right.image && left.mode === right.mode; }
function validUtc(value) {
  if (!RFC3339_UTC.test(value)) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value.replace(/Z$/, '.000Z');
}
function validateRuntime(state, label) {
  exactKeys(object(state, label), ['image', 'mode'], label);
  choice(state.mode, ['account-off', 'account-on', 'stopped', 'unknown'], `${label} mode`);
  if (state.image !== null && !RUNTIME_IMAGE.test(state.image)) reject(`${label} image is invalid`);
  if ((state.image === null) !== (state.mode === 'stopped')) reject(`${label} stopped/image coupling is invalid`);
}

export function validateReceipt(value, expectedAuthorityHash) {
  const root = object(value, 'root');
  exactKeys(root, ROOT_KEYS, 'root');
  if (root.schema_version !== RECEIPT_SCHEMA || root.service !== 'listen') reject('schema identity is invalid');
  choice(root.target, ['staging', 'production'], 'target');
  choice(root.operation, ['deploy', 'rollback'], 'operation');
  choice(root.outcome, ['succeeded', 'failed', 'interrupted'], 'outcome');
  if (!validUtc(root.observed_at)) reject('observed timestamp is not a real canonical UTC RFC3339 value');

  exactKeys(object(root.source, 'source'), ['sha'], 'source');
  if (!SHA40.test(root.source.sha)) reject('source SHA must be exact lowercase sha40');
  const expectedImage = `harmonic-beacon/earlybirds-preview-listener:${root.source.sha}`;

  const artifact = object(root.artifact, 'artifact');
  exactKeys(artifact, ['image', 'image_id', 'digest', 'digest_status'], 'artifact');
  if (artifact.image !== expectedImage) reject('artifact image is not bound to source SHA');
  if (artifact.image_id !== null && !IMAGE_ID.test(artifact.image_id)) reject('artifact image ID is invalid');
  if (artifact.digest !== null && !IMAGE_ID.test(artifact.digest)) reject('artifact digest is invalid');
  choice(artifact.digest_status, ['available', 'unavailable_local_build', 'unavailable_after_rollback'], 'artifact digest');
  if ((artifact.digest_status === 'available') !== (artifact.digest !== null)) reject('artifact digest status/value coupling is invalid');
  if (artifact.digest_status === 'unavailable_local_build' && artifact.image_id === null) reject('local artifact image ID is required');
  if (artifact.digest_status === 'unavailable_after_rollback' && root.operation !== 'rollback') reject('rollback-only digest status is invalid');

  const configuration = object(root.configuration, 'configuration');
  exactKeys(configuration, ['requested_sha256', 'current_sha256'], 'configuration');
  if (!SHA256.test(configuration.requested_sha256) || !SHA256.test(configuration.current_sha256)) reject('configuration digest is invalid');

  const runtime = object(root.runtime, 'runtime');
  exactKeys(runtime, ['previous', 'current'], 'runtime');
  validateRuntime(runtime.previous, 'runtime previous');
  validateRuntime(runtime.current, 'runtime current');

  const probes = object(root.probes, 'probes');
  exactKeys(probes, ['health', 'readiness'], 'probes');
  choice(probes.health, ['passed', 'failed', 'not_observed'], 'health probe');
  choice(probes.readiness, ['passed', 'failed', 'not_observed'], 'readiness probe');

  const authority = object(root.authority, 'Authority');
  exactKeys(authority, ['membership_contract_sha256', 'proof_sha256', 'status'], 'Authority evidence');
  if (!SHA256.test(authority.membership_contract_sha256 ?? '') || !SHA256.test(authority.proof_sha256 ?? '') || authority.status !== 'matched' || authority.membership_contract_sha256 !== expectedAuthorityHash) reject('Authority membership contract hash mismatch');
  if (authority.status !== 'matched') reject('Authority membership contract is not currently matched');

  const recipient = object(root.alert_recipient, 'alert recipient');
  exactKeys(recipient, ['status', 'proof_sha256'], 'alert recipient');
  if (recipient.status !== 'verified' || !SHA256.test(recipient.proof_sha256)) reject('alert recipient proof is missing or unresolved');

  const github = object(root.github, 'GitHub');
  exactKeys(github, ['repository', 'lane', 'workflow', 'run_id', 'run_attempt', 'ci_workflow', 'ci_run_id', 'ci_run_attempt'], 'GitHub');
  if (github.repository !== 'AlterMundi/harmonic-beacon-webapp' || github.lane !== 'early-birds') reject('GitHub lane binding is invalid');
  if (github.workflow !== '.github/workflows/listener-delivery.yml' || github.ci_workflow !== '.github/workflows/early-birds-fast-forward.yml') reject('GitHub workflow binding is invalid');
  for (const key of ['run_id', 'ci_run_id']) if (!/^[1-9][0-9]*$/.test(github[key])) reject(`${key} is invalid`);
  for (const key of ['run_attempt', 'ci_run_attempt']) if (!Number.isSafeInteger(github[key]) || github[key] < 1) reject(`${key} is invalid`);

  const rollback = object(root.rollback, 'rollback');
  exactKeys(rollback, ['result', 'restored_image', 'restored_mode'], 'rollback');
  choice(rollback.result, ['not_requested', 'succeeded', 'failed', 'not_available'], 'rollback result');
  if (rollback.restored_image !== null && !RUNTIME_IMAGE.test(rollback.restored_image)) reject('rollback restored image is invalid');
  if (rollback.restored_mode !== null) choice(rollback.restored_mode, ['account-off', 'account-on', 'stopped', 'unknown'], 'rollback restored mode');

  const recovery = object(root.recovery, 'recovery');
  exactKeys(recovery, ['evidence_status', 'cleanup_status'], 'recovery');
  choice(recovery.evidence_status, ['captured', 'used', 'unavailable'], 'recovery evidence');
  choice(recovery.cleanup_status, ['proved', 'not_applicable', 'failed'], 'recovery cleanup');
  if (recovery.evidence_status === 'unavailable') reject('recovery evidence is unavailable');

  if (root.outcome === 'succeeded') {
    if (probes.health !== 'passed' || probes.readiness !== 'passed') reject('successful outcome requires measured passing probes');
  } else if (rollback.result !== 'succeeded' && probes.health === 'passed' && probes.readiness === 'passed') {
    reject('unsuccessful outcome cannot claim all probes passed');
  }
  if (root.operation === 'deploy' && root.outcome === 'succeeded') {
    if (runtime.current.image !== expectedImage || ['stopped', 'unknown'].includes(runtime.current.mode)) reject('successful deploy current source is contradictory');
    if (configuration.current_sha256 !== configuration.requested_sha256) reject('successful deploy current configuration is contradictory');
    if (rollback.result !== 'not_requested') reject('successful deploy cannot claim rollback');
  }
  if (rollback.result === 'not_requested') {
    if (rollback.restored_image !== null || rollback.restored_mode !== null || recovery.cleanup_status !== 'not_applicable') reject('not-requested rollback fields are contradictory');
  } else if (rollback.result === 'succeeded') {
    const restored = { image: rollback.restored_image, mode: rollback.restored_mode };
    if (!sameRuntime(restored, runtime.current)) reject('rollback restored state does not equal current runtime');
    if (recovery.evidence_status !== 'used' || recovery.cleanup_status !== 'proved') reject('successful rollback requires used recovery and proved cleanup');
    if (!((root.operation === 'rollback' && root.outcome === 'succeeded') || (root.operation === 'deploy' && root.outcome === 'interrupted'))) reject('successful rollback operation/outcome is contradictory');
  } else if (root.outcome === 'succeeded') {
    reject('successful outcome cannot claim failed or unavailable rollback');
  }
  if (root.operation === 'rollback' && root.outcome === 'succeeded' && rollback.result !== 'succeeded') reject('successful rollback operation requires successful restoration');
  if (root.outcome === 'interrupted' && !(root.target === 'staging' && root.operation === 'deploy' && rollback.result === 'succeeded')) reject('interrupted outcome requires proved staging compensation');
  if (recovery.cleanup_status === 'proved' && rollback.result !== 'succeeded') reject('proved cleanup requires successful rollback');
  if (['failed', 'not_available'].includes(rollback.result) && recovery.cleanup_status !== 'failed') reject('failed or unavailable rollback requires failed cleanup');
  if (recovery.cleanup_status === 'failed' && !['failed', 'not_available'].includes(rollback.result)) reject('failed cleanup requires failed or unavailable rollback');
  if (recovery.cleanup_status === 'failed' && root.outcome === 'succeeded') reject('successful outcome cannot claim failed cleanup');

  const walk = (node) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') {
      if (typeof node === 'string' && node.startsWith('/')) reject('private or absolute paths are forbidden');
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      if (!ALLOWED_KEYS.has(key) || /secret|token|password|private.*path/i.test(key)) reject('secret or private-path fields are forbidden');
      walk(child);
    }
  };
  walk(root);
  return root;
}

export function withMeasuredProbes(draft, measure) {
  if (typeof measure !== 'function') reject('probe measurement callback is required');
  const probes = measure();
  if (!probes || typeof probes !== 'object') reject('probe measurement is absent');
  for (const key of ['health', 'readiness']) choice(probes[key], ['passed', 'failed', 'not_observed'], `${key} probe`);
  return { ...draft, probes: { health: probes.health, readiness: probes.readiness } };
}
