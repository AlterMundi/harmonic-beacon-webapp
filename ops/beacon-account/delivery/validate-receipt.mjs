#!/usr/bin/env node

import fs from 'node:fs';

const fail = (message) => {
  process.stderr.write(`account-delivery-receipt: ${message}\n`);
  process.exit(1);
};

const sha40 = /^[0-9a-f]{40}$/;
const sha256 = /^[0-9a-f]{64}$/;
const digest = /^sha256:[0-9a-f]{64}$/;
const runId = /^[1-9][0-9]{0,19}$/;
const workflow = /^\.github\/workflows\/[a-z0-9-]+\.yml$/;
const exactKeys = (value, expected, label) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} keys differ from the v1 contract`);
  }
};
const requireValue = (condition, label) => {
  if (!condition) fail(`invalid or missing ${label}`);
};
const validateRun = (value, expectedWorkflow, label) => {
  exactKeys(value, ['run_id', 'workflow', 'attempt'], label);
  requireValue(runId.test(value.run_id), `${label}.run_id`);
  requireValue(value.workflow === expectedWorkflow && workflow.test(value.workflow), `${label}.workflow`);
  requireValue(Number.isInteger(value.attempt) && value.attempt >= 1, `${label}.attempt`);
};

if (process.argv.length !== 3) fail('usage: validate-receipt.mjs receipt.json');
let receipt;
try {
  receipt = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
} catch (error) {
  fail(`cannot read JSON: ${error.message}`);
}

exactKeys(receipt, [
  'schema_version', 'evidence_scope', 'service', 'target', 'operation',
  'source_sha', 'artifact', 'config_contract_sha256', 'revisions', 'backup',
  'checks', 'actions', 'rollback', 'interruption',
], 'receipt');
requireValue(receipt.schema_version === 'account-delivery-receipt.v1', 'schema_version');
requireValue([
  'runtime', 'synthetic-interruption', 'synthetic-contract-fixture',
].includes(receipt.evidence_scope), 'evidence_scope');
requireValue(receipt.service === 'beacon-account', 'service');
requireValue(['staging', 'production'].includes(receipt.target), 'target');
requireValue(['deploy', 'interruption-checkpoint'].includes(receipt.operation), 'operation');
requireValue(sha40.test(receipt.source_sha), 'source_sha');

exactKeys(receipt.artifact, ['image_id', 'digest'], 'artifact');
requireValue(digest.test(receipt.artifact.image_id), 'artifact.image_id');
requireValue(
  digest.test(receipt.artifact.digest) || receipt.artifact.digest === 'unavailable-local-build',
  'artifact.digest',
);
requireValue(sha256.test(receipt.config_contract_sha256), 'config_contract_sha256');

exactKeys(receipt.revisions, ['previous', 'current'], 'revisions');
requireValue(receipt.revisions.previous === null || sha40.test(receipt.revisions.previous), 'revisions.previous');
requireValue(sha40.test(receipt.revisions.current), 'revisions.current');

exactKeys(receipt.backup, ['encrypted_sha256', 'isolated_restore'], 'backup');
requireValue(sha256.test(receipt.backup.encrypted_sha256), 'backup.encrypted_sha256');
exactKeys(receipt.backup.isolated_restore, ['status', 'mode', 'cleanup'], 'backup.isolated_restore');
requireValue(receipt.backup.isolated_restore.status === 'verified', 'backup.isolated_restore.status');
requireValue(receipt.backup.isolated_restore.mode === 'isolated-ephemeral-postgres', 'backup.isolated_restore.mode');
requireValue(receipt.backup.isolated_restore.cleanup === 'verified', 'backup.isolated_restore.cleanup');

exactKeys(receipt.checks, ['health', 'worker', 'smoke'], 'checks');
for (const check of ['health', 'worker', 'smoke']) {
  requireValue(receipt.checks[check] === 'verified', `checks.${check}`);
}
exactKeys(receipt.actions, ['ci', 'delivery'], 'actions');
validateRun(receipt.actions.ci, '.github/workflows/early-birds-fast-forward.yml', 'actions.ci');
validateRun(receipt.actions.delivery, '.github/workflows/account-delivery.yml', 'actions.delivery');

exactKeys(receipt.rollback, ['result', 'revision'], 'rollback');
requireValue(['not-required', 'verified'].includes(receipt.rollback.result), 'rollback.result');
requireValue(receipt.rollback.revision === null || sha40.test(receipt.rollback.revision), 'rollback.revision');
if (receipt.rollback.result === 'verified') {
  requireValue(sha40.test(receipt.rollback.revision ?? ''), 'rollback.revision');
  requireValue(receipt.revisions.current === receipt.rollback.revision, 'rollback current revision binding');
}

if (receipt.operation === 'interruption-checkpoint') {
  exactKeys(receipt.interruption, [
    'checkpoint', 'expected_failure_observed', 'synthetic_inputs', 'cleanup',
  ], 'interruption');
  requireValue(receipt.target === 'staging', 'interruption target');
  requireValue(receipt.evidence_scope !== 'runtime', 'interruption evidence_scope');
  requireValue(receipt.interruption.checkpoint === 'after-cutover', 'interruption.checkpoint');
  requireValue(receipt.interruption.expected_failure_observed === true, 'interruption.expected_failure_observed');
  requireValue(receipt.interruption.synthetic_inputs === true, 'interruption.synthetic_inputs');
  requireValue(receipt.interruption.cleanup === 'verified', 'interruption.cleanup');
  requireValue(receipt.rollback.result === 'verified', 'interruption rollback result');
} else {
  requireValue(receipt.interruption === null, 'interruption');
}

const forbiddenKey = /(?:password|secret|token|authorization)/i;
const privatePath = /^\/(?:etc|home|mnt|opt|run|var)\//;
const walk = (value, key = '') => {
  requireValue(!forbiddenKey.test(key), `forbidden key ${key}`);
  if (typeof value === 'string') requireValue(!privatePath.test(value), `private path in ${key}`);
  if (Array.isArray(value)) value.forEach((entry) => walk(entry, key));
  else if (value && typeof value === 'object') {
    for (const [childKey, child] of Object.entries(value)) walk(child, childKey);
  }
};
walk(receipt);
