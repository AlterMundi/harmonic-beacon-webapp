#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVICES = new Set(['analytics', 'app', 'commerce-reconciler', 'playlist-bot', 'tapestry']);
const ARTIFACT_FOR_SERVICE = {
  analytics: 'analytics', app: 'app', 'commerce-reconciler': 'app', 'playlist-bot': 'playlist-bot', tapestry: 'tapestry',
};
const IMAGE_REF = /^[a-z0-9./-]+@sha256:[0-9a-f]{64}$/u;
const GIT_SHA = /^[0-9a-f]{40}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function fail(message) {
  throw new Error(`impact recovery: ${message}`);
}

function exactArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string') || new Set(value).size !== value.length) {
    fail(`${label} must be a unique string array`);
  }
  return value;
}

export function validateImpactPlan(plan) {
  if (!plan || plan.schemaVersion !== 'harmonic-beacon.change-impact.v2') fail('unsupported impact plan');
  if (!['documentation', 'ui', 'functional', 'critical'].includes(plan.risk)) fail('invalid risk');
  const deployment = plan.deployment;
  if (!deployment || typeof deployment.deploy !== 'boolean') fail('deployment plan is missing');
  const services = exactArray(deployment.servicesToReplace, 'servicesToReplace');
  for (const service of services) if (!SERVICES.has(service)) fail(`invalid service: ${service}`);
  const reusePrior = exactArray(deployment.reusePriorImages ?? [], 'reusePriorImages');
  for (const service of reusePrior) {
    if (!services.includes(service)) fail(`reuse prior image is not a selected service: ${service}`);
  }
  const artifacts = exactArray(deployment.artifactsToPull, 'artifactsToPull');
  const expectedArtifacts = [...new Set(services.filter((service) => !reusePrior.includes(service)).map((service) => ARTIFACT_FOR_SERVICE[service]))].sort();
  if (JSON.stringify([...artifacts].sort()) !== JSON.stringify(expectedArtifacts)) fail('artifact selection does not match services');
  if (deployment.deploy !== (services.length > 0)) fail('deploy flag does not match services');
  if (!['never', 'verify-pending'].includes(deployment.migration)) fail('invalid migration policy');
  if (!['none', 'image-config', 'backup-restore-if-pending'].includes(deployment.recovery)) fail('invalid recovery policy');
  if (deployment.migration === 'never' && deployment.recovery === 'backup-restore-if-pending') fail('migration and recovery policies conflict');
  if (deployment.migration === 'verify-pending' && deployment.recovery !== 'backup-restore-if-pending') fail('pending migrations require backup/restore policy');
  return plan;
}

function validateMigrationState(state) {
  if (!state || state.schemaVersion !== 'harmonic-beacon.migration-state.v1' || state.databaseStateVerified !== true) {
    fail('database state was not verified');
  }
  exactArray(state.pending, 'pending migrations');
  exactArray(state.failed, 'failed migrations');
  exactArray(state.unexpected, 'unexpected migrations');
  exactArray(state.unsafe, 'unsafe migrations');
  if (state.failed.length) fail('database has a failed migration');
  if (state.unexpected.length) fail('database has an unexpected migration');
  if (state.unsafe.length) fail('pending migration violates forward-only recovery');
  return state;
}

export function planDatabaseAction(plan, migrationState, backupProof, runId) {
  validateImpactPlan(plan);
  const state = validateMigrationState(migrationState);
  if (!state.pending.length) return { action: 'skip', requiresQuiesce: false, requiresBackupRestore: false };
  if (plan.deployment.migration !== 'verify-pending') fail('pending database migrations were not selected by impact policy');
  if (!backupProof || backupProof.schemaVersion !== 'harmonic-beacon.backup-restore.v1' ||
      backupProof.result !== 'success' || backupProof.fresh !== true || backupProof.isolatedRestore !== true ||
      backupProof.candidateMigrationVerified !== true) {
    fail('pending migrations require fresh backup, isolated restore, and candidate migration proof');
  }
  if (String(backupProof.runId) !== String(runId)) fail('backup/restore proof must belong to the same run');
  return { action: 'migrate', requiresQuiesce: true, requiresBackupRestore: true };
}

