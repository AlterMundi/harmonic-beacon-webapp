import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { classifyChanges } from '../change-impact.mjs';

import {
  assertCurrentHighWater,
  bootstrapServiceReleases,
  nextRecoveryAction,
  planDatabaseAction,
  updateServiceReleases,
  validateImpactPlan,
  validateMigrationState,
  verifyAuthorizedImpact,
  verifyOperationEvidence,
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
    ...classifyChanges(['services/tapestry/src/server.mjs']),
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
  assert.throws(() => validateImpactPlan(impact({ requiredJobChecks: ['impact'] })), /required job/u);
});

test('impact plan rejects omission of any hosted matrix or logical-check job', () => {
  const critical = classifyChanges(['src/lib/auth.ts']);
  assert.doesNotThrow(() => validateImpactPlan(critical));
  for (const omitted of critical.requiredJobChecks.slice(1)) {
    assert.throws(() => validateImpactPlan({
      ...critical,
      requiredJobChecks: critical.requiredJobChecks.filter((job) => job !== omitted),
    }), /required job/u, omitted);
  }
  assert.throws(() => validateImpactPlan({
    ...critical,
    matrices: { ...critical.matrices, critical: [] },
    requiredJobChecks: critical.requiredJobChecks.filter((job) => job !== 'auth-contract'),
  }), /derived impact selection/u);
});

test('verified database state skips migration without quiescing when none are pending', () => {
  const state = {
    schemaVersion: 'harmonic-beacon.migration-state.v1',
    databaseStateVerified: true,
    applied: [],
    failed: [],
    unexpected: [],
    pending: [],
    unsafe: [],
    checksumErrors: [],
    duplicateRecords: [],
    conflictingRecords: [],
    migrationChecksums: [],
  };
  assert.equal(validateMigrationState(state), state);
  const result = planDatabaseAction(impact(), state);
  assert.deepEqual(result, { action: 'skip', requiresQuiesce: false, requiresBackupRestore: false });
  assert.throws(() => planDatabaseAction(impact(), state, { result: 'success' }, '42'), /backup\/restore proof/u);
});

