import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const REPOSITORY = path.resolve(import.meta.dirname, '../../..');
const DELIVERY = path.join(REPOSITORY, 'ops/beacon-account/delivery');
const WORKFLOW = path.join(REPOSITORY, '.github/workflows/account-delivery.yml');
const HELPER = path.join(DELIVERY, 'hb-account-delivery-root');
const SUDOERS = path.join(DELIVERY, 'beacon-account-runner.sudoers');
const SCHEMA = path.join(DELIVERY, 'receipt.schema.json');
const RECEIPT = path.join(DELIVERY, 'receipt.synthetic.json');
const VALIDATOR = path.join(DELIVERY, 'validate-receipt.mjs');
const START = path.join(REPOSITORY, 'scripts/beacon-account/start.sh');
const SHA = 'b'.repeat(40);

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function run(command, args, options = {}) {
  return spawnSync(command, args, { encoding: 'utf8', ...options });
}

function git(directory, ...args) {
  const result = run('git', args, { cwd: directory });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function writeExecutable(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  fs.chmodSync(file, 0o755);
}

function validRun({ id, attempt, sha, workflow, event }) {
  return {
    id: Number(id),
    run_attempt: Number(attempt),
    head_sha: sha,
    head_branch: 'early-birds',
    status: 'completed',
    conclusion: 'success',
    event,
    path: workflow,
  };
}

function helperFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'account-delivery-helper-'));
  const workspace = path.join(root, 'workspace');
  const origin = path.join(root, 'origin.git');
  const api = path.join(root, 'api');
  const state = path.join(root, 'state');
  const receipts = path.join(root, 'receipts');
  const locks = path.join(root, 'locks');
  const deployEnv = path.join(root, 'deploy.env');
  fs.mkdirSync(workspace);
  fs.mkdirSync(api, { mode: 0o700 });
  fs.mkdirSync(state, { mode: 0o700 });
  fs.mkdirSync(receipts, { mode: 0o700 });
  fs.mkdirSync(locks, { mode: 0o700 });
  fs.writeFileSync(deployEnv, 'synthetic-only\n', { mode: 0o600 });

  git(workspace, 'init', '-q');
  git(workspace, 'config', 'user.name', 'Account Delivery Test');
  git(workspace, 'config', 'user.email', 'account-delivery@example.invalid');
  fs.mkdirSync(path.join(workspace, 'ops/beacon-account/delivery'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'ops/beacon-account'), { recursive: true });
  fs.mkdirSync(path.join(workspace, 'scripts/beacon-account'), { recursive: true });
  for (const relative of [
    'ops/beacon-account/compose.yml',
    'ops/beacon-account/validate.mjs',
    'ops/beacon-account/deploy.env.synthetic.example',
    'ops/beacon-account/account.production.env.example',
    'ops/beacon-account/account.staging.env.example',
    'ops/beacon-account/account-mail-worker.production.env.example',
    'ops/beacon-account/account-mail-worker.staging.env.example',
    'ops/beacon-account/database.staging.env.example',
  ]) {
    fs.writeFileSync(path.join(workspace, relative), `${relative}\n`);
  }
  fs.copyFileSync(HELPER, path.join(workspace, 'ops/beacon-account/delivery/hb-account-delivery-root'));
  fs.chmodSync(path.join(workspace, 'ops/beacon-account/delivery/hb-account-delivery-root'), 0o755);
  fs.writeFileSync(path.join(workspace, 'marker'), 'first\n');
  git(workspace, 'add', '.');
  git(workspace, 'commit', '-q', '-m', 'fixture base');
  const staleSha = git(workspace, 'rev-parse', 'HEAD');

  git(root, 'init', '-q', '--bare', origin);
  git(workspace, 'remote', 'add', 'origin', origin);
  git(workspace, 'branch', '-M', 'early-birds');
  fs.writeFileSync(path.join(workspace, 'marker'), 'current\n');
  git(workspace, 'add', 'marker');
  git(workspace, 'commit', '-q', '-m', 'fixture current');
  const currentSha = git(workspace, 'rev-parse', 'HEAD');
  git(workspace, 'push', '-q', '-u', 'origin', 'early-birds');

  const ciRun = '101';
  const ciAttempt = '2';
  const deliveryRun = '202';
  const deliveryAttempt = '3';
  const writeRuns = ({ sha = currentSha, ci = {}, delivery = {} } = {}) => {
    fs.writeFileSync(path.join(api, `${ciRun}-${ciAttempt}.json`), JSON.stringify({
      ...validRun({
        id: ciRun,
        attempt: ciAttempt,
        sha,
        workflow: '.github/workflows/early-birds-fast-forward.yml',
        event: 'push',
      }),
      ...ci,
    }));
    fs.writeFileSync(path.join(api, `${deliveryRun}-${deliveryAttempt}.json`), JSON.stringify({
      ...validRun({
        id: deliveryRun,
        attempt: deliveryAttempt,
        sha,
        workflow: '.github/workflows/account-delivery.yml',
        event: 'workflow_dispatch',
      }),
      status: 'in_progress',
      conclusion: null,
      ...delivery,
    }));
  };
  writeRuns();

  const env = {
    ...process.env,
    HB_ACCOUNT_DELIVERY_TEST_MODE: '1',
    HB_ACCOUNT_DELIVERY_WORKSPACE: workspace,
    HB_ACCOUNT_DELIVERY_API_FIXTURES: api,
    HB_ACCOUNT_DELIVERY_STATE_DIR: state,
    HB_ACCOUNT_DELIVERY_RECEIPT_DIR: receipts,
    HB_ACCOUNT_DELIVERY_LOCK_DIR: locks,
    HB_ACCOUNT_DELIVERY_DEPLOY_ENV: deployEnv,
  };
  const helperArgs = (verb, sha = currentSha, operation = 'deploy') => [
    verb, 'staging', sha, ciRun, ciAttempt, deliveryRun, deliveryAttempt, operation,
  ];
  const invoke = (verb, sha = currentSha, operation = 'deploy') => run(
    path.join(workspace, 'ops/beacon-account/delivery/hb-account-delivery-root'),
    helperArgs(verb, sha, operation),
    { cwd: workspace, env },
  );

  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    api,
    ciAttempt,
    ciRun,
    currentSha,
    deliveryAttempt,
    deliveryRun,
    env,
    helperArgs,
    invoke,
    locks,
    origin,
    staleSha,
    workspace,
    writeRuns,
  };
}

