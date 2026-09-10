export class ReceiptError extends Error {}

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const PROOF_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DECIMAL_ID = /^[1-9][0-9]{0,19}$/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const WORKFLOW_REF = 'AlterMundi/harmonic-beacon-webapp/.github/workflows/analytics-delivery.yml@refs/heads/release';

function fail(message) {
  throw new ReceiptError(message);
}

function object(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${name} is required`);
  return value;
}

function exactKeys(value, required, name) {
  const keys = Object.keys(object(value, name));
  for (const key of required) if (!keys.includes(key)) fail(`${name}.${key} is required`);
  for (const key of keys) if (!required.includes(key)) fail(`${name}.${key} is not allowed`);
}

function sha40(value, name) {
  if (!SHA40.test(value ?? '')) fail(`${name} must be an exact source SHA`);
}

function sha256(value, name) {
  if (!SHA256.test(value ?? '')) fail(`${name} must be an exact sha256 digest`);
}

function proof(value, name) {
  if (!PROOF_ID.test(value ?? '')) fail(`${name} is not a safe opaque proof id`);
}

function timestampMillis(value, name) {
  if (!CANONICAL_TIMESTAMP.test(value ?? '')) fail(`${name} must be a canonical RFC3339 timestamp`);
  const instant = Date.parse(value);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== value) fail(`${name} must be a canonical RFC3339 timestamp`);
  return instant;
}

function observed(value, name, nowMs, maxAgeSeconds) {
  const instant = timestampMillis(value, name);
  const age = (nowMs - instant) / 1000;
  if (age < 0 || age > maxAgeSeconds) fail(`${name} is stale or from the future`);
}

function rejectSensitive(value, key = '') {
  if (/(?:secret|token|password|credential|private.?path)/i.test(key)) fail(`receipt contains prohibited key ${key}`);
  if (typeof value === 'string') {
    if (value.startsWith('/') || /(?:secret|token|password|credential)\s*=/i.test(value)) {
      fail('receipt contains a secret or private path');
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) rejectSensitive(item, key);
    return;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) rejectSensitive(childValue, childKey);
  }
}

export function validateCurrentReceipt(receipt, expected) {
  const requiredExpected = [
    'sourceSha', 'artifactImageId', 'artifactDigest', 'configSha256', 'runId',
    'runAttempt', 'ciRunId', 'now', 'maxEvidenceAgeSeconds',
  ];
  exactKeys(expected, requiredExpected, 'expected evidence binding');
  const nowMs = timestampMillis(expected.now, 'expected evidence clock');
  if (!Number.isInteger(expected.maxEvidenceAgeSeconds) || expected.maxEvidenceAgeSeconds <= 0) {
    fail('invalid evidence clock');
  }

  rejectSensitive(receipt);
  object(receipt, 'receipt');
  if (!receipt.isolatedRestore) fail('isolated restore proof is missing');
  if (!receipt.alertRecipient) fail('recipient delivery proof is missing');
  exactKeys(receipt, [
    'schemaVersion', 'service', 'evidenceStatus', 'observedAt', 'sourceSha', 'artifact',
    'configSha256', 'deployment', 'health', 'readiness', 'backup', 'isolatedRestore',
    'monitor', 'alertRecipient', 'workflow', 'rollback',
  ], 'receipt');
  if (receipt.schemaVersion !== 'hb.analytics.delivery-recovery-receipt.v1') fail('unsupported receipt schema');
  if (receipt.service !== 'analytics') fail('receipt is for a foreign service');
  if (receipt.evidenceStatus !== 'current') fail('receipt is not current evidence');
  observed(receipt.observedAt, 'receipt evidence', nowMs, expected.maxEvidenceAgeSeconds);
  sha40(receipt.sourceSha, 'source SHA');
  if (receipt.sourceSha !== expected.sourceSha) fail('source SHA does not match current attempt');

  exactKeys(receipt.artifact, ['imageId', 'digest', 'revision'], 'artifact');
  sha256(receipt.artifact.imageId, 'artifact image ID');
  sha256(receipt.artifact.digest, 'artifact digest');
  sha40(receipt.artifact.revision, 'artifact revision');
  if (receipt.artifact.imageId !== expected.artifactImageId) fail('artifact image ID does not match current attempt');
  if (receipt.artifact.digest !== expected.artifactDigest) fail('artifact digest does not match current attempt');
  if (receipt.artifact.revision !== receipt.sourceSha) fail('artifact revision does not match source SHA');
  sha256(receipt.configSha256, 'config hash');
  if (receipt.configSha256 !== expected.configSha256) fail('config hash does not match current attempt');

  exactKeys(receipt.deployment, ['previous', 'current'], 'deployment');
  for (const state of ['previous', 'current']) {
    exactKeys(receipt.deployment[state], ['sourceSha', 'digest'], `deployment.${state}`);
    sha40(receipt.deployment[state].sourceSha, `deployment.${state}.sourceSha`);
    sha256(receipt.deployment[state].digest, `deployment.${state}.digest`);
  }

  for (const name of ['health', 'readiness']) {
    exactKeys(receipt[name], ['status', 'provenanceVerified', 'observedAt'], name);
    const expectedStatus = name === 'health' ? 'ok' : 'ready';
    if (receipt[name].status !== expectedStatus || receipt[name].provenanceVerified !== true) fail(`${name} is not verified`);
    observed(receipt[name].observedAt, name, nowMs, expected.maxEvidenceAgeSeconds);
  }

  exactKeys(receipt.backup, ['checksumSha256', 'ageSeconds', 'observedAt'], 'backup');
  sha256(receipt.backup.checksumSha256, 'backup checksum');
  if (!Number.isInteger(receipt.backup.ageSeconds) || receipt.backup.ageSeconds < 0 || receipt.backup.ageSeconds > 28800) fail('backup evidence is stale');
  observed(receipt.backup.observedAt, 'backup', nowMs, expected.maxEvidenceAgeSeconds);

  exactKeys(receipt.isolatedRestore, ['status', 'profile', 'backupChecksumSha256', 'proofId', 'observedAt'], 'isolated restore');
  if (receipt.isolatedRestore.status !== 'passed' || receipt.isolatedRestore.profile !== 'analytics-synthetic') fail('isolated restore proof is missing');
  sha256(receipt.isolatedRestore.backupChecksumSha256, 'isolated restore backup checksum');
  if (receipt.isolatedRestore.backupChecksumSha256 !== receipt.backup.checksumSha256) fail('isolated restore used a foreign backup');
  proof(receipt.isolatedRestore.proofId, 'isolated restore proof');
  observed(receipt.isolatedRestore.observedAt, 'isolated restore', nowMs, expected.maxEvidenceAgeSeconds);

  exactKeys(receipt.monitor, ['status', 'proofId', 'observedAt'], 'monitor');
  if (receipt.monitor.status !== 'passed') fail('monitor proof is missing');
  proof(receipt.monitor.proofId, 'monitor proof');
  observed(receipt.monitor.observedAt, 'monitor', nowMs, expected.maxEvidenceAgeSeconds);

  exactKeys(receipt.alertRecipient, ['status', 'route', 'failureProofId', 'recoveryProofId', 'observedAt'], 'alert recipient');
  if (receipt.alertRecipient.status !== 'proven' || receipt.alertRecipient.route !== 'alertmanager') fail('recipient delivery is unproven');
  proof(receipt.alertRecipient.failureProofId, 'failure recipient proof');
  proof(receipt.alertRecipient.recoveryProofId, 'recovery recipient proof');
  observed(receipt.alertRecipient.observedAt, 'alert recipient', nowMs, expected.maxEvidenceAgeSeconds);

  exactKeys(receipt.workflow, ['repository', 'workflowRef', 'runId', 'runAttempt', 'ciRunId'], 'workflow');
  if (receipt.workflow.repository !== 'AlterMundi/harmonic-beacon-webapp' || receipt.workflow.workflowRef !== WORKFLOW_REF) fail('workflow binding is foreign');
  if (!DECIMAL_ID.test(receipt.workflow.runId) || receipt.workflow.runId !== expected.runId) fail('workflow run id does not match current attempt');
  if (!Number.isInteger(receipt.workflow.runAttempt) || receipt.workflow.runAttempt !== expected.runAttempt) fail('workflow run attempt does not match current attempt');
  if (!DECIMAL_ID.test(receipt.workflow.ciRunId) || receipt.workflow.ciRunId !== expected.ciRunId) fail('CI run id does not match current attempt');

  exactKeys(receipt.rollback, ['required', 'performed', 'status', 'previousDigest'], 'rollback');
  sha256(receipt.rollback.previousDigest, 'rollback previous digest');
  if (typeof receipt.rollback.required !== 'boolean' || typeof receipt.rollback.performed !== 'boolean') fail('rollback booleans are invalid');
  if (receipt.rollback.previousDigest !== receipt.deployment.previous.digest) fail('rollback previous digest does not match previous deployment');
  if (receipt.rollback.required) {
    if (!receipt.rollback.performed || receipt.rollback.status !== 'passed') fail('required rollback is not proven');
    if (receipt.deployment.current.sourceSha !== receipt.deployment.previous.sourceSha ||
        receipt.deployment.current.digest !== receipt.deployment.previous.digest) {
      fail('rollback current deployment does not match previous deployment');
    }
  } else {
    if (receipt.rollback.performed || receipt.rollback.status !== 'not-required') fail('rollback evidence is inconsistent');
    if (receipt.deployment.current.sourceSha !== receipt.sourceSha || receipt.deployment.current.digest !== receipt.artifact.digest) {
      fail('deployment current evidence does not match artifact');
    }
  }

  return receipt;
}
