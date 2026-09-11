import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const promote = readFileSync('.github/workflows/oci-promote.yml', 'utf8');
const candidate = readFileSync('.github/workflows/oci-candidate.yml', 'utf8');
const e2eWorkflow = readFileSync('.github/workflows/e2e.yml', 'utf8');
const migrationState = readFileSync('scripts/release-migration-state.ts', 'utf8');
const restoreVerify = readFileSync('scripts/release-restore-verify.ts', 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`${name}() {`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = source.indexOf('\n}\n', start);
  assert.notEqual(end, -1, `unterminated ${name}`);
  return source.slice(start, end + 3);
}

test('CI derives its service test jobs from the executable impact classifier', () => {
  assert.match(ci, /^  impact:\n/mu);
  assert.match(ci, /change-impact --base "\$base" --head "\$head" --json/u);
  assert.match(ci, /if: needs\.impact\.outputs\.lint_and_build == 'true'/u);
  assert.match(ci, /if: needs\.impact\.outputs\.analytics == 'true'/u);
  assert.match(ci, /if: needs\.impact\.outputs\.tapestry == 'true'/u);
  assert.match(ci, /playlist:playlist/u);
  assert.match(ci, /git diff --check "\$base" "\$head"/u);
  assert.match(ci, /git diff --check "\$\{head\}\^" "\$head"/u);
});

test('required CI aggregator rejects a skipped selected job', () => {
  assert.match(ci, /^  required-impact-checks:\n/mu);
  assert.match(ci, /if: always\(\)/u);
  assert.match(ci, /impact-recovery\.mjs validate-impact --input impact-plan\.json/u);
  assert.match(ci, /hb\.mjs change-impact verify-results --impact impact-plan\.json --results impact-results\.json/u);
  assert.match(ci, /requiredJobChecks/u);
});

