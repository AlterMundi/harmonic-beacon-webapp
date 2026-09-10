import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertCurrentHighWater,
  bootstrapServiceReleases,
  nextRecoveryAction,
  planDatabaseAction,
  updateServiceReleases,
  validateImpactPlan,
} from '../impact-recovery.mjs';

test('legacy OPS-D current state upgrades every service release from its exact manifest', () => {
  const sourceSha = 'a'.repeat(40);
  const manifest = {
    source: { gitSha: sourceSha },
    artifacts: [
      { artifactId: 'app', repository: 'ghcr.io/x/app', digest: `sha256:${'1'.repeat(64)}` },
      { artifactId: 'tapestry', repository: 'ghcr.io/x/tapestry', digest: `sha256:${'2'.repeat(64)}` },
      { artifactId: 'playlist-bot', repository: 'ghcr.io/x/playlist', digest: `sha256:${'3'.repeat(64)}` },
      { artifactId: 'analytics', repository: 'ghcr.io/x/analytics', digest: `sha256:${'4'.repeat(64)}` },
    ],
  };
  const releases = bootstrapServiceReleases(manifest);
  assert.equal(releases.app.sourceSha, sourceSha);
  assert.equal(releases['commerce-reconciler'].imageRef, releases.app.imageRef);
  assert.match(releases.analytics.imageRef, /@sha256:4{64}$/u);
});

const SHA = (character) => character.repeat(40);
const REF = (name, character) => `ghcr.io/altermundi/harmonic-beacon-${name}@sha256:${character.repeat(64)}`;

function impact(overrides = {}) {
  return {
    schemaVersion: 'harmonic-beacon.change-impact.v2',
    risk: 'functional',
    files: ['services/tapestry/src/server.mjs'],
    domains: ['tapestry'],
    labels: [],
    matrices: { ui: ['component'], functional: ['tapestry-integration'], critical: [], crossDomain: [] },
    requiredChecks: [{ check: 'diff-check', command: 'git diff --check' }],
    deployment: {
      deploy: true,
      artifactsToPull: ['tapestry'],
      servicesToReplace: ['tapestry'],
      migration: 'never',
      recovery: 'image-config',
    },
    details: { frozenAudioPaths: [], unclassifiedPaths: [], deployedServiceBases: {} },
    notes: [],
    ...overrides,
  };
}

test('impact plan rejects undeclared services and inconsistent artifact selection', () => {
  assert.equal(validateImpactPlan(impact()).deployment.servicesToReplace[0], 'tapestry');
  assert.throws(() => validateImpactPlan(impact({ deployment: {
    ...impact().deployment,
    artifactsToPull: [],
  } })), /artifact selection/u);
  assert.throws(() => validateImpactPlan(impact({ deployment: {
    ...impact().deployment,
    servicesToReplace: ['postgres'],
  } })), /service/u);
  assert.throws(() => validateImpactPlan(impact({ deployment: {
    ...impact().deployment,
    reusePriorImages: ['app'],
  } })), /reuse prior/u);
  assert.doesNotThrow(() => validateImpactPlan(impact({ deployment: {
    ...impact().deployment,
    artifactsToPull: [],
    reusePriorImages: ['tapestry'],
    servicesToReplace: ['tapestry'],
  } })));
});

test('verified database state skips migration without quiescing when none are pending', () => {
  const result = planDatabaseAction(impact(), {
    schemaVersion: 'harmonic-beacon.migration-state.v1',
    databaseStateVerified: true,
    failed: [],
    unexpected: [],
    unsafe: [],
    pending: [],
  });
  assert.deepEqual(result, { action: 'skip', requiresQuiesce: false, requiresBackupRestore: false });
});

