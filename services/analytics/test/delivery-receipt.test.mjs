import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ReceiptError, validateCurrentReceipt } from '../src/delivery-receipt.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const IMAGE_ID = `sha256:${'b'.repeat(64)}`;
const IMAGE_DIGEST = `sha256:${'c'.repeat(64)}`;
const CONFIG_SHA = `sha256:${'d'.repeat(64)}`;
const BACKUP_SHA = `sha256:${'e'.repeat(64)}`;
const OBSERVED_AT = '2026-09-10T21:00:00.000Z';

function receipt(overrides = {}) {
  return {
    schemaVersion: 'hb.analytics.delivery-recovery-receipt.v1',
    service: 'analytics',
    evidenceStatus: 'current',
    observedAt: OBSERVED_AT,
    sourceSha: SOURCE_SHA,
    artifact: { imageId: IMAGE_ID, digest: IMAGE_DIGEST, revision: SOURCE_SHA },
    configSha256: CONFIG_SHA,
    deployment: {
      previous: { sourceSha: 'f'.repeat(40), digest: `sha256:${'1'.repeat(64)}` },
      current: { sourceSha: SOURCE_SHA, digest: IMAGE_DIGEST },
    },
    health: { status: 'ok', provenanceVerified: true, observedAt: OBSERVED_AT },
    readiness: { status: 'ready', provenanceVerified: true, observedAt: OBSERVED_AT },
    backup: { checksumSha256: BACKUP_SHA, ageSeconds: 900, observedAt: OBSERVED_AT },
    isolatedRestore: {
      status: 'passed', profile: 'analytics-synthetic',
      backupChecksumSha256: BACKUP_SHA, proofId: 'restore-20260910-a1', observedAt: OBSERVED_AT,
    },
    monitor: { status: 'passed', proofId: 'monitor-20260910-a1', observedAt: OBSERVED_AT },
    alertRecipient: {
      status: 'proven', route: 'alertmanager', failureProofId: 'alert-failure-a1',
      recoveryProofId: 'alert-recovery-a1', observedAt: OBSERVED_AT,
    },
    workflow: {
      repository: 'AlterMundi/harmonic-beacon-webapp',
      workflowRef: 'AlterMundi/harmonic-beacon-webapp/.github/workflows/analytics-delivery.yml@refs/heads/release',
      runId: '123456789', runAttempt: 2, ciRunId: '123456700',
    },
    rollback: {
      required: false, performed: false, status: 'not-required',
      previousDigest: `sha256:${'1'.repeat(64)}`,
    },
    ...overrides,
  };
}

const expected = {
  sourceSha: SOURCE_SHA,
  artifactImageId: IMAGE_ID,
  artifactDigest: IMAGE_DIGEST,
  configSha256: CONFIG_SHA,
  runId: '123456789',
  runAttempt: 2,
  ciRunId: '123456700',
  now: '2026-09-10T21:05:00.000Z',
  maxEvidenceAgeSeconds: 1800,
};

test('delivery receipt schema is closed and versioned', async () => {
  const schema = JSON.parse(await readFile(new URL('../../../contracts/analytics-delivery/v1/receipt.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schemaVersion.const, 'hb.analytics.delivery-recovery-receipt.v1');
  assert.deepEqual(schema.required.includes('isolatedRestore'), true);
  assert.deepEqual(schema.required.includes('alertRecipient'), true);
});

test('current delivery receipt binds source, OCI evidence, workflow run and attempt', () => {
  assert.deepEqual(validateCurrentReceipt(receipt(), expected), receipt());
  assert.throws(() => validateCurrentReceipt(receipt({ sourceSha: '9'.repeat(40) }), expected), /source SHA/);
  assert.throws(() => validateCurrentReceipt(receipt({ artifact: { imageId: `sha256:${'7'.repeat(64)}`, digest: IMAGE_DIGEST, revision: SOURCE_SHA } }), expected), /image ID/);
  assert.throws(() => validateCurrentReceipt(receipt({ artifact: { imageId: IMAGE_ID, digest: `sha256:${'8'.repeat(64)}`, revision: SOURCE_SHA } }), expected), /artifact digest/);
  assert.throws(() => validateCurrentReceipt(receipt({ configSha256: `sha256:${'9'.repeat(64)}` }), expected), /config hash/);
  assert.throws(() => validateCurrentReceipt(receipt({ workflow: { ...receipt().workflow, ciRunId: '123456701' } }), expected), /CI run/);
  assert.throws(() => validateCurrentReceipt(receipt({ workflow: { ...receipt().workflow, runAttempt: 1 } }), expected), /run attempt/);
});

test('rollback evidence preserves attempted artifact while proving restoration of previous deployment', () => {
  const rolledBack = receipt({
    deployment: { previous: receipt().deployment.previous, current: receipt().deployment.previous },
    rollback: { required: true, performed: true, status: 'passed', previousDigest: receipt().deployment.previous.digest },
  });
  assert.deepEqual(validateCurrentReceipt(rolledBack, expected), rolledBack);
  assert.throws(() => validateCurrentReceipt(receipt({
    rollback: { required: true, performed: true, status: 'passed', previousDigest: receipt().deployment.previous.digest },
  }), expected), /rollback current deployment/);
  assert.throws(() => validateCurrentReceipt(receipt({
    rollback: { ...receipt().rollback, previousDigest: `sha256:${'2'.repeat(64)}` },
  }), expected), /rollback previous digest/);
});

test('historical, stale, missing recovery, and unproven recipient evidence cannot be current', () => {
  assert.throws(() => validateCurrentReceipt(receipt({ evidenceStatus: 'historical' }), expected), /current evidence/);
  assert.throws(() => validateCurrentReceipt(receipt({ observedAt: 'September 10, 2026 21:00 UTC' }), expected), /RFC3339/);
  assert.throws(() => validateCurrentReceipt(receipt({ observedAt: '2026-09-09T20:00:00.000Z' }), expected), /stale/);
  const missingRestore = receipt();
  delete missingRestore.isolatedRestore;
  assert.throws(() => validateCurrentReceipt(missingRestore, expected), /isolated restore/);
  assert.throws(() => validateCurrentReceipt(receipt({ alertRecipient: { ...receipt().alertRecipient, status: 'unproven' } }), expected), /recipient delivery/);
});

test('receipt rejects secret-shaped keys, values, and private paths recursively', () => {
  assert.throws(() => validateCurrentReceipt(receipt({ note: '/home/operator/private' }), expected), ReceiptError);
  assert.throws(() => validateCurrentReceipt(receipt({ token: 'opaque' }), expected), ReceiptError);
  assert.throws(() => validateCurrentReceipt(receipt({ monitor: { ...receipt().monitor, proofId: 'password=hidden' } }), expected), ReceiptError);
});