test('workflow executes the exact validate-impact --input command', () => {
  const command = ci.match(/node scripts\/ci\/impact-recovery\.mjs validate-impact [^\n]+/u)?.[0];
  assert.equal(command, 'node scripts/ci/impact-recovery.mjs validate-impact --input impact-plan.json');
  const root = mkdtempSync(join(tmpdir(), 'hb-workflow-command-'));
  try {
    mkdirSync(join(root, 'scripts/ci'), { recursive: true });
    writeFileSync(join(root, 'scripts/ci/impact-recovery.mjs'), readFileSync('scripts/ci/impact-recovery.mjs'));
    writeFileSync(join(root, 'scripts/ci/change-impact.mjs'), readFileSync('scripts/ci/change-impact.mjs'));
    writeFileSync(join(root, 'impact-plan.json'), JSON.stringify({
      schemaVersion: 'harmonic-beacon.change-impact.v2', risk: 'documentation',
      files: ['docs/readme.md'], domains: ['documentation'], labels: [],
      deployment: { deploy: false, servicesToReplace: [], reusePriorImages: [], artifactsToPull: [], migration: 'never', recovery: 'none' },
      matrices: { ui: [], functional: [], critical: [], crossDomain: [] },
      requiredChecks: [{ check: 'diff-check', command: 'git diff --check' }],
      requiredJobChecks: ['impact'],
    }));
    const result = spawnSync('/bin/bash', ['-euo', 'pipefail', '-c', command], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('workflow executes the real change-impact result verifier', () => {
  assert.match(
    ci,
    /node scripts\/hb\.mjs change-impact verify-results --impact impact-plan\.json --results impact-results\.json/u,
  );
});

test('every derivable hosted qualification job exists and the aggregator validates all of them', () => {
  const jobs = [
    'impact', 'lint-and-build', 'test', 'tapestry', 'playlist', 'analytics', 'commerce-contract',
    'e2e', 'frozen-audio-paths', 'auth-contract', 'grant-recovery', 'data-recovery',
    'workflow-review', 'release-qualification',
  ];
  const aggregate = ci.slice(ci.indexOf('  required-impact-checks:'));
  for (const job of jobs) {
    assert.match(ci, new RegExp(`^  ${job}:`, 'mu'), `missing hosted job ${job}`);
    assert.ok(aggregate.includes(job), `aggregator does not bind ${job}`);
  }
  assert.match(candidate, /^  required-checks:\n[\s\S]*uses: \.\/\.github\/workflows\/ci\.yml/mu);
  assert.match(candidate, /^  build:\n[\s\S]*needs: required-checks/mu);
  assert.match(promote, /required-checks \/ required-impact-checks/u);
  assert.match(promote, /run_attempt/u);
  assert.match(e2eWorkflow, /group: e2e-\$\{\{ github\.workflow \}\}-\$\{\{ github\.head_ref \|\| github\.run_id \}\}/u);
});

test('the selected data recovery job executes a real isolated PostgreSQL backup and restore', () => {
  const dataJob = ci.slice(ci.indexOf('  data-recovery:'), ci.indexOf('\n  workflow-review:'));
  assert.match(dataJob, /services:\n      postgres:/u);
  assert.match(dataJob, /pg_dump/u);
  assert.match(dataJob, /pg_restore/u);
  assert.match(dataJob, /SELECT label FROM restore_probe/u);
});

test('root helper never reaches runner workspace Git, scripts, or Compose', () => {
  const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
  assert.doesNotMatch(helper, /WORKSPACE|RUNNER_USER|runner_git|runner_change_impact|validate_checkout/u);
  assert.doesNotMatch(helper, /(^|[\s$(;])git(?:\s|$)/mu);
  assert.doesNotMatch(helper, /GITHUB_WORKSPACE/u);
});

test('entry fence release fails closed while either exact rule remains and succeeds when both are absent', () => {
  const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
  const root = mkdtempSync(join(tmpdir(), 'hb-entry-fence-'));
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const iptables = join(bin, 'iptables');
  writeFileSync(iptables, `#!/bin/sh\nset -eu\naction=$1\nshift\nport=\nwhile [ "$#" -gt 0 ]; do\n  if [ "$1" = --dport ]; then port=$2; break; fi\n  shift\ndone\nstate="$HB_FENCE_STATE/$port"\ncase "$action" in\n  -C) [ "\${HB_CHECK_ERROR:-0}" != 1 ] || exit 2; [ -f "$state" ] ;;\n  -D) [ "\${HB_DELETE_FAIL:-0}" != 1 ] || exit 1; rm -f "$state" ;;\n  *) exit 2 ;;\nesac\n`);
  chmodSync(iptables, 0o755);
  const script = join(root, 'probe.sh');
  writeFileSync(script, `#!/bin/bash\nset -euo pipefail\ndie(){ printf '%s\\n' "$*" >&2; return 1; }\n${functionSource(helper, 'entry_fence_rule')}\n${functionSource(helper, 'entry_fence_release')}\nentry_fence_release attempt-1\n`);
  chmodSync(script, 0o755);
  try {
    const state = join(root, 'state');
    mkdirSync(state);
    writeFileSync(join(state, '3000'), 'present');
    writeFileSync(join(state, '7880'), 'present');
    const blocked = spawnSync(script, [], { env: { PATH: `${bin}:/usr/bin:/bin`, HB_FENCE_STATE: state, HB_DELETE_FAIL: '1' }, encoding: 'utf8' });
    assert.notEqual(blocked.status, 0, 'release reported success although rules remain');
    rmSync(join(state, '3000'));
    rmSync(join(state, '7880'));
    const absent = spawnSync(script, [], { env: { PATH: `${bin}:/usr/bin:/bin`, HB_FENCE_STATE: state, HB_DELETE_FAIL: '1' }, encoding: 'utf8' });
    assert.equal(absent.status, 0, absent.stderr);
    const unprovable = spawnSync(script, [], { env: { PATH: `${bin}:/usr/bin:/bin`, HB_FENCE_STATE: state, HB_CHECK_ERROR: '1' }, encoding: 'utf8' });
    assert.notEqual(unprovable.status, 0, 'release reported success when rule absence could not be proved');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('protected workflow signs a hosted-reproduced plan bound to the exported live high-water', () => {
  const plan = promote.slice(promote.indexOf('\n  impact_plan:'), promote.indexOf('\n  authorize:'));
  const authorize = promote.slice(promote.indexOf('\n  authorize:'), promote.indexOf('\n  promote:'));
  const promoteJob = promote.slice(promote.indexOf('\n  promote:'));
  assert.match(plan, /runs-on: \[self-hosted, mona\]/u);
  assert.match(plan, /sudo \/usr\/local\/sbin\/hb-deploy artifact-impact-state/u);
  assert.match(plan, /\/usr\/local\/libexec\/harmonic-beacon\/change-impact\.mjs/u);
  assert.match(authorize, /runs-on: ubuntu-24\.04/u);
  assert.match(authorize, /change-impact\.mjs[^\n]+--deployed-state impact-state\.json/u);
  assert.match(authorize, /cmp --silent impact-plan\.json hosted-impact-plan\.json/u);
  assert.match(authorize, /IMPACT_PLAN_SHA256|IMPACT_STATE_SHA256/u);
  assert.doesNotMatch(promoteJob, /actions\/checkout|GITHUB_WORKSPACE|git\s/u);
  assert.match(promoteJob, /authorized-promotion-/u);
  const prepare = promoteJob.indexOf('artifact-prepare');
  const impact = promoteJob.indexOf('artifact-impact "');
  const preflight = promoteJob.indexOf('artifact-preflight');
  assert.ok(prepare >= 0 && impact > prepare && preflight > impact);
  assert.match(promoteJob, /"\$SOURCE_SHA" "\$SOURCE_TREE" "\$CANDIDATE_RUN_ID"/u);
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