test('workflow validates PRs and binds manual delivery to early-birds, exact runs, environments and dedicated runners', () => {
  const workflow = read(WORKFLOW);
  assert.match(workflow, /pull_request:[\s\S]*branches: \[early-birds\]/);
  assert.match(workflow, /workflow_dispatch:[\s\S]*sha:[\s\S]*ci_run_id:[\s\S]*ci_run_attempt:/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /github\.ref[^\n]*refs\/heads\/early-birds/);
  assert.match(workflow, /permissions:\s*\n\s+actions: read\s*\n\s+contents: read/);
  assert.match(workflow, /concurrency:[\s\S]*cancel-in-progress: false/);
  assert.match(workflow, /environment: account-staging/);
  assert.match(workflow, /environment: account-production/);
  assert.match(workflow, /runs-on: \[self-hosted, mona, account-staging\]/);
  assert.match(workflow, /runs-on: \[self-hosted, mona, account-production\]/);
  assert.match(workflow, /GITHUB_RUN_ID/);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT/);
  assert.match(workflow, /early-birds-fast-forward\.yml/);
  const laneWorkflow = read(path.join(REPOSITORY, '.github/workflows/early-birds-fast-forward.yml'));
  assert.equal((laneWorkflow.match(/\.github\/workflows\/account-delivery\.yml/g) ?? []).length, 2);
  assert.match(workflow, /ACCOUNT_PRODUCTION_PROTECTED_V1/);
  assert.doesNotMatch(workflow, /docker(?:\s+compose)?|compose\s+(?:up|build)|sudo -n (?:bash|sh|git)/);
  for (const line of workflow.split('\n').filter((entry) => entry.includes('sudo -n'))) {
    assert.match(line, /sudo -n \/usr\/local\/sbin\/hb-account-delivery/);
  }
});

test('root helper and sudoers expose only bounded Account verbs and no arbitrary privileged command surface', () => {
  const helper = read(HELPER);
  const sudoers = read(SUDOERS);
  assert.match(helper, /\{probe\|status\|preflight\|deploy\|smoke\|rollback\}/);
  for (const verb of ['probe', 'status', 'preflight', 'deploy', 'smoke', 'rollback']) {
    assert.match(helper, new RegExp(`(?:^|\\n)\\s*${verb}\\)`));
    assert.match(sudoers, new RegExp(`/usr/local/sbin/hb-account-delivery ${verb} \\*`));
  }
  assert.match(helper, /refs\/heads\/early-birds:refs\/remotes\/origin\/early-birds/);
  assert.match(helper, /early-birds-fast-forward\.yml/);
  assert.match(helper, /account-delivery\.yml/);
  assert.match(helper, /status.*completed/);
  assert.match(helper, /conclusion.*success/);
  assert.match(helper, /git[^\n]*status --porcelain/);
  assert.match(helper, /flock -n/);
  assert.match(helper, /scripts\/beacon-account\/start\.sh/);
  assert.match(helper, /scripts\/beacon-account\/rollback-app\.sh/);
  assert.match(helper, /account_backup_/);
  assert.match(helper, /isolated-ephemeral-postgres/);
  assert.doesNotMatch(helper, /\beval\b|\bbash -c\b|\bsh -c\b/);
  assert.doesNotMatch(sudoers, /NOPASSWD:\s*ALL|\/(?:usr\/bin\/)?(?:docker|bash|sh|git)\b/);
  assert.notEqual(fs.statSync(HELPER).mode & 0o111, 0);
});

