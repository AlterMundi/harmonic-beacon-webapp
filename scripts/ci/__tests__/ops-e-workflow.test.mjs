import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
const { parse } = createRequire(import.meta.url)('yaml');

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

test('candidate preflight executes fail-closed inputs before protected genesis approval and any builds', () => {
  const workflow = parse(candidate);
  assert.ok(workflow.on.workflow_dispatch?.inputs?.mode, "missing typed mode input");
  assert.deepEqual(workflow.on.workflow_dispatch.inputs.mode.options, ['successor', 'genesis']);
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.default, 'successor');
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.type, 'choice');
  assert.equal(workflow.on.workflow_dispatch.inputs.mode.required, true);
  const preflight = workflow.jobs.preflight;
  assert.deepEqual(preflight.permissions, { contents: 'read' });
  const step = preflight.steps.find(s => s.id === 'inputs');
  assert.ok(step?.run, 'missing executable preflight');
  assert.equal(step.env.REQUESTED_MODE, '${{ inputs.mode }}');
  for (const name of ['HB_POSTGRES_IMAGE_REF', 'HB_LIVEKIT_IMAGE_REF', 'HB_RELEASE_BASE_MANIFEST_SHA256']) {
    assert.equal(step.env[name], '${{ vars.' + name + ' }}');
  }
  for (const name of ['mode', 'base', 'postgres', 'livekit']) {
    assert.equal(preflight.outputs[name], '${{ steps.inputs.outputs.' + name + ' }}');
  }
  assert.doesNotMatch(step.run, /\$\{\{/u, 'input expressions must travel through env');
  const root = mkdtempSync(join(tmpdir(), 'genesis-preflight-'));
  try {
    const gh = join(root, 'gh');
    writeFileSync(gh, '#!/bin/bash\nset -euo pipefail\n[[ "$*" == "api repos/AlterMundi/harmonic-beacon-webapp/git/ref/heads/main --jq .object.sha" ]]\nprintf "%s\\n" "$MAIN_SHA"\n[[ "$GH_FAIL" == false ]]\n');
    chmodSync(gh, 0o755);
    const env = {
      PATH: `${root}:${process.env.PATH}`, GH_FAIL: 'false', MAIN_SHA: 'a'.repeat(40),
      GITHUB_SHA: 'a'.repeat(40), GITHUB_REF: 'refs/heads/main', GITHUB_REF_PROTECTED: 'true',
      GITHUB_REPOSITORY: 'AlterMundi/harmonic-beacon-webapp', GITHUB_EVENT_NAME: 'workflow_dispatch',
      REQUESTED_MODE: 'genesis', HB_RELEASE_BASE_MANIFEST_SHA256: '',
      HB_POSTGRES_IMAGE_REF: `docker.io/library/postgres@sha256:${'b'.repeat(64)}`,
      HB_LIVEKIT_IMAGE_REF: `docker.io/livekit/livekit-server@sha256:${'c'.repeat(64)}`,
    };
    let index = 0;
    const run = (changes = {}) => {
      const output = join(root, `outputs-${++index}`); writeFileSync(output, '');
      const result = spawnSync('/bin/bash', ['-c', step.run], { env: { ...env, ...changes, GITHUB_OUTPUT: output }, encoding: 'utf8' });
      return { ...result, output: readFileSync(output, 'utf8') };
    };
    const genesis = run();
    assert.equal(genesis.status, 0, genesis.stderr);
    assert.match(genesis.output, /^mode=genesis$/mu);
    for (const changes of [
      { GITHUB_EVENT_NAME: 'push' }, { GITHUB_EVENT_NAME: 'pull_request' },
      { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_REF_PROTECTED: 'false' },
      { GITHUB_REPOSITORY: 'other/repository' }, { MAIN_SHA: 'd'.repeat(40) }, { GH_FAIL: 'true' },
      { REQUESTED_MODE: '' }, { REQUESTED_MODE: 'wrong' }, { REQUESTED_MODE: '$(exit 0)' },
      { HB_RELEASE_BASE_MANIFEST_SHA256: 'd'.repeat(64) },
      { HB_POSTGRES_IMAGE_REF: '' }, { HB_LIVEKIT_IMAGE_REF: '' },
      { HB_POSTGRES_IMAGE_REF: 'postgres:16' }, { HB_LIVEKIT_IMAGE_REF: 'livekit/livekit-server:latest' },
      { HB_POSTGRES_IMAGE_REF: `evil/postgres@sha256:${'b'.repeat(64)}` },
      { HB_LIVEKIT_IMAGE_REF: `docker.io/livekit/livekit-server@sha256:${'C'.repeat(64)}` },
    ]) {
      const result = run(changes);
      assert.notEqual(result.status, 0, JSON.stringify(changes));
      assert.equal(result.output, '', 'invalid input emitted downstream authority');
    }
    for (const event of ['push', 'workflow_dispatch']) {
      const changes = { GITHUB_EVENT_NAME: event, REQUESTED_MODE: event === 'push' ? '' : 'successor', HB_RELEASE_BASE_MANIFEST_SHA256: 'd'.repeat(64) };
      assert.match(run(changes).output, /^mode=successor$/mu);
      assert.equal(run(changes).status, 0);
      for (const base of ['', 'bad', `sha256:${'d'.repeat(64)}`]) {
        const invalid = run({ ...changes, HB_RELEASE_BASE_MANIFEST_SHA256: base });
        assert.notEqual(invalid.status, 0); assert.equal(invalid.output, '');
      }
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('genesis approval and successful full reusable CI are mandatory ancestors of signing', () => {
  const { jobs } = parse(candidate);
  assert.ok(jobs['genesis-approval'], 'missing protected genesis approval');
  assert.equal(jobs['genesis-approval'].environment, 'production');
  assert.equal(jobs['genesis-approval'].needs, 'preflight');
  assert.equal(jobs['genesis-approval'].if, "needs.preflight.outputs.mode == 'genesis'");
  assert.deepEqual(jobs['genesis-approval'].permissions, {});
  const checks = jobs['required-checks'];
  assert.deepEqual(checks.needs, ['preflight', 'genesis-approval']);
  // Evaluate the actual bounded Actions predicate with boundary results, including skipped needs.
  const evaluate = (expression, needs, cancelled = false) => {
    const code = expression.replace(/needs\.([a-z-]+)/gu, (_, job) => `needs[${JSON.stringify(job)}]`).replace(/cancelled\(\)/gu, 'cancelled');
    return Function('needs', 'cancelled', `"use strict"; return (${code});`)(needs, cancelled);
  };
  for (const mode of ['genesis', 'successor']) for (const preflight of ['success', 'failure', 'skipped', 'cancelled']) for (const approval of ['success', 'failure', 'skipped', 'cancelled']) {
    const needs = { preflight: { result: preflight, outputs: { mode } }, 'genesis-approval': { result: approval } };
    assert.equal(evaluate(checks.if, needs), preflight === 'success' && (mode === 'genesis' ? approval === 'success' : approval === 'skipped'));
    assert.equal(evaluate(checks.if, needs, true), false);
  }
  assert.equal(checks.uses, './.github/workflows/ci.yml');
  assert.match(checks.with.force_all, /needs\.preflight\.outputs\.mode == 'genesis'/u);
  const forceAll = Function('needs', 'github', `"use strict"; return (${checks.with.force_all.slice(3, -2)});`);
  for (const [mode, event, before, expected] of [
    ['genesis', 'workflow_dispatch', 'a'.repeat(40), true],
    ['successor', 'workflow_dispatch', 'a'.repeat(40), true],
    ['successor', 'push', 'a'.repeat(40), false],
    ['successor', 'push', '0'.repeat(40), true],
  ]) {
    assert.equal(forceAll({ preflight: { outputs: { mode } } }, { event_name: event, event: { before } }), expected);
  }
  assert.equal(jobs.build.needs, 'required-checks');
  assert.match(jobs.build.if, /needs\.required-checks\.result == 'success'/u);
  assert.deepEqual(jobs.qualify.needs, ['preflight', 'build']);
  assert.ok(jobs.qualify.if, 'qualify explicitly handles skipped genesis-approval ancestry');
  for (const result of ['success', 'failure', 'skipped', 'cancelled']) {
    assert.equal(evaluate(jobs.build.if, { 'required-checks': { result } }), result === 'success');
    assert.equal(evaluate(jobs.build.if, { 'required-checks': { result } }, true), false);
    for (const preflight of ['success', 'failure', 'skipped', 'cancelled']) {
      const needs = { preflight: { result: preflight }, build: { result } };
      assert.equal(evaluate(jobs.qualify.if, needs), preflight === 'success' && result === 'success');
      assert.equal(evaluate(jobs.qualify.if, needs, true), false);
    }
  }
  assert.deepEqual(jobs.build.strategy.matrix.include.map(m => m.artifact), ['app', 'tapestry', 'playlist-bot', 'analytics']);
  const assemble = jobs.qualify.steps.find(s => s.name === 'Assemble candidate inputs');
  assert.equal(assemble.env.HB_RELEASE_MODE, '${{ needs.preflight.outputs.mode }}');
  for (const name of ['HB_POSTGRES_IMAGE_REF', 'HB_LIVEKIT_IMAGE_REF', 'HB_RELEASE_BASE_MANIFEST_SHA256']) {
    assert.match(assemble.env[name], /needs\.preflight\.outputs\./u);
  }
  assert.match(candidate, /--no-build/u);
  assert.match(candidate, /cosign sign-blob --yes --bundle release-manifest.signature.bundle.json release-manifest.json/u);
  assert.match(candidate, /cosign sign-blob --yes --bundle qualification-receipt.signature.bundle.json qualification-receipt.json/u);
  const finalStep = jobs.qualify.steps.at(-1);
  assert.match(finalStep.uses, /^actions\/upload-artifact@/u);
  assert.equal(finalStep.if, undefined);
});

test('isolated workflow review installs locked dependencies before parser-dependent tests', () => {
  const steps = parse(ci).jobs['workflow-review'].steps;
  const install = steps.findIndex(step => step.run === 'npm ci --ignore-scripts');
  const tests = steps.findIndex(step => step.run?.includes('scripts/ci/__tests__/ops-e-workflow.test.mjs'));
  assert.ok(install >= 0 && tests > install, 'workflow-review must install its own locked dependencies before running tests');
  assert.equal(steps[install].if, undefined);
  assert.equal(steps[install]['continue-on-error'], undefined);
});

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