test('pending migrations require fresh same-run backup and isolated restore proof', () => {
  const dataImpact = impact({
    risk: 'critical',
    domains: ['data'],
    deployment: {
      deploy: true,
      artifactsToPull: ['app'],
      servicesToReplace: ['app', 'commerce-reconciler'],
      migration: 'verify-pending',
      recovery: 'backup-restore-if-pending',
    },
  });
  const state = {
    schemaVersion: 'harmonic-beacon.migration-state.v1',
    databaseStateVerified: true,
    failed: [],
    unexpected: [],
    unsafe: [],
    pending: ['20260910120000_example'],
  };
  assert.throws(() => planDatabaseAction(dataImpact, state), /backup.*restore/u);
  assert.deepEqual(planDatabaseAction(dataImpact, state, {
    schemaVersion: 'harmonic-beacon.backup-restore.v1',
    runId: '42',
    result: 'success',
    fresh: true,
    isolatedRestore: true,
    candidateMigrationVerified: true,
  }, '42'), { action: 'migrate', requiresQuiesce: true, requiresBackupRestore: true });
  assert.throws(() => planDatabaseAction(dataImpact, state, {
    schemaVersion: 'harmonic-beacon.backup-restore.v1', runId: '41', result: 'success', fresh: true,
    isolatedRestore: true, candidateMigrationVerified: true,
  }, '42'), /same run/u);
});

test('failed or unverified migration state always fails closed', () => {
  assert.throws(() => planDatabaseAction(impact(), {
    schemaVersion: 'harmonic-beacon.migration-state.v1', databaseStateVerified: false, failed: [], pending: [],
  }), /verified/u);
  assert.throws(() => planDatabaseAction(impact(), {
    schemaVersion: 'harmonic-beacon.migration-state.v1', databaseStateVerified: true,
    failed: ['broken'], unexpected: [], unsafe: [], pending: [],
  }), /failed migration/u);
  assert.throws(() => planDatabaseAction(impact(), {
    schemaVersion: 'harmonic-beacon.migration-state.v1', databaseStateVerified: true,
    failed: [], unexpected: ['drift'], unsafe: [], pending: [],
  }), /unexpected migration/u);
  assert.throws(() => planDatabaseAction(impact(), {
    schemaVersion: 'harmonic-beacon.migration-state.v1', databaseStateVerified: true,
    failed: [], unexpected: [], unsafe: ['next:DROP TABLE'], pending: ['next'],
  }), /forward-only/u);
});

test('retries resume checkpoints without duplicating backup migration or replacement', () => {
  assert.equal(nextRecoveryAction('prepared', { pending: true, backupComplete: false }), 'backup-restore');
  assert.equal(nextRecoveryAction('prepared', { pending: true, backupComplete: true }), 'migrate');
  assert.equal(nextRecoveryAction('migration-attempted', {}), 'migrate');
  assert.equal(nextRecoveryAction('migrated', {}), 'replace');
  assert.equal(nextRecoveryAction('migration-skipped', {}), 'replace');
  assert.equal(nextRecoveryAction('replaced', {}), 'status');
  assert.equal(nextRecoveryAction('committed', {}), 'complete');
});

test('older candidates cannot overwrite a newer current high-water', () => {
  assert.doesNotThrow(() => assertCurrentHighWater('a'.repeat(64), 'a'.repeat(64)));
  assert.throws(() => assertCurrentHighWater('a'.repeat(64), 'b'.repeat(64)), /high-water/u);
});

test('service release state advances only replaced services and preserves exact rollback refs', () => {
  const prior = {
    app: { sourceSha: SHA('a'), imageRef: REF('app', '1') },
    'commerce-reconciler': { sourceSha: SHA('a'), imageRef: REF('app', '1') },
    tapestry: { sourceSha: SHA('a'), imageRef: REF('tapestry', '2') },
    'playlist-bot': { sourceSha: SHA('a'), imageRef: REF('playlist-bot', '3') },
    analytics: { sourceSha: SHA('a'), imageRef: REF('analytics', '4') },
  };
  const next = updateServiceReleases(prior, impact(), SHA('b'), {
    tapestry: REF('tapestry', '9'),
  });
  assert.deepEqual(next.app, prior.app);
  assert.deepEqual(next.tapestry, { sourceSha: SHA('b'), imageRef: REF('tapestry', '9') });
  assert.equal(prior.tapestry.imageRef, REF('tapestry', '2'));
});

