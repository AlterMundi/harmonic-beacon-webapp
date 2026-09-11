import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ReceiptError, validateReceiptBundle } from '../src/delivery-receipt.mjs';

const SOURCE_SHA = 'a'.repeat(40);
const IMAGE_ID = `sha256:${'b'.repeat(64)}`;
const IMAGE_DIGEST = `sha256:${'c'.repeat(64)}`;
const CONFIG_SHA = `sha256:${'d'.repeat(64)}`;
const BACKUP_SHA = `sha256:${'e'.repeat(64)}`;
const PREVIOUS = {
  sourceSha: 'f'.repeat(40), imageId: `sha256:${'1'.repeat(64)}`,
  digest: `sha256:${'2'.repeat(64)}`, configSha256: `sha256:${'3'.repeat(64)}`,
};
const OBSERVED_AT = '2026-09-10T21:00:00.000Z';
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function evidence(kind, facts, operation = 'deploy') {
  const body = `${JSON.stringify({
    schemaVersion: 'hb.analytics.delivery-evidence.v1', kind,
    binding: { target: 'analytics-production', operation, runId: '123456789', runAttempt: 2 },
    observedAt: OBSERVED_AT, facts,
  })}\n`;
  return { sha256: sha256(body), body };
}

function bundle(operation = 'deploy') {
  const current = operation === 'deploy'
    ? { sourceSha: SOURCE_SHA, imageId: IMAGE_ID, digest: IMAGE_DIGEST, configSha256: CONFIG_SHA }
    : PREVIOUS;
  const objects = [
    evidence('health', { status: 'ok', ...current, responseSha256: `sha256:${'5'.repeat(64)}` }, operation),
    evidence('readiness', { status: 'ready', ...current, responseSha256: `sha256:${'6'.repeat(64)}` }, operation),
    evidence('backup', { checksumSha256: BACKUP_SHA, bytes: 8192, ageSeconds: 900 }, operation),
    evidence('isolated-restore', { status: 'passed', profile: 'analytics-synthetic-restore', backupChecksumSha256: BACKUP_SHA, observedTables: 12, cleanupObserved: true }, operation),
    evidence('monitor', { status: 'passed', exitCode: 0, outputSha256: `sha256:${'4'.repeat(64)}` }, operation),
    evidence('notification-state', { route: 'alertmanager', phase: 'healthy', recipientDelivery: 'unproven' }, operation),
  ];
  const receipt = {
    schemaVersion: 'hb.analytics.delivery-recovery-receipt.v2', service: 'analytics', evidenceStatus: 'current',
    observedAt: OBSERVED_AT, target: 'analytics-production', operation, sourceSha: SOURCE_SHA,
    artifact: { imageId: IMAGE_ID, digest: IMAGE_DIGEST, revision: SOURCE_SHA }, configSha256: CONFIG_SHA,
    deployment: {
      previous: operation === 'deploy' ? PREVIOUS : { sourceSha: SOURCE_SHA, imageId: IMAGE_ID, digest: IMAGE_DIGEST, configSha256: CONFIG_SHA },
      current,
    },
    provenance: {
      ci: { workflow: 'CI', runId: '123456700', runAttempt: 3 },
      build: { workflow: 'Analytics OCI Build', runId: '123456750', runAttempt: 4, subjectDigest: IMAGE_DIGEST },
      delivery: { workflowRef: 'AlterMundi/harmonic-beacon-webapp/.github/workflows/analytics-delivery.yml@refs/heads/release', runId: '123456789', runAttempt: 2 },
    },
    evidence: Object.fromEntries(objects.map((object) => [JSON.parse(object.body).kind, object.sha256])),
    rollback: operation === 'deploy'
      ? { required: false, performed: false, status: 'not-required', reversedRunId: null, reversedRunAttempt: null }
      : { required: true, performed: true, status: 'passed', reversedRunId: '123456780', reversedRunAttempt: 1 },
    recipientDelivery: 'unproven',
  };
  return { receipt, evidence: objects };
}

function expected(operation = 'deploy') {
  return {
    sourceSha: SOURCE_SHA, artifactImageId: IMAGE_ID, artifactDigest: IMAGE_DIGEST, configSha256: CONFIG_SHA,
    target: 'analytics-production', operation, ciRunId: '123456700', ciRunAttempt: 3,
    buildRunId: '123456750', buildRunAttempt: 4, runId: '123456789', runAttempt: 2,
    now: '2026-09-10T21:05:00.000Z', maxEvidenceAgeSeconds: 1800,
  };
}