test('pending migrations require fresh same-run backup and isolated restore proof', () => {
  const dataImpact = classifyChanges(['prisma/migrations/20260910120000_example/migration.sql']);
  const state = {
    schemaVersion: 'harmonic-beacon.migration-state.v1',
    databaseStateVerified: true,
    applied: [],
    failed: [],
    unexpected: [],
    unsafe: [],
    checksumErrors: [],
    duplicateRecords: [],
    conflictingRecords: [],
    migrationChecksums: [{ migrationName: '20260910120000_example', checksum: 'a'.repeat(64) }],
    pending: ['20260910120000_example'],
  };
  assert.throws(() => planDatabaseAction(dataImpact, state), /backup.*restore/u);
  const proof = {
    schemaVersion: 'harmonic-beacon.backup-restore.v2',
    runId: '42',
    attemptId: '42-1700000001-124',
    result: 'success',
    isolatedRestore: 'passed',
    hostedRuntimeDrill: 'passed',
    backupSha256: '1'.repeat(64),
    candidateImageRef: REF('app', '2'),
    priorAppImageRef: REF('app', '1'),
    priorWorkerImageRef: REF('app', '1'),
    candidateImageId: `sha256:${'2'.repeat(64)}`,
    priorAppImageId: `sha256:${'1'.repeat(64)}`,
    priorWorkerImageId: `sha256:${'1'.repeat(64)}`,
    preMigrationStateSha256: '3'.repeat(64),
    postMigrationStateSha256: '4'.repeat(64),
    migrationChecksumsSha256: createHash('sha256').update(JSON.stringify(state.migrationChecksums)).digest('hex'),
    quiescenceEvidenceSha256: '5'.repeat(64),
    priorAppHealth: 'passed',
    priorWorkerHeartbeat: 'passed',
    priorSchemaCheck: 'passed',
    createdAt: '2026-09-10T23:00:00Z',
  };
  assert.deepEqual(planDatabaseAction(dataImpact, state, proof, '42'), {
    action: 'migrate', requiresQuiesce: true, requiresBackupRestore: true,
  });
  assert.throws(() => planDatabaseAction(dataImpact, state, { ...proof, runId: '41' }, '42'), /same run/u);
  assert.throws(() => planDatabaseAction(dataImpact, state, {
    ...proof, migrationChecksumsSha256: '0'.repeat(64),
  }, '42'), /migration checksum/u);
  for (const omitted of ['priorAppHealth', 'priorWorkerHeartbeat', 'priorSchemaCheck']) {
    const incomplete = { ...proof };
    delete incomplete[omitted];
    assert.throws(() => planDatabaseAction(dataImpact, state, incomplete, '42'), /backup.*proof/u);
  }
  assert.throws(() => planDatabaseAction(dataImpact, state, {
    schemaVersion: 'harmonic-beacon.backup-restore.v1', runId: '42', result: 'success', fresh: true,
    isolatedRestore: true, candidateMigrationVerified: true,
  }, '42'), /backup.*proof/u);
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
  for (const mutation of [
    { checksumErrors: ['next:CHECKSUM MISMATCH'] },
    { duplicateRecords: ['next'] },
    { conflictingRecords: ['next'] },
  ]) {
    assert.throws(() => planDatabaseAction(impact(), {
      schemaVersion: 'harmonic-beacon.migration-state.v1', databaseStateVerified: true,
      applied: [], failed: [], unexpected: [], unsafe: [], checksumErrors: [], duplicateRecords: [],
      conflictingRecords: [], migrationChecksums: [], pending: [], ...mutation,
    }), /checksum|duplicate|conflicting/u);
  }
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

test('ordered replacement evidence holds the entry fence through every selected replacement', () => {
  const evidence = {
    schemaVersion: 'harmonic-beacon.release-operation.v1', purpose: 'replace', runId: '42',
    attemptId: '42-1700000000-123', selectedServices: ['app', 'commerce-reconciler'],
    events: [
      'initial-continuity-verified', 'entry-fence-acquired', 'writers-quiesced',
      'final-continuity-verified', 'replacement-complete:app',
      'replacement-complete:commerce-reconciler', 'writers-restored', 'entry-fence-released',
    ].map((type, index) => ({ sequence: index + 1, type })),
  };
  assert.equal(verifyOperationEvidence(evidence, '42'), true);
  assert.equal(verifyOperationEvidence({ ...evidence, purpose: 'rollback' }, '42'), true);
  for (const mutation of [
    evidence.events.filter((event) => event.type !== 'replacement-complete:commerce-reconciler'),
    [...evidence.events.slice(0, 3), evidence.events[4], evidence.events[3], ...evidence.events.slice(5)]
      .map((event, index) => ({ ...event, sequence: index + 1 })),
  ]) {
    assert.throws(() => verifyOperationEvidence({ ...evidence, events: mutation }, '42'), /operation evidence/u);
  }
});

test('ordered migration evidence requires post-fence backup and both exact prior runtimes', () => {
  const evidence = {
    schemaVersion: 'harmonic-beacon.release-operation.v1', purpose: 'migrate', runId: '42',
    attemptId: '42-1700000001-124', selectedServices: ['app', 'commerce-reconciler'],
    events: [
      'initial-continuity-verified', 'entry-fence-acquired', 'writers-quiesced',
      'final-continuity-verified', 'backup-created', 'isolated-restore-ready',
      'candidate-migration-applied-isolated', 'prior-app-health-verified',
      'prior-worker-heartbeat-verified', 'prior-schema-verified',
      'production-migration-applied', 'writers-restored', 'entry-fence-released',
    ].map((type, index) => ({ sequence: index + 1, type })),
  };
  assert.equal(verifyOperationEvidence(evidence, '42'), true);
  for (const omitted of ['backup-created', 'prior-app-health-verified', 'prior-worker-heartbeat-verified', 'prior-schema-verified']) {
    assert.throws(() => verifyOperationEvidence({
      ...evidence,
      events: evidence.events.filter((event) => event.type !== omitted),
    }, '42'), /operation evidence/u);
  }
  const backupBeforeFence = [...evidence.events];
  [backupBeforeFence[1], backupBeforeFence[4]] = [backupBeforeFence[4], backupBeforeFence[1]];
  assert.throws(() => verifyOperationEvidence({
    ...evidence,
    events: backupBeforeFence.map((event, index) => ({ ...event, sequence: index + 1 })),
  }, '42'), /operation evidence/u);
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

test('signed impact binding accepts exact plan/state bytes and rejects changed high-water, source, or plan', () => {
  const serviceReleases = {
    app: { sourceSha: SHA('a'), imageRef: REF('app', '1') },
    'commerce-reconciler': { sourceSha: SHA('a'), imageRef: REF('app', '1') },
    tapestry: { sourceSha: SHA('a'), imageRef: REF('tapestry', '2') },
    'playlist-bot': { sourceSha: SHA('a'), imageRef: REF('playlist-bot', '3') },
  };
  const state = { schemaVersion: 'harmonic-beacon.impact-state.v1',
    publication: { generation: 7, id: '9'.repeat(64), manifestSha256: '8'.repeat(64) }, serviceReleases };
  const plan = impact({ details: { deployedServiceBases: Object.fromEntries(
    ['app', 'commerce-reconciler', 'playlist-bot', 'tapestry'].map((service) => [service, serviceReleases[service].sourceSha]),
  ) } });
  const stateBytes = Buffer.from(JSON.stringify(state));
  const planBytes = Buffer.from(JSON.stringify(plan));
  const authorization = { sourceSha: SHA('b'), impactStateSha256: `sha256:${createHash('sha256').update(stateBytes).digest('hex')}`,
    impactPlanSha256: `sha256:${createHash('sha256').update(planBytes).digest('hex')}` };
  assert.doesNotThrow(() => verifyAuthorizedImpact({ authorization, impactStateBytes: stateBytes, impactPlanBytes: planBytes, sourceSha: SHA('b') }));
  const changedState = Buffer.from(JSON.stringify({ ...state, publication: { ...state.publication, generation: 8 } }));
  assert.throws(() => verifyAuthorizedImpact({ authorization, impactStateBytes: changedState, impactPlanBytes: planBytes, sourceSha: SHA('b') }), /state digest/u);
  assert.throws(() => verifyAuthorizedImpact({ authorization, impactStateBytes: stateBytes, impactPlanBytes: planBytes, sourceSha: SHA('c') }), /source/u);
  assert.throws(() => verifyAuthorizedImpact({ authorization, impactStateBytes: stateBytes, impactPlanBytes: Buffer.from(JSON.stringify({ ...plan, risk: 'critical' })), sourceSha: SHA('b') }), /plan digest/u);
  const wrongBases = Buffer.from(JSON.stringify({ ...plan, details: { deployedServiceBases: { ...plan.details.deployedServiceBases, app: SHA('c') } } }));
  const wrongAuthorization = { ...authorization, impactPlanSha256: `sha256:${createHash('sha256').update(wrongBases).digest('hex')}` };
  assert.throws(() => verifyAuthorizedImpact({ authorization: wrongAuthorization, impactStateBytes: stateBytes, impactPlanBytes: wrongBases, sourceSha: SHA('b') }), /deployed service bases/u);
});

test('root helper consumes the trusted impact plan for selective pull replace migration and rollback', () => {
  const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
  assert.doesNotMatch(helper, /runner_change_impact|"\$CHANGE_IMPACT"\s+(?:--|validate|classify)/u);
  assert.match(helper, /admit_file "\$input_root\/impact-plan\.json"[\s\S]+impactPlanSha256/u);
  assert.match(helper, /verify-authorized-impact/u);
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
