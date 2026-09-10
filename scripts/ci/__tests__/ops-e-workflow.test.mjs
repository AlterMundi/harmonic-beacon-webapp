import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const promote = readFileSync('.github/workflows/oci-promote.yml', 'utf8');
const migrationState = readFileSync('scripts/release-migration-state.ts', 'utf8');
const restoreVerify = readFileSync('scripts/release-restore-verify.ts', 'utf8');

test('CI derives its service test jobs from the executable impact classifier', () => {
  assert.match(ci, /^  impact:\n/mu);
  assert.match(ci, /change-impact --base "\$base" --head "\$head" --json/u);
  assert.match(ci, /if: needs\.impact\.outputs\.app == 'true'/u);
  assert.match(ci, /if: needs\.impact\.outputs\.analytics == 'true'/u);
  assert.match(ci, /if: needs\.impact\.outputs\.tapestry == 'true'/u);
  assert.match(ci, /\.requiredJobChecks \| index\("playlist"\)/u);
});

test('required CI aggregator rejects a skipped selected job', () => {
  assert.match(ci, /^  required-impact-checks:\n/mu);
  assert.match(ci, /if: always\(\)/u);
  assert.match(ci, /impact-recovery\.mjs validate-impact --impact impact-plan\.json/u);
  assert.match(ci, /change-impact\.mjs verify-results --impact impact-plan\.json --results impact-results\.json/u);
  assert.match(ci, /requiredJobChecks/u);
});

test('promotion records the root-owned deterministic impact plan before mutation', () => {
  assert.match(promote, /ref: \$\{\{ github\.sha \}\}\n          fetch-depth: 0/u);
  const prepare = promote.indexOf('artifact-prepare');
  const impact = promote.indexOf('artifact-impact');
  const preflight = promote.indexOf('artifact-preflight');
  assert.ok(prepare >= 0 && impact > prepare && preflight > impact);
  assert.match(promote, /"\$SOURCE_SHA" "\$SOURCE_TREE" "\$CANDIDATE_RUN_ID"/u);
});

test('promotion checks DB and LiveKit continuity before any selected replacement', () => {
  const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
  const replace = helper.slice(helper.indexOf('artifact_replace()'), helper.indexOf('\nverify_container_image()'));
  assert.match(replace, /release_operation_start[^\n]+replace/u);
  assert.match(replace, /entry_fence_acquire/u);
  assert.match(replace, /artifact_compose[^\n]+stop app commerce-reconciler/u);
  assert.match(replace, /release_operation_event[^\n]+final-continuity-verified/u);
  assert.match(replace, /verify_release_operation/u);
  assert.doesNotMatch(helper, /candidateMigrationVerified/u);
});

test('migration backup and prior-runtime proof run only inside the quiesced fence', () => {
  const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
  const migrate = helper.slice(helper.indexOf('artifact_migrate()'), helper.indexOf('\nartifact_replace()'));
  const finalContinuity = migrate.indexOf('final-continuity-verified');
  const backup = migrate.indexOf('database_backup_restore');
  assert.ok(finalContinuity >= 0 && backup > finalContinuity);
  assert.match(helper, /prior-app-health-verified/u);
  assert.match(helper, /prior-worker-heartbeat-verified/u);
  assert.match(helper, /prior-schema-verified/u);
  assert.match(helper, /date -u \+%s%N/u);
  assert.match(helper, /harmonic-beacon\.backup-restore\.v2/u);
  const artifactLane = helper.slice(helper.indexOf('verify_migration_recovery_targets()'), helper.indexOf('schedule_apply()'));
  assert.doesNotMatch(artifactLane, /--entrypoint test/u);
  assert.match(restoreVerify, /harmonic-beacon\.restore-verification\.v2/u);
  assert.doesNotMatch(restoreVerify, /candidateMigrationVerified/u);
});

test('runtime migration inspection reads Prisma checksums and exact migration.sql bytes', () => {
  assert.match(migrationState, /SELECT migration_name, checksum, finished_at, rolled_back_at/u);
  assert.match(migrationState, /checksum: row\.checksum/u);
  assert.match(migrationState, /readFile\(`prisma\/migrations\/\$\{name\}\/migration\.sql`\)/u);
});

test('automatic rollback reacquires the entry fence before replacing any selected service', () => {
  const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
  const rollback = helper.slice(helper.indexOf('artifact_rollback()'), helper.indexOf('schedule_apply()'));
  const firstCheck = rollback.indexOf('run_release_continuity_preflight');
  const fence = rollback.indexOf('entry_fence_acquire');
  const stop = rollback.indexOf('stop app commerce-reconciler');
  const secondCheck = rollback.indexOf('run_release_continuity_preflight', firstCheck + 1);
  const replace = rollback.indexOf('artifact_compose_service_from');
  const release = rollback.indexOf('entry_fence_release');
  assert.ok(firstCheck >= 0 && firstCheck < fence && fence < stop && stop < secondCheck && secondCheck < replace && replace < release);
  assert.match(rollback, /release_operation_start "\$run_id" rollback/u);
  assert.match(rollback, /verify_release_operation "\$run_id" rollback/u);
});
