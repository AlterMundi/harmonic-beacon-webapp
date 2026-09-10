#!/usr/bin/env node

import { createHash } from 'node:crypto';
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
const JOB_CHECK_ORDER = ['impact', 'lint-and-build', 'test', 'tapestry', 'playlist', 'analytics'];

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
  const requiredJobs = exactArray(plan.requiredJobChecks, 'requiredJobChecks');
  const functional = exactArray(plan.matrices?.functional, 'functional matrices');
  const ui = exactArray(plan.matrices?.ui, 'ui matrices');
  const expectedJobs = new Set(['impact']);
  if (services.includes('app') || services.includes('commerce-reconciler') || ui.length > 0 ||
      functional.includes('app-integration') || functional.includes('chromium-android-journey')) {
    expectedJobs.add('lint-and-build');
    expectedJobs.add('test');
  }
  if (services.includes('tapestry') || functional.includes('tapestry-integration')) expectedJobs.add('tapestry');
  if (services.includes('playlist-bot') || functional.includes('playlist-media-integration')) expectedJobs.add('playlist');
  if (functional.includes('analytics-contract')) expectedJobs.add('analytics');
  const expected = JOB_CHECK_ORDER.filter((job) => expectedJobs.has(job));
  if (JSON.stringify(requiredJobs) !== JSON.stringify(expected)) fail('required job checks do not match selected services and matrices');
  return plan;
}

export function validateMigrationState(state) {
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
  exactArray(state.applied, 'applied migrations');
  exactArray(state.checksumErrors, 'migration checksum errors');
  exactArray(state.duplicateRecords, 'duplicate migration records');
  exactArray(state.conflictingRecords, 'conflicting migration records');
  if (state.checksumErrors.length) fail('database has a migration checksum error');
  if (state.duplicateRecords.length) fail('database has duplicate migration records');
  if (state.conflictingRecords.length) fail('database has conflicting migration records');
  if (!Array.isArray(state.migrationChecksums)) fail('migration checksums must be an array');
  const checksums = new Map();
  for (const entry of state.migrationChecksums) {
    if (!entry || Object.keys(entry).sort().join(',') !== 'checksum,migrationName' ||
        typeof entry.migrationName !== 'string' || !SHA256.test(entry.checksum ?? '') || checksums.has(entry.migrationName)) {
      fail('migration checksum inventory is malformed or duplicated');
    }
    checksums.set(entry.migrationName, entry.checksum);
  }
  for (const name of [...state.applied, ...state.pending]) {
    if (!checksums.has(name)) fail(`migration checksum inventory is missing ${name}`);
  }
  return state;
}

export function validateBackupRestoreProof(state, backupProof, runId) {
  const proofKeys = ['attemptId', 'backupSha256', 'candidateImageId', 'candidateImageRef', 'createdAt',
    'hostedRuntimeDrill', 'isolatedRestore', 'migrationChecksumsSha256', 'quiescenceEvidenceSha256',
    'postMigrationStateSha256', 'preMigrationStateSha256', 'priorAppHealth', 'priorAppImageId',
    'priorAppImageRef', 'priorSchemaCheck', 'priorWorkerHeartbeat', 'priorWorkerImageId',
    'priorWorkerImageRef', 'result', 'runId', 'schemaVersion'];
  if (!backupProof || Object.keys(backupProof).sort().join(',') !== proofKeys.sort().join(',') ||
      backupProof.schemaVersion !== 'harmonic-beacon.backup-restore.v2' || backupProof.result !== 'success' ||
      backupProof.isolatedRestore !== 'passed' || backupProof.hostedRuntimeDrill !== 'passed' ||
      backupProof.priorAppHealth !== 'passed' || backupProof.priorWorkerHeartbeat !== 'passed' ||
      backupProof.priorSchemaCheck !== 'passed' ||
      !/^[1-9][0-9]{0,19}-[1-9][0-9]{9,18}-[1-9][0-9]{0,9}$/u.test(backupProof.attemptId ?? '') ||
      !IMAGE_REF.test(backupProof.candidateImageRef ?? '') || !IMAGE_REF.test(backupProof.priorAppImageRef ?? '') ||
      !IMAGE_REF.test(backupProof.priorWorkerImageRef ?? '') ||
      !/^sha256:[0-9a-f]{64}$/u.test(backupProof.candidateImageId ?? '') ||
      !/^sha256:[0-9a-f]{64}$/u.test(backupProof.priorAppImageId ?? '') ||
      !/^sha256:[0-9a-f]{64}$/u.test(backupProof.priorWorkerImageId ?? '') ||
      ![backupProof.backupSha256, backupProof.preMigrationStateSha256, backupProof.postMigrationStateSha256,
        backupProof.migrationChecksumsSha256, backupProof.quiescenceEvidenceSha256].every((value) => SHA256.test(value ?? '')) ||
      !/^20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/u.test(backupProof.createdAt ?? '')) {
    fail('pending migrations require a complete typed backup/restore proof');
  }
  if (String(backupProof.runId) !== String(runId)) fail('backup/restore proof must belong to the same run');
  const expectedMigrationDigest = createHash('sha256').update(JSON.stringify(state.migrationChecksums)).digest('hex');
  if (backupProof.migrationChecksumsSha256 !== expectedMigrationDigest) {
    fail('backup/restore proof migration checksum binding is invalid');
  }
  return true;
}