test('helper rejects stale and foreign revisions, wrong lane/run evidence, concurrent use and arbitrary commands', async (t) => {
  const fixture = helperFixture(t);
  assert.equal(fixture.invoke('probe').status, 0);

  const productionWithoutActivation = run(
    path.join(fixture.workspace, 'ops/beacon-account/delivery/hb-account-delivery-root'),
    ['probe', 'production', fixture.currentSha, fixture.ciRun, fixture.ciAttempt,
      fixture.deliveryRun, fixture.deliveryAttempt, 'deploy'],
    { cwd: fixture.workspace, env: fixture.env },
  );
  assert.notEqual(productionWithoutActivation.status, 0);
  assert.match(productionWithoutActivation.stderr, /production-activation/);

  const interruptionWithoutFixture = fixture.invoke('probe', fixture.currentSha, 'interruption-checkpoint');
  assert.notEqual(interruptionWithoutFixture.status, 0);
  assert.match(interruptionWithoutFixture.stderr, /staging-synthetic-fixture/);

  git(fixture.workspace, 'checkout', '-q', '--detach', fixture.staleSha);
  fixture.writeRuns({ sha: fixture.staleSha });
  const stale = fixture.invoke('probe', fixture.staleSha);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /stale|remote early-birds tip/i);

  git(fixture.workspace, 'checkout', '-q', '-B', 'foreign', fixture.currentSha);
  fs.writeFileSync(path.join(fixture.workspace, 'foreign'), 'foreign\n');
  git(fixture.workspace, 'add', 'foreign');
  git(fixture.workspace, 'commit', '-q', '-m', 'foreign fixture');
  const foreignSha = git(fixture.workspace, 'rev-parse', 'HEAD');
  fixture.writeRuns({ sha: foreignSha });
  const foreign = fixture.invoke('probe', foreignSha);
  assert.notEqual(foreign.status, 0);
  assert.match(foreign.stderr, /foreign|remote early-birds tip/i);

  git(fixture.workspace, 'checkout', '-q', 'early-birds');
  fixture.writeRuns({ ci: { head_branch: 'main' } });
  const wrongLane = fixture.invoke('probe');
  assert.notEqual(wrongLane.status, 0);
  assert.match(wrongLane.stderr, /lane|early-birds/i);

  fixture.writeRuns({ ci: { id: 999 } });
  const wrongRun = fixture.invoke('probe');
  assert.notEqual(wrongRun.status, 0);
  assert.match(wrongRun.stderr, /run id/i);

  fixture.writeRuns({ delivery: { status: 'completed', conclusion: 'success' } });
  const foreignDeliveryAttempt = fixture.invoke('probe');
  assert.notEqual(foreignDeliveryAttempt.status, 0);
  assert.match(foreignDeliveryAttempt.stderr, /current in-progress attempt/i);
  fixture.writeRuns();

  const lock = path.join(fixture.locks, 'beacon-account-delivery-staging.lock');
  const holder = spawn('flock', [lock, 'sh', '-c', 'printf locked; read line'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    holder.stdout.once('data', resolve);
    holder.once('error', reject);
  });
  const concurrent = fixture.invoke('probe');
  holder.stdin.end('\n');
  await new Promise((resolve) => holder.once('exit', resolve));
  assert.notEqual(concurrent.status, 0);
  assert.match(concurrent.stderr, /another staging delivery is active/i);

  const marker = path.join(path.dirname(fixture.workspace), 'arbitrary-command-ran');
  const arbitrary = run(
    path.join(fixture.workspace, 'ops/beacon-account/delivery/hb-account-delivery-root'),
    ['bash', '-c', `touch ${marker}`],
    { cwd: fixture.workspace, env: fixture.env },
  );
  assert.notEqual(arbitrary.status, 0);
  assert.equal(fs.existsSync(marker), false);
});