test('config-only service state advances the exact source while preserving the deployed image', () => {
  const prior = {
    app: { sourceSha: SHA('a'), imageRef: REF('app', '1') },
    'commerce-reconciler': { sourceSha: SHA('a'), imageRef: REF('app', '1') },
    tapestry: { sourceSha: SHA('a'), imageRef: REF('tapestry', '2') },
    'playlist-bot': { sourceSha: SHA('a'), imageRef: REF('playlist-bot', '3') },
    analytics: { sourceSha: SHA('a'), imageRef: REF('analytics', '4') },
  };
  const configOnly = impact({ deployment: {
    deploy: true,
    artifactsToPull: [],
    servicesToReplace: ['app'],
    reusePriorImages: ['app'],
    migration: 'never',
    recovery: 'image-config',
  } });
  const next = updateServiceReleases(prior, configOnly, SHA('b'), {});
  assert.deepEqual(next.app, { sourceSha: SHA('b'), imageRef: prior.app.imageRef });
});

test('root helper consumes the trusted impact plan for selective pull replace migration and rollback', () => {
  const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
  assert.match(helper, /CHANGE_IMPACT=.*change-impact\.mjs/u);
  assert.match(helper, /impact-plan\.json/u);
  assert.match(helper, /artifactsToPull/u);
  assert.match(helper, /servicesToReplace/u);
  assert.match(helper, /migration-state\.json/u);
  assert.match(helper, /backup-restore\.json/u);
  assert.match(helper, /release-restore-verify\.ts/u);
  assert.match(helper, /release-quiesce-preflight\.ts/u);
  const provenance = helper.slice(helper.indexOf('verify_public_provenance() {'), helper.indexOf('artifact_status() {'));
  assert.match(provenance, /next-service-releases\.json/u);
  assert.match(helper, /migration-skipped/u);
  assert.match(helper, /serviceReleases/u);
  assert.match(helper, /runtime configuration drift requires a separately reviewed dependency transition/u);
  const resume = helper.slice(helper.indexOf('transaction_resume_prepared() {'), helper.indexOf('transaction_finish_committed() {'));
  for (const phase of ['prepared', 'migration-attempted', 'migration-skipped', 'migrated', 'replaced']) {
    assert.match(resume, new RegExp(phase));
  }
  assert.match(helper.slice(helper.indexOf('artifact_migrate() {'), helper.indexOf('artifact_replace() {')), /migration-skipped.*migrated.*return 0/su);
  assert.match(helper.slice(helper.indexOf('artifact_replace() {'), helper.indexOf('verify_container_image() {')), /replaced.*return 0/su);
  for (const name of ['artifact_prepare', 'artifact_impact', 'artifact_preflight', 'artifact_migrate', 'artifact_replace']) {
    const start = helper.indexOf(`${name}() {`);
    const end = helper.indexOf('\n}', start);
    assert.match(helper.slice(start, end), /transaction_finish_committed/u, `${name} must recover a commit-boundary interruption`);
  }
  assert.doesNotMatch(helper, /docker system prune|compose[^\n]+down/u);
});

test('schedule mutation boundary accepts only a root-owned closed request and never SQL', () => {
  const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
  assert.match(helper, /schedule-apply/u);
  assert.match(helper, /SCHEDULE_REQUEST_ROOT/u);
  assert.match(helper, /authorized-session-schedule\.ts/u);
  assert.match(helper, /require_secure_root_file[^\n]+600/u);
  const scheduleBlock = helper.slice(helper.indexOf('schedule_apply()'), helper.indexOf('\nusage()'));
  assert.doesNotMatch(scheduleBlock, /psql|\$queryRaw|SELECT|UPDATE|DELETE|INSERT/iu);
});
