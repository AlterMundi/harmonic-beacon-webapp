import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export class ReceiptError extends Error {}

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const DECIMAL_ID = /^[1-9][0-9]{0,19}$/;
const CANONICAL_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TARGET = 'analytics-production';
const WORKFLOW_REF = 'AlterMundi/harmonic-beacon-webapp/.github/workflows/analytics-delivery.yml@refs/heads/release';
const EVIDENCE_KINDS = ['health', 'readiness', 'backup', 'isolated-restore', 'monitor', 'notification-state'];

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

function exactSha40(value, name) {
  if (!SHA40.test(value ?? '')) fail(`${name} must be an exact source SHA`);
}

function exactSha256(value, name) {
  if (!SHA256.test(value ?? '')) fail(`${name} must be an exact sha256 digest`);
}

function exactId(value, name) {
  if (!DECIMAL_ID.test(value ?? '')) fail(`${name} must be an exact decimal run id`);
}

function exactAttempt(value, name) {
  if (!Number.isInteger(value) || value < 1 || value > 9999999999) fail(`${name} must be a positive integer`);
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
  if (/(?:secret|token|password|credential|private.?path)/iu.test(key)) fail(`receipt contains prohibited key ${key}`);
  if (typeof value === 'string') {
    if (value.startsWith('/') || /(?:secret|token|password|credential)\s*=/iu.test(value)) fail('receipt contains a secret or private path');
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

function validateDeploymentState(state, name) {
  exactKeys(state, ['sourceSha', 'imageId', 'digest', 'configSha256'], name);
  exactSha40(state.sourceSha, `${name}.sourceSha`);
  exactSha256(state.imageId, `${name}.imageId`);
  exactSha256(state.digest, `${name}.digest`);
  exactSha256(state.configSha256, `${name}.configSha256`);
}

function equal(actual, expected, message) {
  if (actual !== expected) fail(message);
}

function evidenceDigest(body) {
  return `sha256:${createHash('sha256').update(body).digest('hex')}`;
}

function validateEvidenceObject(entry, receipt, nowMs, maxEvidenceAgeSeconds) {
  exactKeys(entry, ['sha256', 'body'], 'evidence object');
  exactSha256(entry.sha256, 'evidence object digest');
  if (typeof entry.body !== 'string' || !entry.body.endsWith('\n') || Buffer.byteLength(entry.body) > 65536) {
    fail('evidence object body is not bounded canonical JSON');
  }
  equal(evidenceDigest(entry.body), entry.sha256, 'evidence digest does not match exact object bytes');
  let value;
  try { value = JSON.parse(entry.body); } catch { fail('evidence object is not JSON'); }
  rejectSensitive(value);
  exactKeys(value, ['schemaVersion', 'kind', 'binding', 'observedAt', 'facts'], 'evidence');
  equal(value.schemaVersion, 'hb.analytics.delivery-evidence.v1', 'unsupported evidence schema');
  if (!EVIDENCE_KINDS.includes(value.kind)) fail('unknown evidence kind');
  exactKeys(value.binding, ['target', 'operation', 'runId', 'runAttempt'], 'evidence binding');
  equal(value.binding.target, receipt.target, 'evidence target differs from receipt');
  equal(value.binding.operation, receipt.operation, 'evidence operation differs from receipt');
  equal(value.binding.runId, receipt.provenance.delivery.runId, 'evidence run id differs from receipt');
  equal(value.binding.runAttempt, receipt.provenance.delivery.runAttempt, 'evidence run attempt differs from receipt');
  observed(value.observedAt, `${value.kind} evidence`, nowMs, maxEvidenceAgeSeconds);
  object(value.facts, `${value.kind} facts`);
  return value;
}

function validateMeasuredEvidence(receipt, evidenceByKind, observedState) {
  for (const kind of EVIDENCE_KINDS) {
    const expectedDigest = receipt.evidence[kind];
    exactSha256(expectedDigest, `${kind} evidence digest`);
    const entry = evidenceByKind.get(kind);
    if (!entry || entry.sha256 !== expectedDigest) fail(`${kind} evidence object is missing or foreign`);
  }

  for (const [kind, status] of [['health', 'ok'], ['readiness', 'ready']]) {
    const facts = evidenceByKind.get(kind).value.facts;
    exactKeys(facts, ['status', 'sourceSha', 'imageId', 'digest', 'configSha256', 'responseSha256'], `${kind} facts`);
    exactSha256(facts.responseSha256, `${kind} response digest`);
    equal(facts.status, status, `${kind} status is not measured healthy`);
    equal(facts.sourceSha, observedState.sourceSha, `${kind} source provenance mismatch`);
    equal(facts.imageId, observedState.imageId, `${kind} image ID provenance mismatch`);
    equal(facts.digest, observedState.digest, `${kind} digest provenance mismatch`);
    equal(facts.configSha256, observedState.configSha256, `${kind} config provenance mismatch`);
  }

  const backup = evidenceByKind.get('backup').value.facts;
  exactKeys(backup, ['checksumSha256', 'bytes', 'ageSeconds'], 'backup facts');
  exactSha256(backup.checksumSha256, 'backup checksum');
  if (!Number.isSafeInteger(backup.bytes) || backup.bytes <= 0) fail('backup bytes were not measured');
  if (!Number.isInteger(backup.ageSeconds) || backup.ageSeconds < 0 || backup.ageSeconds > 28800) fail('backup is stale');

  const restore = evidenceByKind.get('isolated-restore').value.facts;
  exactKeys(restore, ['status', 'profile', 'backupChecksumSha256', 'observedTables', 'cleanupObserved'], 'isolated restore facts');
  equal(restore.status, 'passed', 'isolated restore did not pass');
  equal(restore.profile, 'analytics-synthetic-restore', 'restore target is not isolated');
  equal(restore.backupChecksumSha256, backup.checksumSha256, 'isolated restore used a foreign backup');
  if (!Number.isInteger(restore.observedTables) || restore.observedTables < 10) fail('isolated restore catalog observation is insufficient');
  equal(restore.cleanupObserved, true, 'isolated restore cleanup was not observed');

  const monitor = evidenceByKind.get('monitor').value.facts;
  exactKeys(monitor, ['status', 'exitCode', 'outputSha256'], 'monitor facts');
  equal(monitor.status, 'passed', 'monitor did not pass');
  equal(monitor.exitCode, 0, 'monitor exit code did not pass');
  exactSha256(monitor.outputSha256, 'monitor output digest');

  const notification = evidenceByKind.get('notification-state').value.facts;
  exactKeys(notification, ['route', 'phase', 'recipientDelivery'], 'notification facts');
  equal(notification.route, 'alertmanager', 'notification route is foreign');
  equal(notification.phase, 'healthy', 'notification state has unresolved failure');
  equal(notification.recipientDelivery, receipt.recipientDelivery, 'recipient evidence differs from receipt');
  if (receipt.recipientDelivery !== 'unproven') fail('recipient delivery remains unproven');
}

export async function validateReceiptBundle(bundle, expected) {
  const expectedKeys = [
    'sourceSha', 'artifactImageId', 'artifactDigest', 'configSha256', 'target', 'operation',
    'ciRunId', 'ciRunAttempt', 'buildRunId', 'buildRunAttempt', 'runId', 'runAttempt',
    'now', 'maxEvidenceAgeSeconds',
  ];
  exactKeys(expected, expectedKeys, 'expected evidence binding');
  const nowMs = timestampMillis(expected.now, 'expected evidence clock');
  if (!Number.isInteger(expected.maxEvidenceAgeSeconds) || expected.maxEvidenceAgeSeconds <= 0) fail('invalid evidence clock');

  exactKeys(bundle, ['receipt', 'evidence'], 'receipt bundle');
  if (!Array.isArray(bundle.evidence) || bundle.evidence.length !== EVIDENCE_KINDS.length) fail('receipt evidence inventory is incomplete');
  const receipt = object(bundle.receipt, 'receipt');
  rejectSensitive(receipt);
  exactKeys(receipt, [
    'schemaVersion', 'service', 'evidenceStatus', 'observedAt', 'target', 'operation', 'sourceSha',
    'artifact', 'configSha256', 'deployment', 'provenance', 'evidence', 'rollback', 'recipientDelivery',
  ], 'receipt');
  equal(receipt.schemaVersion, 'hb.analytics.delivery-recovery-receipt.v2', 'unsupported receipt schema');
  equal(receipt.service, 'analytics', 'receipt is for a foreign service');
  equal(receipt.evidenceStatus, 'current', 'receipt is not current evidence');
  observed(receipt.observedAt, 'receipt evidence', nowMs, expected.maxEvidenceAgeSeconds);
  equal(receipt.target, TARGET, 'receipt target is foreign');
  equal(receipt.target, expected.target, 'receipt target does not match current attempt');
  if (!['deploy', 'rollback'].includes(receipt.operation)) fail('receipt operation is invalid');
  equal(receipt.operation, expected.operation, 'receipt operation does not match current attempt');
  exactSha40(receipt.sourceSha, 'source SHA');
  equal(receipt.sourceSha, expected.sourceSha, 'source SHA does not match current attempt');

  exactKeys(receipt.artifact, ['imageId', 'digest', 'revision'], 'artifact');
  exactSha256(receipt.artifact.imageId, 'artifact image ID');
  exactSha256(receipt.artifact.digest, 'artifact digest');
  exactSha40(receipt.artifact.revision, 'artifact revision');
  equal(receipt.artifact.imageId, expected.artifactImageId, 'artifact image ID does not match current attempt');
  equal(receipt.artifact.digest, expected.artifactDigest, 'artifact digest does not match current attempt');
  equal(receipt.artifact.revision, receipt.sourceSha, 'artifact revision does not match source SHA');
  exactSha256(receipt.configSha256, 'config hash');
  equal(receipt.configSha256, expected.configSha256, 'config hash does not match current attempt');

  exactKeys(receipt.deployment, ['previous', 'current'], 'deployment');
  validateDeploymentState(receipt.deployment.previous, 'deployment.previous');
  validateDeploymentState(receipt.deployment.current, 'deployment.current');

  exactKeys(receipt.provenance, ['ci', 'build', 'delivery'], 'provenance');
  exactKeys(receipt.provenance.ci, ['workflow', 'runId', 'runAttempt'], 'CI provenance');
  equal(receipt.provenance.ci.workflow, 'CI', 'CI workflow is foreign');
  exactId(receipt.provenance.ci.runId, 'CI run id');
  exactAttempt(receipt.provenance.ci.runAttempt, 'CI run attempt');
  equal(receipt.provenance.ci.runId, expected.ciRunId, 'CI run id does not match current attempt');
  equal(receipt.provenance.ci.runAttempt, expected.ciRunAttempt, 'CI run attempt does not match current attempt');

  exactKeys(receipt.provenance.build, ['workflow', 'runId', 'runAttempt', 'subjectDigest'], 'build provenance');
  equal(receipt.provenance.build.workflow, 'Analytics OCI Build', 'build workflow is foreign');
  exactId(receipt.provenance.build.runId, 'build run id');
  exactAttempt(receipt.provenance.build.runAttempt, 'build run attempt');
  exactSha256(receipt.provenance.build.subjectDigest, 'build subject digest');
  equal(receipt.provenance.build.runId, expected.buildRunId, 'build run id does not match current attempt');
  equal(receipt.provenance.build.runAttempt, expected.buildRunAttempt, 'build run attempt does not match current attempt');
  equal(receipt.provenance.build.subjectDigest, receipt.artifact.digest, 'build subject digest differs from artifact');

  exactKeys(receipt.provenance.delivery, ['workflowRef', 'runId', 'runAttempt'], 'delivery provenance');
  equal(receipt.provenance.delivery.workflowRef, WORKFLOW_REF, 'delivery workflow ref is foreign');
  exactId(receipt.provenance.delivery.runId, 'delivery run id');
  exactAttempt(receipt.provenance.delivery.runAttempt, 'delivery run attempt');
  equal(receipt.provenance.delivery.runId, expected.runId, 'delivery run id does not match current attempt');
  equal(receipt.provenance.delivery.runAttempt, expected.runAttempt, 'delivery run attempt does not match current attempt');

  exactKeys(receipt.evidence, EVIDENCE_KINDS, 'receipt evidence');
  const evidenceByKind = new Map();
  for (const entry of bundle.evidence) {
    const value = validateEvidenceObject(entry, receipt, nowMs, expected.maxEvidenceAgeSeconds);
    if (evidenceByKind.has(value.kind)) fail(`duplicate ${value.kind} evidence`);
    evidenceByKind.set(value.kind, { ...entry, value });
  }
  const observedState = receipt.operation === 'rollback'
    ? receipt.deployment.current
    : { sourceSha: receipt.sourceSha, imageId: receipt.artifact.imageId, digest: receipt.artifact.digest, configSha256: receipt.configSha256 };
  validateMeasuredEvidence(receipt, evidenceByKind, observedState);

  exactKeys(receipt.rollback, ['required', 'performed', 'status', 'reversedRunId', 'reversedRunAttempt'], 'rollback');
  if (typeof receipt.rollback.required !== 'boolean' || typeof receipt.rollback.performed !== 'boolean') fail('rollback booleans are invalid');
  if (receipt.operation === 'rollback') {
    equal(receipt.rollback.required, true, 'rollback operation must require rollback');
    equal(receipt.rollback.performed, true, 'rollback operation is not measured complete');
    equal(receipt.rollback.status, 'passed', 'rollback operation did not pass');
    exactId(receipt.rollback.reversedRunId, 'reversed deployment run id');
    exactAttempt(receipt.rollback.reversedRunAttempt, 'reversed deployment run attempt');
    const namedDeployment = {
      sourceSha: receipt.sourceSha, imageId: receipt.artifact.imageId,
      digest: receipt.artifact.digest, configSha256: receipt.configSha256,
    };
    if (JSON.stringify(receipt.deployment.previous) !== JSON.stringify(namedDeployment)) fail('rollback did not begin from the named deployment');
    if (JSON.stringify(receipt.deployment.current) === JSON.stringify(receipt.deployment.previous)) fail('rollback did not restore a distinct exact previous state');
  } else {
    equal(receipt.rollback.required, false, 'successful operation unexpectedly requires rollback');
    equal(receipt.rollback.performed, false, 'successful operation unexpectedly performed rollback');
    equal(receipt.rollback.status, 'not-required', 'rollback evidence is inconsistent');
    equal(receipt.rollback.reversedRunId, null, 'successful operation carries a reversal run id');
    equal(receipt.rollback.reversedRunAttempt, null, 'successful operation carries a reversal run attempt');
    if (receipt.operation === 'deploy' && JSON.stringify(receipt.deployment.current) !== JSON.stringify({
      sourceSha: receipt.sourceSha, imageId: receipt.artifact.imageId, digest: receipt.artifact.digest, configSha256: receipt.configSha256,
    })) fail('deployment current state does not match the admitted artifact and config');
  }
  return receipt;
}

// v1 receipts are historical only and cannot satisfy the current evidence API.
export function validateCurrentReceipt() {
  fail('v1 receipt validation is retired; validate a content-addressed v2 receipt bundle');
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv.length !== 3 || process.argv[2] !== 'validate') {
    process.stderr.write('usage: delivery-receipt.mjs validate < receipt-bundle.json\n');
    process.exit(2);
  }
  try {
    const bundle = JSON.parse(await readStdin());
    const expected = JSON.parse(await readFile(process.env.ANALYTICS_RECEIPT_EXPECTED_FILE, 'utf8'));
    await validateReceiptBundle(bundle, expected);
    process.stdout.write(`${JSON.stringify(bundle.receipt)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'invalid receipt'}\n`);
    process.exit(1);
  }
}