export function nextRecoveryAction(phase, state = {}) {
  switch (phase) {
    case 'prepared':
      if (state.pending && !state.backupComplete) return 'backup-restore';
      return state.pending ? 'migrate' : 'inspect-database';
    case 'migration-attempted': return 'migrate';
    case 'migrated':
    case 'migration-skipped': return 'replace';
    case 'replaced': return 'status';
    case 'committed': return 'complete';
    case 'rolled-back': return 'complete';
    default: fail(`unknown transaction phase: ${phase}`);
  }
}

export function assertCurrentHighWater(expected, actual) {
  if (!SHA256.test(expected ?? '') || !SHA256.test(actual ?? '') || expected !== actual) {
    fail('prepared transaction no longer matches current high-water');
  }
  return true;
}

function validateServiceReleases(releases) {
  const keys = Object.keys(releases ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify([...SERVICES].sort())) fail('service release inventory is incomplete');
  for (const service of SERVICES) {
    const entry = releases[service];
    if (!GIT_SHA.test(entry?.sourceSha ?? '') || !IMAGE_REF.test(entry?.imageRef ?? '')) fail(`invalid service release: ${service}`);
  }
}

export function bootstrapServiceReleases(manifest) {
  const sourceSha = manifest?.source?.gitSha;
  if (!GIT_SHA.test(sourceSha ?? '') || !Array.isArray(manifest?.artifacts)) {
    fail('legacy manifest cannot seed service releases');
  }
  const ref = (artifactId) => {
    const artifact = manifest.artifacts.find((entry) => entry?.artifactId === artifactId);
    const imageRef = `${artifact?.repository ?? ''}@${artifact?.digest ?? ''}`;
    if (!IMAGE_REF.test(imageRef)) fail(`legacy manifest is missing ${artifactId}`);
    return imageRef;
  };
  const app = ref('app');
  return {
    analytics: { sourceSha, imageRef: ref('analytics') },
    app: { sourceSha, imageRef: app },
    'commerce-reconciler': { sourceSha, imageRef: app },
    'playlist-bot': { sourceSha, imageRef: ref('playlist-bot') },
    tapestry: { sourceSha, imageRef: ref('tapestry') },
  };
}

export function updateServiceReleases(prior, plan, sourceSha, candidateRefs) {
  validateServiceReleases(prior);
  validateImpactPlan(plan);
  if (!GIT_SHA.test(sourceSha ?? '')) fail('invalid candidate source SHA');
  const next = structuredClone(prior);
  for (const service of plan.deployment.servicesToReplace) {
    const ref = (plan.deployment.reusePriorImages ?? []).includes(service)
      ? prior[service].imageRef
      : candidateRefs[service];
    if (!IMAGE_REF.test(ref ?? '')) fail(`missing candidate image reference for service: ${service}`);
    next[service] = { sourceSha, imageRef: ref };
  }
  validateServiceReleases(next);
  return next;
}

function option(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1]) fail(`${name} is required`);
  return argv[index + 1];
}

export function main(argv = process.argv.slice(2)) {
  const [command] = argv;
  if (command === 'validate-impact') {
    validateImpactPlan(JSON.parse(readFileSync(resolve(option(argv, '--input')), 'utf8')));
    return 0;
  }
  if (command === 'bootstrap-state') {
    const manifest = JSON.parse(readFileSync(resolve(option(argv, '--manifest')), 'utf8'));
    console.log(JSON.stringify(bootstrapServiceReleases(manifest)));
    return 0;
  }
  if (command === 'plan-database') {
    const plan = JSON.parse(readFileSync(resolve(option(argv, '--impact')), 'utf8'));
    const state = JSON.parse(readFileSync(resolve(option(argv, '--state')), 'utf8'));
    const proofPath = argv.includes('--backup-proof') ? option(argv, '--backup-proof') : null;
    const proof = proofPath ? JSON.parse(readFileSync(resolve(proofPath), 'utf8')) : undefined;
    console.log(JSON.stringify(planDatabaseAction(plan, state, proof, option(argv, '--run-id'))));
    return 0;
  }
  fail('usage: impact-recovery.mjs {validate-impact|plan-database} [options]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'impact recovery failed');
    process.exitCode = 1;
  }
}