export function planDatabaseAction(plan, migrationState, backupProof, runId) {
  validateImpactPlan(plan);
  const state = validateMigrationState(migrationState);
  if (backupProof) validateBackupRestoreProof(state, backupProof, runId);
  if (!state.pending.length) return { action: 'skip', requiresQuiesce: false, requiresBackupRestore: false };
  if (plan.deployment.migration !== 'verify-pending') fail('pending database migrations were not selected by impact policy');
  if (!backupProof) fail('pending migrations require a complete typed backup/restore proof');
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

export function verifyOperationEvidence(evidence, runId) {
  const operationFail = (message) => fail(`operation evidence ${message}`);
  if (!evidence || evidence.schemaVersion !== 'harmonic-beacon.release-operation.v1' ||
      String(evidence.runId) !== String(runId) || !/^[1-9][0-9]{0,19}-[1-9][0-9]{9,18}-[1-9][0-9]{0,9}$/u.test(evidence.attemptId ?? '') ||
      !['migrate', 'replace', 'rollback'].includes(evidence.purpose)) operationFail('identity is invalid');
  const services = exactArray(evidence.selectedServices, 'operation evidence selected services');
  if (services.some((service) => !SERVICES.has(service) || service === 'analytics')) operationFail('selects an invalid service');
  if (!Array.isArray(evidence.events) || evidence.events.length === 0) operationFail('events are missing');
  const actual = [];
  for (let index = 0; index < evidence.events.length; index += 1) {
    const event = evidence.events[index];
    if (!event || Object.keys(event).sort().join(',') !== 'sequence,type' ||
        event.sequence !== index + 1 || typeof event.type !== 'string') operationFail('event sequence is invalid');
    actual.push(event.type);
  }
  const prefix = ['initial-continuity-verified', 'entry-fence-acquired', 'writers-quiesced', 'final-continuity-verified'];
  const suffix = ['writers-restored', 'entry-fence-released'];
  const expected = evidence.purpose !== 'migrate'
    ? [...prefix, ...services.map((service) => `replacement-complete:${service}`), ...suffix]
    : [...prefix, 'backup-created', 'isolated-restore-ready', 'candidate-migration-applied-isolated',
      'prior-app-health-verified', 'prior-worker-heartbeat-verified', 'prior-schema-verified',
      'production-migration-applied', ...suffix];
  if (JSON.stringify(actual) !== JSON.stringify(expected)) operationFail('events are incomplete or out of order');
  if (evidence.purpose === 'migrate' && JSON.stringify(services) !== JSON.stringify(['app', 'commerce-reconciler'])) {
    operationFail('must quiesce both database-writing runtimes');
  }
  return true;
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
  if (command === 'validate-migration-state') {
    validateMigrationState(JSON.parse(readFileSync(resolve(option(argv, '--state')), 'utf8')));
    return 0;
  }
  if (command === 'verify-operation') {
    verifyOperationEvidence(JSON.parse(readFileSync(resolve(option(argv, '--input')), 'utf8')), option(argv, '--run-id'));
    return 0;
  }
  fail('usage: impact-recovery.mjs {validate-impact|validate-migration-state|plan-database|verify-operation} [options]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'impact recovery failed');
    process.exitCode = 1;
  }
}