test('receipt schema and validator require artifact, config, isolated restore, runtime, run and rollback evidence without private material', () => {
  const schema = JSON.parse(read(SCHEMA));
  assert.equal(schema.$id, 'https://harmonicbeacon.com/contracts/account-delivery-receipt.v1.schema.json');
  const receipt = JSON.parse(read(RECEIPT));
  assert.equal(run(process.execPath, [VALIDATOR, RECEIPT]).status, 0);

  for (const [label, mutate] of [
    ['artifact digest', (value) => { delete value.artifact.digest; }],
    ['config hash', (value) => { delete value.config_contract_sha256; }],
    ['restore proof', (value) => { delete value.backup.isolated_restore; }],
    ['worker proof', (value) => { delete value.checks.worker; }],
    ['workflow run', (value) => { delete value.actions.delivery.run_id; }],
    ['rollback result', (value) => { delete value.rollback.result; }],
  ]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'account-receipt-invalid-'));
    const invalid = structuredClone(receipt);
    mutate(invalid);
    const file = path.join(directory, 'receipt.json');
    fs.writeFileSync(file, JSON.stringify(invalid));
    const result = run(process.execPath, [VALIDATOR, file]);
    fs.rmSync(directory, { recursive: true, force: true });
    assert.notEqual(result.status, 0, label);
  }

  const serialized = JSON.stringify(receipt);
  assert.doesNotMatch(serialized, /(?:password|secret|token|authorization)/i);
  assert.doesNotMatch(serialized, /\/(?:home|etc|mnt|opt|run|var)\//);
});

test('staging interruption checkpoint is deterministic, staging-only and restores prior app/worker state', (t) => {
  const source = read(START);
  assert.match(source, /interrupt-after-cutover/);
  assert.match(source, /environment.*staging/);
  assert.ok(source.indexOf('account_compose up -d account-mail-worker-staging account-staging') < source.indexOf('deterministic staging interruption checkpoint'));
  assert.ok(source.indexOf('deterministic staging interruption checkpoint') < source.indexOf('account_verify_running'));

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'account-interruption-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.copyFileSync(START, path.join(directory, 'start.sh'));
  fs.chmodSync(path.join(directory, 'start.sh'), 0o755);
  const log = path.join(directory, 'calls.log');
  fs.writeFileSync(path.join(directory, 'deploy.env'), 'synthetic\n');
  fs.writeFileSync(path.join(directory, 'lib.sh'), `
account_fail() { echo "beacon-account: $*" >&2; exit 1; }
account_load_deploy_env() { :; }
account_require_internal_mail_network() { :; }
account_repo_root() { printf '%s\\n' "$MOCK_ROOT"; }
account_capture_previous_runtime() { echo "${'a'.repeat(40)}"; }
account_capture_previous_worker() { echo 1; }
account_compose() { printf 'compose:%s\\n' "$*" >> "$MOCK_LOG"; }
account_validate() { :; }
account_restore_previous_runtime() { printf 'restore:%s:%s:%s\\n' "$1" "$2" "$3" >> "$MOCK_LOG"; }
account_verify_running() { printf 'verify:%s\\n' "$*" >> "$MOCK_LOG"; }
`);
  const bin = path.join(directory, 'bin');
  writeExecutable(path.join(bin, 'git'), `#!/bin/sh
case "$*" in *'rev-parse HEAD'*) echo "$MOCK_SHA" ;; *'status --porcelain'*) : ;; *) exit 2 ;; esac
`);
  writeExecutable(path.join(bin, 'docker'), `#!/bin/sh
echo "BEACON_GIT_SHA=$MOCK_SHA"
`);
  const patched = read(path.join(directory, 'start.sh')).replace('/run/lock', directory);
  fs.writeFileSync(path.join(directory, 'start.sh'), patched);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    MOCK_LOG: log,
    MOCK_ROOT: REPOSITORY,
    MOCK_SHA: SHA,
    BEACON_ACCOUNT_GIT_SHA: SHA,
    BEACON_ACCOUNT_IMAGE_TAG: SHA,
  };
  const interrupted = run(path.join(directory, 'start.sh'), [
    'staging', path.join(directory, 'deploy.env'), 'interrupt-after-cutover',
  ], { env });
  assert.notEqual(interrupted.status, 0);
  assert.match(interrupted.stderr, /deterministic staging interruption checkpoint/);
  const calls = read(log);
  assert.match(calls, /compose:up -d account-mail-worker-staging account-staging/);
  assert.match(calls, new RegExp(`restore:staging:${'a'.repeat(40)}:1`));

  fs.writeFileSync(log, '');
  const production = run(path.join(directory, 'start.sh'), [
    'production', path.join(directory, 'deploy.env'), 'interrupt-after-cutover',
  ], { env });
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /staging-only/);
  assert.equal(read(log), '');
});