test('delivery receipt schema is closed content-addressed and versioned', async () => {
  const schema = JSON.parse(await readFile(new URL('../../../contracts/analytics-delivery/v2/receipt.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.schemaVersion.const, 'hb.analytics.delivery-recovery-receipt.v2');
  assert.deepEqual(schema.required.includes('evidence'), true);
  assert.deepEqual(schema.required.includes('provenance'), true);
  assert.equal(schema.properties.recipientDelivery.const, 'unproven');
});

test('current delivery receipt binds OCI subject plus CI build and delivery attempts', async () => {
  const value = bundle();
  assert.deepEqual(await validateReceiptBundle(value, expected()), value.receipt);
  const wrongSource = structuredClone(value);
  wrongSource.receipt.sourceSha = '9'.repeat(40);
  await assert.rejects(validateReceiptBundle(wrongSource, expected()), /source SHA/);
  const wrongBuildAttempt = structuredClone(value);
  wrongBuildAttempt.receipt.provenance.build.runAttempt = 5;
  await assert.rejects(validateReceiptBundle(wrongBuildAttempt, expected()), /build run attempt/);
  const wrongDeliveryAttempt = structuredClone(value);
  wrongDeliveryAttempt.receipt.provenance.delivery.runAttempt = 1;
  await assert.rejects(validateReceiptBundle(wrongDeliveryAttempt, expected()), /delivery run attempt/);
});

test('rollback receipt preserves attempted artifact while proving distinct exact previous config restoration', async () => {
  const rolledBack = bundle('rollback');
  assert.deepEqual(await validateReceiptBundle(rolledBack, expected('rollback')), rolledBack.receipt);
  const unchanged = structuredClone(rolledBack);
  unchanged.receipt.deployment.current = structuredClone(unchanged.receipt.deployment.previous);
  for (const entry of unchanged.evidence.slice(0, 2)) {
    const parsed = JSON.parse(entry.body);
    parsed.facts = {
      status: parsed.facts.status,
      ...unchanged.receipt.deployment.current,
      responseSha256: parsed.facts.responseSha256,
    };
    entry.body = `${JSON.stringify(parsed)}\n`;
    entry.sha256 = sha256(entry.body);
    unchanged.receipt.evidence[parsed.kind] = entry.sha256;
  }
  await assert.rejects(validateReceiptBundle(unchanged, expected('rollback')), /distinct exact previous state/);
});

test('historical stale missing and content-substituted evidence cannot be current', async () => {
  const historical = bundle();
  historical.receipt.evidenceStatus = 'historical';
  await assert.rejects(validateReceiptBundle(historical, expected()), /current evidence/);
  const stale = bundle();
  stale.receipt.observedAt = '2026-09-09T20:00:00.000Z';
  await assert.rejects(validateReceiptBundle(stale, expected()), /stale/);
  const missing = bundle();
  missing.evidence.pop();
  await assert.rejects(validateReceiptBundle(missing, expected()), /inventory/);
  const changed = bundle();
  changed.evidence[0].body = changed.evidence[0].body.replace('"ok"', '"failed"');
  await assert.rejects(validateReceiptBundle(changed, expected()), /evidence digest/);
});

test('receipt rejects secret-shaped keys values private paths and fabricated recipient proof', async () => {
  const privatePath = bundle();
  privatePath.receipt.note = '/home/operator/private';
  await assert.rejects(validateReceiptBundle(privatePath, expected()), ReceiptError);
  const token = bundle();
  token.receipt.token = 'opaque';
  await assert.rejects(validateReceiptBundle(token, expected()), ReceiptError);
  const recipient = bundle();
  recipient.receipt.recipientDelivery = 'externally-observed';
  await assert.rejects(validateReceiptBundle(recipient, expected()), /recipient/);
  const fabricatedRecipient = bundle();
  const notification = fabricatedRecipient.evidence.find((entry) => JSON.parse(entry.body).kind === 'notification-state');
  const notificationValue = JSON.parse(notification.body);
  notificationValue.facts.recipientDelivery = 'externally-observed';
  notification.body = `${JSON.stringify(notificationValue)}\n`;
  notification.sha256 = sha256(notification.body);
  fabricatedRecipient.receipt.evidence['notification-state'] = notification.sha256;
  fabricatedRecipient.receipt.recipientDelivery = 'externally-observed';
  await assert.rejects(validateReceiptBundle(fabricatedRecipient, expected()), /recipient delivery remains unproven/);
});
