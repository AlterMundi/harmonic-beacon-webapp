import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

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

function writeBundleManifest(bundle) {
  const source = path.join(bundle, 'source');
  const files = [];
  const visit = (directory) => {
    fs.chmodSync(directory, 0o700);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) {
        fs.chmodSync(absolute, (fs.statSync(absolute).mode & 0o111) === 0 ? 0o600 : 0o700);
        files.push(path.relative(source, absolute).split(path.sep).join('/'));
      } else throw new Error(`unsupported test bundle entry: ${absolute}`);
    }
  };
  visit(source);
  files.sort();
  const manifest = files.map((relative) => {
    const digest = createHash('sha256').update(fs.readFileSync(path.join(source, relative))).digest('hex');
    return `${digest}  ${relative}`;
  }).join('\n');
  fs.writeFileSync(path.join(bundle, 'manifest.sha256'), `${manifest}\n`, { mode: 0o600 });
}

function configContractHash(source) {
  const files = [
    'ops/beacon-account/compose.yml',
    'ops/beacon-account/validate.mjs',
    'ops/beacon-account/deploy.env.synthetic.example',
    'ops/beacon-account/account.production.env.example',
    'ops/beacon-account/account.staging.env.example',
    'ops/beacon-account/account-mail-worker.production.env.example',
    'ops/beacon-account/account-mail-worker.staging.env.example',
    'ops/beacon-account/database.staging.env.example',
  ].sort();
  const value = createHash('sha256');
  for (const relative of files) {
    const payload = fs.readFileSync(path.join(source, relative));
    value.update(relative).update('\0').update(createHash('sha256').update(payload).digest());
  }
  return value.digest('hex');
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
  const trustRoot = path.join(root, 'trusted');
  const bundle = path.join(trustRoot, 'bundle');
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
  fs.copyFileSync(VALIDATOR, path.join(workspace, 'ops/beacon-account/delivery/validate-receipt.mjs'));
  fs.writeFileSync(path.join(workspace, 'scripts/beacon-account/lib.sh'), `
account_load_deploy_env() { BEACON_ACCOUNT_GIT_SHA="$HB_TEST_SHA"; BEACON_ACCOUNT_IMAGE_TAG="$HB_TEST_SHA"; export BEACON_ACCOUNT_GIT_SHA BEACON_ACCOUNT_IMAGE_TAG; }
account_require_internal_mail_network() { :; }
account_capture_previous_runtime() { printf '%040d\\n' 1; }
account_capture_previous_worker() { printf '\\n'; }
account_backup_staging() {
  local directory="\${HB_TEST_RUNTIME_RESTORED%/*}"
  printf 'backup-called\\n' >> "$directory/backup.log"
  printf 'synthetic encrypted backup\\n' > "$directory/backup.enc"
  chmod 0600 "$directory/backup.enc"
  printf '%s\\n' "$directory/backup.enc"
}
account_verify_running() { test -f "$HB_TEST_RUNTIME_RESTORED"; }
account_image_supports_navigation_asset() { return 1; }
openssl() {
  local input=''
  while [ "$#" -gt 0 ]; do
    if [ "$1" = -in ]; then input="$2"; shift 2; else shift; fi
  done
  cat "$input"
}
docker() {
  if [ "$1" = inspect ]; then return 1; fi
  if [ "$1" = volume ] && [ "$2" = inspect ]; then return 1; fi
  case "$*" in
    *pg_restore*) cat >/dev/null ;;
    *'SELECT count'*) printf '1\\n' ;;
    *'{{.Id}}'*) printf 'sha256:%064d\\n' 0 ;;
    *'RepoDigests'*) printf 'harmonic-beacon/account@sha256:%064d\\n' 1 ;;
    *) return 0 ;;
  esac
}
`);
  writeExecutable(path.join(workspace, 'scripts/beacon-account/rollback-app.sh'), `#!/bin/sh
set -eu
printf 'rollback-called\\n' >> "$HB_TEST_ROLLBACK_LOG"
: > "$HB_TEST_RUNTIME_RESTORED"
`);
  writeExecutable(path.join(workspace, 'scripts/beacon-account/health-smoke.sh'), `#!/bin/sh
set -eu
test -f "$HB_TEST_RUNTIME_RESTORED"
printf 'health-verified\\n' >> "$HB_TEST_HEALTH_LOG"
`);
  writeExecutable(path.join(workspace, 'scripts/beacon-account/start.sh'), `#!/bin/sh
set -eu
directory="\${HB_TEST_RUNTIME_RESTORED%/*}"
printf 'start-called\\n' >> "$directory/start.log"
[ "\${3:-normal}" = interrupt-after-cutover ] && exit 99
exit 0
`);
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
  fs.mkdirSync(bundle, { recursive: true, mode: 0o700 });
  fs.chmodSync(trustRoot, 0o700);
  fs.chmodSync(bundle, 0o700);
  fs.cpSync(workspace, path.join(bundle, 'source'), {
    recursive: true,
    filter: (source) => !source.split(path.sep).includes('.git'),
  });
  fs.writeFileSync(path.join(bundle, 'source.sha'), `${currentSha}\n`, { mode: 0o600 });
  writeBundleManifest(bundle);
  const configSha = configContractHash(path.join(bundle, 'source'));

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
      inputs: {
        target: 'staging',
        sha,
        ci_run_id: ciRun,
        ci_run_attempt: ciAttempt,
        config_contract_sha256: configSha,
        operation: 'deploy',
      },
      ...delivery,
    }));
  };
  writeRuns();
  fs.writeFileSync(path.join(api, 'branch.json'), JSON.stringify({
    ref: 'refs/heads/early-birds', object: { type: 'commit', sha: currentSha },
  }));

  const env = {
    ...process.env,
    HB_ACCOUNT_DELIVERY_TEST_MODE: '1',
    HB_ACCOUNT_DELIVERY_WORKSPACE: workspace,
    HB_ACCOUNT_DELIVERY_API_FIXTURES: api,
    HB_ACCOUNT_DELIVERY_STATE_DIR: state,
    HB_ACCOUNT_DELIVERY_RECEIPT_DIR: receipts,
    HB_ACCOUNT_DELIVERY_LOCK_DIR: locks,
    HB_ACCOUNT_DELIVERY_DEPLOY_ENV: deployEnv,
    HB_ACCOUNT_DELIVERY_BUNDLE: bundle,
    HB_ACCOUNT_DELIVERY_TRUST_ROOT: trustRoot,
    HB_ACCOUNT_DELIVERY_STATE_TRUST_ROOT: root,
    HB_TEST_SHA: currentSha,

    HB_TEST_ROLLBACK_LOG: path.join(root, 'rollback.log'),
    HB_TEST_HEALTH_LOG: path.join(root, 'health.log'),
    HB_TEST_RUNTIME_RESTORED: path.join(root, 'runtime-restored'),
  };
  const helperArgs = (verb, sha = currentSha, operation = 'deploy') => [
    verb, 'staging', sha, ciRun, ciAttempt, deliveryRun, deliveryAttempt, operation,
    configSha,
  ];
  const invoke = (verb, sha = currentSha, operation = 'deploy') => run(
    path.join(workspace, 'ops/beacon-account/delivery/hb-account-delivery-root'),
    helperArgs(verb, sha, operation),
    { cwd: workspace, env },
  );

  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return {
    api,
    bundle,
    ciAttempt,
    ciRun,
    configSha,
    currentSha,
    deliveryAttempt,
    deliveryRun,
    env,
    helperArgs,
    invoke,
    locks,
    origin,
    receipts,
    root,
    staleSha,
    state,
    workspace,
    writeRuns,
  };
}

test('workflow validates PRs and binds manual delivery to early-birds, exact runs, environments and dedicated runners', () => {
  const workflow = read(WORKFLOW);
  assert.match(workflow, /pull_request:[\s\S]*branches: \[early-birds\]/);
  assert.match(workflow, /workflow_dispatch:[\s\S]*sha:[\s\S]*ci_run_id:[\s\S]*ci_run_attempt:[\s\S]*config_contract_sha256:/);
  assert.match(workflow, /\^\[0-9a-f\]\{40\}\$/);
  assert.match(workflow, /HB_GITHUB_REF: \$\{\{ github\.ref \}\}[\s\S]*test "\$HB_GITHUB_REF" = refs\/heads\/early-birds/);
  assert.match(workflow, /permissions:\s*\n\s+actions: read\s*\n\s+contents: read/);
  assert.match(workflow, /concurrency:[\s\S]*cancel-in-progress: false/);
  assert.match(workflow, /environment: account-staging/);
  assert.match(workflow, /environment: account-production/);
  assert.match(workflow, /runs-on: \[self-hosted, mona, account-staging\]/);
  assert.match(workflow, /runs-on: \[self-hosted, mona, account-production\]/);
  assert.match(workflow, /GITHUB_RUN_ID/);
  assert.match(workflow, /GITHUB_RUN_ATTEMPT/);
  assert.match(workflow, /early-birds-fast-forward\.yml/);
  assert.match(workflow, /HB_INPUT_CONFIG_CONTRACT_SHA256: \$\{\{ inputs\.config_contract_sha256 \}\}/);
  const laneWorkflow = read(path.join(REPOSITORY, '.github/workflows/early-birds-fast-forward.yml'));
  assert.equal((laneWorkflow.match(/\.github\/workflows\/account-delivery\.yml/g) ?? []).length, 2);
  assert.match(workflow, /ACCOUNT_PRODUCTION_PROTECTED_V1/);
  assert.doesNotMatch(workflow, /docker(?:\s+compose)?|compose\s+(?:up|build)|sudo -n (?:bash|sh|git)/);
  for (const line of workflow.split('\n').filter((entry) => entry.includes('sudo -n'))) {
    assert.match(line, /sudo -n \/usr\/local\/sbin\/hb-account-delivery/);
  }
  const actionPins = [...workflow.matchAll(/uses:\s+([^\s]+)@([^\s]+)/g)];
  assert.ok(actionPins.length >= 2);
  for (const [, action, revision] of actionPins) {
    assert.match(revision, /^[0-9a-f]{40}$/, `${action} must use an immutable SHA40 pin`);
  }
  const selfHosted = workflow.slice(workflow.indexOf('  staging-delivery:'));
  assert.doesNotMatch(selfHosted, /actions\/checkout@/, 'privileged jobs must not consume a runner checkout');
});

test('root helper and sudoers expose only bounded Account verbs and no arbitrary privileged command surface', () => {
  const helper = read(HELPER);
  const sudoers = read(SUDOERS);
  assert.match(helper, /\{probe\|status\|preflight\|deploy\|smoke\|rollback\}/);
  for (const verb of ['probe', 'status', 'preflight', 'deploy', 'smoke', 'rollback']) {
    assert.match(helper, new RegExp(`(?:^|\\n)\\s*${verb}\\)`));
    assert.match(sudoers, new RegExp(`/usr/local/sbin/hb-account-delivery ${verb} \\*`));
  }
  assert.match(helper, /git\/ref\/heads\/early-birds/);
  assert.match(helper, /early-birds-fast-forward\.yml/);
  assert.match(helper, /account-delivery\.yml/);
  assert.match(helper, /status.*completed/);
  assert.match(helper, /conclusion.*success/);
  assert.match(helper, /source\.sha/);
  assert.match(helper, /closed source inventory differs from manifest/);
  assert.match(helper, /flock -n/);
  assert.match(helper, /\$SOURCE_ROOT\/scripts\/beacon-account\/start\.sh/);
  assert.match(helper, /scripts\/beacon-account\/rollback-app\.sh/);
  assert.match(helper, /account_backup_/);
  assert.match(helper, /isolated-ephemeral-postgres/);
  assert.doesNotMatch(helper, /\beval\b|\bbash -c\b|\bsh -c\b/);
  assert.doesNotMatch(sudoers, /NOPASSWD:\s*ALL|\/(?:usr\/bin\/)?(?:docker|bash|sh|git)\b/);
  assert.notEqual(fs.statSync(HELPER).mode & 0o111, 0);
});

test('installed root lifecycle entrypoints never invoke Git or runner-selected helpers', () => {
  const helper = read(HELPER);
  const start = read(path.join(REPOSITORY, 'scripts/beacon-account/start.sh'));
  const rollback = read(path.join(REPOSITORY, 'scripts/beacon-account/rollback-app.sh'));
  assert.ok(helper.startsWith('#!/bin/bash\n'), 'root entrypoint must not resolve its interpreter through runner PATH');
  assert.match(helper, /HOME='\/'[\s\S]*PYTHONNOUSERSITE=1/);
  assert.doesNotMatch(helper, /python3(?! -I)/);
  assert.doesNotMatch(helper, /(?:^|[;&|()]|\s)git(?:\s|$)/m);
  assert.doesNotMatch(start, /(?:^|[;&|()]|\s)git(?:\s|$)/m);
  assert.doesNotMatch(rollback, /(?:^|[;&|()]|\s)git(?:\s|$)/m);
  assert.doesNotMatch(helper, /\$\{?GITHUB_WORKSPACE|\/home\/|WORKSPACE\/scripts/);
  assert.match(helper, /st_uid != expected_uid/);
  assert.match(start, /HB_ACCOUNT_TRUSTED_SOURCE_SHA/);
});

test('root authority ignores runner Git configuration and requires a trusted installed lifecycle bundle', (t) => {
  const fixture = helperFixture(t);
  const marker = path.join(fixture.root, 'runner-git-hook-executed');
  const hook = path.join(fixture.root, 'runner-fsmonitor');
  writeExecutable(hook, `#!/bin/sh\nprintf executed > "${marker}"\nexit 1\n`);
  git(fixture.workspace, 'config', 'core.fsmonitor', hook);
  git(fixture.workspace, 'config', 'core.sshCommand', hook);
  git(fixture.workspace, 'remote', 'set-url', 'origin', `ext::sh -c 'touch ${marker}'`);
  for (const relative of [
    'scripts/beacon-account/lib.sh',
    'scripts/beacon-account/start.sh',
    'scripts/beacon-account/rollback-app.sh',
    'scripts/beacon-account/health-smoke.sh',
    'ops/beacon-account/delivery/validate-receipt.mjs',
    'ops/beacon-account/compose.yml',
  ]) {
    fs.writeFileSync(path.join(fixture.workspace, relative), `runner-controlled-$() \`\` ${marker}\n`);
  }

  const result = fixture.invoke('probe');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(marker), false, result.stderr);

  const runnerBin = path.join(fixture.workspace, 'runner-bin');
  for (const binary of ['bash', 'python3', 'git', 'curl']) {
    writeExecutable(path.join(runnerBin, binary), `#!/bin/sh\ntouch "${marker}"\nexit 90\n`);
  }
  const hostilePathResult = run(path.join(fixture.workspace, 'ops/beacon-account/delivery/hb-account-delivery-root'),
    fixture.helperArgs('probe'), {
      cwd: fixture.workspace,
      env: { ...fixture.env, PATH: `${runnerBin}:${process.env.PATH}` },
    });
  assert.equal(hostilePathResult.status, 0, hostilePathResult.stderr);
  assert.equal(fs.existsSync(marker), false, hostilePathResult.stderr);

  const hostileFunctionResult = run(path.join(fixture.workspace, 'ops/beacon-account/delivery/hb-account-delivery-root'),
    fixture.helperArgs('probe'), {
      cwd: fixture.workspace,
      env: {
        ...fixture.env,
        [`BASH_FUNC_python3%%`]: `() { touch "${marker}"; return 90; }`,
      },
    });
  assert.equal(hostileFunctionResult.status, 0, hostileFunctionResult.stderr);
  assert.equal(fs.existsSync(marker), false, hostileFunctionResult.stderr);

  const helper = read(HELPER);
  assert.match(helper, /HB_ACCOUNT_DELIVERY_BUNDLE/);
  assert.match(helper, /manifest\.sha256/);
  assert.doesNotMatch(helper, /git\s+(?:-c|-C|fetch|status|rev-parse|merge-base)|\$WORKSPACE\/scripts/);
});

test('runner repo script swap after installed-source validation cannot reach root lifecycle execution', async (t) => {
  const fixture = helperFixture(t);
  const previous = 'd'.repeat(40);
  fs.writeFileSync(path.join(fixture.state, `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`),
    `${JSON.stringify({
      phase: 'deployed', target: 'staging', operation: 'deploy', sha: fixture.currentSha,
      ci_run: fixture.ciRun, ci_attempt: Number(fixture.ciAttempt),
      delivery_run: fixture.deliveryRun, delivery_attempt: Number(fixture.deliveryAttempt),
      previous_sha: previous, previous_worker: false, backup_path: '/test/unused',
      backup_hash: 'e'.repeat(64), config_hash: fixture.configSha,
      restore: { status: 'verified', mode: 'isolated-ephemeral-postgres', cleanup: 'verified' },
    })}\n`, { mode: 0o600 });

  const branch = path.join(fixture.api, 'branch.json');
  fs.rmSync(branch);
  assert.equal(run('mkfifo', [branch]).status, 0);
  const ready = path.join(fixture.root, 'api-reader-ready');
  const go = path.join(fixture.root, 'api-writer-go');
  const payload = JSON.stringify({ ref: 'refs/heads/early-birds', object: { type: 'commit', sha: fixture.currentSha } });
  const writer = spawn('python3', ['-c', [
    'import os, pathlib, sys, time',
    'fifo, ready, go, payload = sys.argv[1:]',
    'fd = os.open(fifo, os.O_WRONLY)',
    'pathlib.Path(ready).write_text("ready\\n")',
    'while not pathlib.Path(go).exists(): time.sleep(0.01)',
    'os.write(fd, payload.encode())',
    'os.close(fd)',
  ].join('\n'), branch, ready, go, payload]);
  const command = path.join(fixture.workspace, 'ops/beacon-account/delivery/hb-account-delivery-root');
  const helper = spawn(command, fixture.helperArgs('rollback'), {
    cwd: fixture.workspace, env: fixture.env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  helper.stderr.setEncoding('utf8');
  helper.stderr.on('data', (value) => { stderr += value; });
  for (let attempt = 0; attempt < 500 && !fs.existsSync(ready); attempt += 1) await delay(10);
  assert.equal(fs.existsSync(ready), true, 'helper never reached API after installed-source validation');
  const runnerMarker = path.join(fixture.root, 'late-runner-swap-executed');
  writeExecutable(path.join(fixture.workspace, 'scripts/beacon-account/rollback-app.sh'),
    `#!/bin/sh\ntouch "${runnerMarker}"\nexit 0\n`);
  fs.writeFileSync(go, 'go\n');
  const [[writerCode], [helperCode]] = await Promise.all([once(writer, 'close'), once(helper, 'close')]);
  assert.equal(writerCode, 0);
  assert.equal(helperCode, 0, stderr);
  assert.equal(fs.existsSync(runnerMarker), false);
  assert.equal(read(fixture.env.HB_TEST_ROLLBACK_LOG).trim(), 'rollback-called');
});

test('installed manifest accepts reviewed Next.js bracket routes without broad path syntax', (t) => {
  const fixture = helperFixture(t);
  const route = path.join(fixture.bundle, 'source/src/app/api/account/[id]/route.ts');
  fs.mkdirSync(path.dirname(route), { recursive: true });
  fs.writeFileSync(route, 'export const route = true;\n');
  writeBundleManifest(fixture.bundle);
  const result = fixture.invoke('probe');
  assert.equal(result.status, 0, result.stderr);
});

test('installed lifecycle bundle rejects writable, symlinked, hard-linked, special, extra or manifest-substituted content', (t) => {
  const fixture = helperFixture(t);
  assert.equal(fixture.invoke('probe').status, 0);
  const compose = path.join(fixture.bundle, 'source/ops/beacon-account/compose.yml');
  const composeBytes = fs.readFileSync(compose);

  fs.chmodSync(compose, 0o666);
  assert.notEqual(fixture.invoke('probe').status, 0);
  fs.chmodSync(compose, 0o600);

  fs.rmSync(compose);
  fs.symlinkSync(path.join(fixture.workspace, 'ops/beacon-account/compose.yml'), compose);
  assert.notEqual(fixture.invoke('probe').status, 0);
  fs.rmSync(compose);
  fs.writeFileSync(compose, composeBytes, { mode: 0o600 });

  fs.rmSync(compose);
  fs.linkSync(path.join(fixture.workspace, 'ops/beacon-account/compose.yml'), compose);
  assert.notEqual(fixture.invoke('probe').status, 0);
  fs.rmSync(compose);
  fs.writeFileSync(compose, composeBytes, { mode: 0o600 });

  fs.rmSync(compose);
  const fifo = run('mkfifo', [compose]);
  assert.equal(fifo.status, 0, fifo.stderr);
  fs.chmodSync(compose, 0o600);
  assert.notEqual(fixture.invoke('probe').status, 0);
  fs.rmSync(compose);
  fs.writeFileSync(compose, composeBytes, { mode: 0o600 });

  const trustRoot = fixture.env.HB_ACCOUNT_DELIVERY_TRUST_ROOT;
  fs.chmodSync(trustRoot, 0o777);
  assert.notEqual(fixture.invoke('probe').status, 0);
  fs.chmodSync(trustRoot, 0o700);

  const extra = path.join(fixture.bundle, 'source/runner-extra');
  fs.writeFileSync(extra, 'extra\n', { mode: 0o600 });
  assert.notEqual(fixture.invoke('probe').status, 0);
  fs.rmSync(extra);

  const manifest = path.join(fixture.bundle, 'manifest.sha256');
  const manifestBytes = fs.readFileSync(manifest);
  fs.rmSync(manifest);
  fs.symlinkSync(path.join(fixture.workspace, 'marker'), manifest);
  assert.notEqual(fixture.invoke('probe').status, 0);
  fs.rmSync(manifest);
  fs.writeFileSync(manifest, manifestBytes, { mode: 0o600 });
  assert.equal(fixture.invoke('probe').status, 0);
});

test('typed workflow-dispatch evidence binds target, source, CI evidence, operation, run and attempt', (t) => {
  const fixture = helperFixture(t);
  fs.writeFileSync(path.join(fixture.state, 'production-activation'), 'account-production-protected-environment-v1\n', { mode: 0o600 });
  const invokeProduction = () => run(
    path.join(fixture.workspace, 'ops/beacon-account/delivery/hb-account-delivery-root'),
    ['probe', 'production', fixture.currentSha, fixture.ciRun, fixture.ciAttempt,
      fixture.deliveryRun, fixture.deliveryAttempt, 'deploy', fixture.configSha],
    { cwd: fixture.workspace, env: fixture.env },
  );

  const mismatches = [
    { target: 'staging', sha: fixture.currentSha, ci_run_id: fixture.ciRun, ci_run_attempt: fixture.ciAttempt, operation: 'deploy' },
    { target: 'production', sha: 'a'.repeat(40), ci_run_id: fixture.ciRun, ci_run_attempt: fixture.ciAttempt, operation: 'deploy' },
    { target: 'production', sha: fixture.currentSha, ci_run_id: '999', ci_run_attempt: fixture.ciAttempt, operation: 'deploy' },
    { target: 'production', sha: fixture.currentSha, ci_run_id: fixture.ciRun, ci_run_attempt: '9', operation: 'deploy' },
    { target: 'production', sha: fixture.currentSha, ci_run_id: fixture.ciRun, ci_run_attempt: fixture.ciAttempt, operation: 'interruption-checkpoint' },
    { target: 'production', sha: fixture.currentSha, ci_run_id: fixture.ciRun, ci_run_attempt: fixture.ciAttempt, config_contract_sha256: 'f'.repeat(64), operation: 'deploy' },
  ];
  for (const inputs of mismatches) {
    fixture.writeRuns({ delivery: { inputs } });
    const result = invokeProduction();
    assert.notEqual(result.status, 0, JSON.stringify(inputs));
    assert.match(result.stderr, /dispatch inputs|input .*mismatch/i);
  }
  fixture.writeRuns({ delivery: { inputs: {
    target: 'production', sha: fixture.currentSha, ci_run_id: fixture.ciRun,
    ci_run_attempt: fixture.ciAttempt, config_contract_sha256: fixture.configSha,
    operation: 'deploy',
  } } });
  assert.equal(invokeProduction().status, 0);
});

test('delivery state and lock reject a writable trusted ancestor', (t) => {
  const fixture = helperFixture(t);
  fs.chmodSync(fixture.root, 0o777);
  const result = fixture.invoke('probe');
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /trusted state ancestor|owner or mode/i);
});

test('delivery lock cannot follow a symlink or truncate another file', (t) => {
  const fixture = helperFixture(t);
  const victim = path.join(fixture.root, 'lock-victim');
  fs.writeFileSync(victim, 'must-survive\n', { mode: 0o600 });
  const legacyLock = path.join(fixture.locks, 'beacon-account-delivery-staging.lock');
  fs.symlinkSync(victim, legacyLock);
  const result = fixture.invoke('probe');
  assert.equal(read(victim), 'must-survive\n', result.stderr);
  assert.equal(fs.lstatSync(legacyLock).isSymbolicLink(), true);
  assert.match(read(HELPER), /STATE_DIR.*delivery.*lock|delivery.*lock.*STATE_DIR/);
});

test('exact preflight replay returns the durable state without repeating backup or restore effects', (t) => {
  const fixture = helperFixture(t);
  const stateFile = path.join(fixture.state, `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`);
  const first = fixture.invoke('preflight');
  assert.equal(first.status, 0, first.stderr);
  const firstState = read(stateFile);
  const replay = fixture.invoke('preflight');
  assert.equal(replay.status, 0, replay.stderr);
  assert.equal(read(stateFile), firstState);
  assert.equal(read(path.join(fixture.root, 'backup.log')).trim().split('\n').length, 1);
});

test('conflicting durable preflight state fails closed instead of being replaced', (t) => {
  const fixture = helperFixture(t);
  assert.equal(fixture.invoke('preflight').status, 0);
  const stateFile = path.join(fixture.state, `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`);
  const state = JSON.parse(read(stateFile));
  state.sha = 'f'.repeat(40);
  const poisoned = `${JSON.stringify(state)}\n`;
  fs.writeFileSync(stateFile, poisoned, { mode: 0o600 });
  const result = fixture.invoke('preflight');
  assert.notEqual(result.status, 0);
  assert.equal(read(stateFile), poisoned);
  assert.equal(read(path.join(fixture.root, 'backup.log')).trim().split('\n').length, 1);
});

test('exact deploy replay returns from durable deployed state without repeating cutover', (t) => {
  const fixture = helperFixture(t);
  assert.equal(fixture.invoke('preflight').status, 0);

  const first = fixture.invoke('deploy');
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(read(path.join(fixture.state,
    `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`))).phase, 'deployed');

  const replay = fixture.invoke('deploy');
  assert.equal(replay.status, 0, replay.stderr);
  assert.equal(read(path.join(fixture.root, 'start.log')).trim().split('\n').length, 1);
});

test('successful smoke consumes deployed state before rollback can be replayed', (t) => {
  const fixture = helperFixture(t);
  const previous = 'd'.repeat(40);
  const stateFile = path.join(fixture.state, `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`);
  fs.writeFileSync(stateFile, `${JSON.stringify({
    phase: 'deployed', target: 'staging', operation: 'deploy', sha: fixture.currentSha,
    ci_run: fixture.ciRun, ci_attempt: Number(fixture.ciAttempt),
    delivery_run: fixture.deliveryRun, delivery_attempt: Number(fixture.deliveryAttempt),
    previous_sha: previous, previous_worker: false, backup_path: '/test/unused',
    backup_hash: 'e'.repeat(64), config_hash: fixture.configSha,
    restore: { status: 'verified', mode: 'isolated-ephemeral-postgres', cleanup: 'verified' },
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(fixture.env.HB_TEST_RUNTIME_RESTORED, 'candidate-running\n');

  const smoke = fixture.invoke('smoke');
  assert.equal(smoke.status, 0, smoke.stderr);
  assert.equal(JSON.parse(read(stateFile)).phase, 'delivered');
  const receipt = JSON.parse(read(path.join(fixture.receipts,
    `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`)));
  assert.equal(receipt.outcome, 'deployed');
  const replay = fixture.invoke('rollback');
  assert.notEqual(replay.status, 0);
  assert.equal(fs.existsSync(fixture.env.HB_TEST_ROLLBACK_LOG), false);
});

test('status exports a receipt only when it matches the exact terminal durable state', (t) => {
  const fixture = helperFixture(t);
  const stateFile = path.join(fixture.state, `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`);
  fs.writeFileSync(stateFile, `${JSON.stringify({
    phase: 'deployed', target: 'staging', operation: 'deploy', sha: fixture.currentSha,
    ci_run: fixture.ciRun, ci_attempt: Number(fixture.ciAttempt),
    delivery_run: fixture.deliveryRun, delivery_attempt: Number(fixture.deliveryAttempt),
    previous_sha: 'd'.repeat(40), previous_worker: false, backup_path: '/test/unused',
    backup_hash: 'e'.repeat(64), config_hash: fixture.configSha,
    restore: { status: 'verified', mode: 'isolated-ephemeral-postgres', cleanup: 'verified' },
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(fixture.env.HB_TEST_RUNTIME_RESTORED, 'candidate-running\n');
  assert.equal(fixture.invoke('smoke').status, 0);
  assert.equal(fixture.invoke('status').status, 0);

  const state = JSON.parse(read(stateFile));
  state.phase = 'deployed';
  fs.writeFileSync(stateFile, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  const inconsistent = fixture.invoke('status');
  assert.notEqual(inconsistent.status, 0);
  assert.equal(JSON.parse(read(stateFile)).phase, 'deployed');
});

test('receipt publication uses create-or-compare CAS and never replaces conflicting evidence', (t) => {
  const fixture = helperFixture(t);
  const stateFile = path.join(fixture.state, `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`);
  fs.writeFileSync(stateFile, `${JSON.stringify({
    phase: 'deployed', target: 'staging', operation: 'deploy', sha: fixture.currentSha,
    ci_run: fixture.ciRun, ci_attempt: Number(fixture.ciAttempt),
    delivery_run: fixture.deliveryRun, delivery_attempt: Number(fixture.deliveryAttempt),
    previous_sha: 'd'.repeat(40), previous_worker: false, backup_path: '/test/unused',
    backup_hash: 'e'.repeat(64), config_hash: fixture.configSha,
    restore: { status: 'verified', mode: 'isolated-ephemeral-postgres', cleanup: 'verified' },
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(fixture.env.HB_TEST_RUNTIME_RESTORED, 'candidate-running\n');
  const receiptFile = path.join(fixture.receipts,
    `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`);
  fs.writeFileSync(receiptFile, 'conflicting-evidence\n', { mode: 0o600 });

  const result = fixture.invoke('smoke');
  assert.notEqual(result.status, 0);
  assert.equal(read(receiptFile), 'conflicting-evidence\n');
  assert.equal(JSON.parse(read(stateFile)).phase, 'deployed');
});

test('lost return after receipt publication converges without replacing evidence or repeating mutation', (t) => {
  const fixture = helperFixture(t);
  const stateFile = path.join(fixture.state, `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`);
  fs.writeFileSync(stateFile, `${JSON.stringify({
    phase: 'deployed', target: 'staging', operation: 'deploy', sha: fixture.currentSha,
    ci_run: fixture.ciRun, ci_attempt: Number(fixture.ciAttempt),
    delivery_run: fixture.deliveryRun, delivery_attempt: Number(fixture.deliveryAttempt),
    previous_sha: 'd'.repeat(40), previous_worker: false, backup_path: '/test/unused',
    backup_hash: 'e'.repeat(64), config_hash: fixture.configSha,
    restore: { status: 'verified', mode: 'isolated-ephemeral-postgres', cleanup: 'verified' },
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(fixture.env.HB_TEST_RUNTIME_RESTORED, 'candidate-running\n');
  const receiptFile = path.join(fixture.receipts,
    `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`);
  const helper = path.join(fixture.workspace, 'ops/beacon-account/delivery/hb-account-delivery-root');
  const crashed = run(helper, fixture.helperArgs('smoke'), {
    cwd: fixture.workspace,
    env: { ...fixture.env, HB_ACCOUNT_DELIVERY_TEST_CRASH_AFTER_RECEIPT: '1' },
  });
  assert.notEqual(crashed.status, 0);
  assert.equal(JSON.parse(read(stateFile)).phase, 'deployed');
  const committedReceipt = read(receiptFile);

  const resumed = fixture.invoke('smoke');
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(JSON.parse(read(stateFile)).phase, 'delivered');
  assert.equal(read(receiptFile), committedReceipt);
});

test('exact smoke replay returns the committed receipt without rerunning health checks', (t) => {
  const fixture = helperFixture(t);
  const stateFile = path.join(fixture.state,
    `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`);
  fs.writeFileSync(stateFile, `${JSON.stringify({
    phase: 'deployed', target: 'staging', operation: 'deploy', sha: fixture.currentSha,
    ci_run: fixture.ciRun, ci_attempt: Number(fixture.ciAttempt),
    delivery_run: fixture.deliveryRun, delivery_attempt: Number(fixture.deliveryAttempt),
    previous_sha: 'd'.repeat(40), previous_worker: true, backup_path: '/test/backup.enc',
    backup_hash: 'e'.repeat(64), config_hash: fixture.configSha,
    restore: { status: 'verified', mode: 'isolated-ephemeral-postgres', cleanup: 'verified' },
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(fixture.env.HB_TEST_RUNTIME_RESTORED, 'candidate-running\n');

  const first = fixture.invoke('smoke');
  assert.equal(first.status, 0, first.stderr);
  const receiptFile = path.join(fixture.receipts,
    `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`);
  const committed = read(receiptFile);
  const healthCount = read(fixture.env.HB_TEST_HEALTH_LOG).trim().split('\n').length;

  const replay = fixture.invoke('smoke');
  assert.equal(replay.status, 0, replay.stderr);
  assert.equal(read(receiptFile), committed);
  assert.equal(read(fixture.env.HB_TEST_HEALTH_LOG).trim().split('\n').length, healthCount);
});

test('interruption receipt recovery advances state without repeating the cutover checkpoint', (t) => {
  const fixture = helperFixture(t);
  fixture.writeRuns({ delivery: { inputs: {
    target: 'staging', sha: fixture.currentSha, ci_run_id: fixture.ciRun,
    ci_run_attempt: fixture.ciAttempt, config_contract_sha256: fixture.configSha,
    operation: 'interruption-checkpoint',
  } } });
  const stateFile = path.join(fixture.state, `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`);
  fs.writeFileSync(stateFile, `${JSON.stringify({
    phase: 'preflight', target: 'staging', operation: 'interruption-checkpoint', sha: fixture.currentSha,
    ci_run: fixture.ciRun, ci_attempt: Number(fixture.ciAttempt),
    delivery_run: fixture.deliveryRun, delivery_attempt: Number(fixture.deliveryAttempt),
    previous_sha: 'd'.repeat(40), previous_worker: false, backup_path: '/test/unused',
    backup_hash: 'e'.repeat(64), config_hash: fixture.configSha,
    restore: { status: 'verified', mode: 'isolated-ephemeral-postgres', cleanup: 'verified' },
  })}\n`, { mode: 0o600 });
  fs.writeFileSync(path.join(fixture.state, 'staging-synthetic-fixture'), 'synthetic-non-product-v1\n', { mode: 0o600 });
  fs.writeFileSync(fixture.env.HB_TEST_RUNTIME_RESTORED, 'prior-running\n');
  const helper = path.join(fixture.workspace, 'ops/beacon-account/delivery/hb-account-delivery-root');
  const crashed = run(helper, fixture.helperArgs('deploy', fixture.currentSha, 'interruption-checkpoint'), {
    cwd: fixture.workspace,
    env: { ...fixture.env, HB_ACCOUNT_DELIVERY_TEST_CRASH_AFTER_RECEIPT: '1' },
  });
  assert.notEqual(crashed.status, 0);
  assert.equal(JSON.parse(read(stateFile)).phase, 'preflight');

  const resumed = fixture.invoke('deploy', fixture.currentSha, 'interruption-checkpoint');
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(JSON.parse(read(stateFile)).phase, 'interruption-verified');
  assert.equal(read(path.join(fixture.root, 'start.log')).trim().split('\n').length, 1);
});

test('rollback claim is single-use and crash recovery verifies restoration without repeating rollback', (t) => {
  const fixture = helperFixture(t);
  const previous = 'd'.repeat(40);
  const stateFile = path.join(fixture.state, `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`);
  const stateValue = {
    phase: 'deployed', target: 'staging', operation: 'deploy', sha: fixture.currentSha,
    ci_run: fixture.ciRun, ci_attempt: Number(fixture.ciAttempt),
    delivery_run: fixture.deliveryRun, delivery_attempt: Number(fixture.deliveryAttempt),
    previous_sha: previous, previous_worker: false, backup_path: '/test/unused',
    backup_hash: 'e'.repeat(64), config_hash: fixture.configSha,
    restore: { status: 'verified', mode: 'isolated-ephemeral-postgres', cleanup: 'verified' },
  };
  fs.writeFileSync(stateFile, `${JSON.stringify(stateValue)}\n`, { mode: 0o600 });
  const runnerSwapMarker = path.join(fixture.root, 'runner-swap-executed');
  writeExecutable(path.join(fixture.workspace, 'scripts/beacon-account/rollback-app.sh'), `#!/bin/sh\ntouch "${runnerSwapMarker}"\n`);

  const crashed = fixture.invoke('rollback');
  assert.equal(crashed.status, 0, crashed.stderr);
  assert.equal(fs.existsSync(runnerSwapMarker), false);
  fs.rmSync(fixture.env.HB_TEST_RUNTIME_RESTORED, { force: true });
  fs.writeFileSync(stateFile, `${JSON.stringify(stateValue)}\n`, { mode: 0o600 });
  const crashEnv = { ...fixture.env, HB_ACCOUNT_DELIVERY_TEST_CRASH_AFTER_ROLLBACK: '1' };
  const first = run(path.join(fixture.workspace, 'ops/beacon-account/delivery/hb-account-delivery-root'),
    fixture.helperArgs('rollback'), { cwd: fixture.workspace, env: crashEnv });
  assert.notEqual(first.status, 0);
  assert.equal(read(fixture.env.HB_TEST_ROLLBACK_LOG).trim().split('\n').length, 2);
  assert.equal(JSON.parse(read(stateFile)).phase, 'rollback-pending');

  const resumed = fixture.invoke('rollback');
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(read(fixture.env.HB_TEST_ROLLBACK_LOG).trim().split('\n').length, 2);
  assert.equal(JSON.parse(read(stateFile)).phase, 'rolled-back');
  assert.equal(JSON.parse(read(path.join(fixture.receipts, `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`))).outcome, 'rolled-back');

  const committedReceipt = read(path.join(fixture.receipts, `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`));
  const replay = fixture.invoke('rollback');
  assert.equal(replay.status, 0, replay.stderr);
  assert.equal(read(fixture.env.HB_TEST_ROLLBACK_LOG).trim().split('\n').length, 2);
  assert.equal(read(path.join(fixture.receipts, `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`)), committedReceipt);
});

test('rollback recovery from a durable claim never guesses whether the destructive side effect ran', (t) => {
  const fixture = helperFixture(t);
  const previous = 'd'.repeat(40);
  const stateFile = path.join(fixture.state, `staging-${fixture.deliveryRun}-${fixture.deliveryAttempt}.json`);
  fs.writeFileSync(stateFile, `${JSON.stringify({
    phase: 'deployed', target: 'staging', operation: 'deploy', sha: fixture.currentSha,
    ci_run: fixture.ciRun, ci_attempt: Number(fixture.ciAttempt),
    delivery_run: fixture.deliveryRun, delivery_attempt: Number(fixture.deliveryAttempt),
    previous_sha: previous, previous_worker: false, backup_path: '/test/unused',
    backup_hash: 'e'.repeat(64), config_hash: fixture.configSha,
    restore: { status: 'verified', mode: 'isolated-ephemeral-postgres', cleanup: 'verified' },
  })}\n`, { mode: 0o600 });
  const claimCrash = run(path.join(fixture.workspace, 'ops/beacon-account/delivery/hb-account-delivery-root'),
    fixture.helperArgs('rollback'), {
      cwd: fixture.workspace,
      env: { ...fixture.env, HB_ACCOUNT_DELIVERY_TEST_CRASH_AFTER_ROLLBACK_CLAIM: '1' },
    });
  assert.notEqual(claimCrash.status, 0);
  assert.equal(JSON.parse(read(stateFile)).phase, 'rollback-pending');
  assert.equal(fs.existsSync(fixture.env.HB_TEST_ROLLBACK_LOG), false);

  const ambiguous = fixture.invoke('rollback');
  assert.notEqual(ambiguous.status, 0);
  assert.equal(fs.existsSync(fixture.env.HB_TEST_ROLLBACK_LOG), false);
  fs.writeFileSync(fixture.env.HB_TEST_RUNTIME_RESTORED, 'operator-restored\n');
  const recovered = fixture.invoke('rollback');
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.equal(JSON.parse(read(stateFile)).phase, 'rolled-back');
  assert.equal(fs.existsSync(fixture.env.HB_TEST_ROLLBACK_LOG), false);
});

test('workflow transports dispatch values structurally and shell validation rejects executable metacharacters', (t) => {
  const workflow = read(WORKFLOW);
  const lines = workflow.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(\s*)run:\s*(.*)$/.exec(lines[index]);
    if (!match) continue;
    const indent = match[1].length;
    const block = [match[2]];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const next = lines[cursor];
      if (next.trim() !== '' && next.length - next.trimStart().length <= indent) break;
      block.push(next);
    }
    assert.doesNotMatch(block.join('\n'), /\$\{\{\s*(?:inputs|vars)\./);
  }
  assert.ok(workflow.indexOf('- name: Validate dispatch binding') < workflow.indexOf('- uses: actions/checkout@'),
    'dispatch syntax and branch binding must be validated before checkout consumes the ref');
  for (const name of ['HB_INPUT_TARGET', 'HB_INPUT_SHA', 'HB_INPUT_CI_RUN_ID', 'HB_INPUT_CI_RUN_ATTEMPT', 'HB_INPUT_CONFIG_CONTRACT_SHA256', 'HB_INPUT_OPERATION']) {
    assert.match(workflow, new RegExp(`${name}: \\$\\{\\{ inputs\\.`));
  }

  const fixture = helperFixture(t);
  const marker = path.join(fixture.root, 'expression-injection-executed');
  const payloads = [`$(touch ${marker})`, `\`touch ${marker}\``, `staging\ntouch ${marker}`];
  const base = fixture.helperArgs('probe');
  for (const payload of payloads) {
    for (const position of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const args = [...base];
      args[position] = payload;
      const result = run(path.join(fixture.workspace, 'ops/beacon-account/delivery/hb-account-delivery-root'), args, {
        cwd: fixture.workspace, env: fixture.env,
      });
      assert.notEqual(result.status, 0, `position ${position}: ${JSON.stringify(payload)}`);
      assert.equal(fs.existsSync(marker), false, `position ${position}: ${JSON.stringify(payload)}`);
    }
  }
});

test('helper rejects stale and foreign revisions, wrong lane/run evidence, concurrent use and arbitrary commands', async (t) => {
  const fixture = helperFixture(t);
  assert.equal(fixture.invoke('probe').status, 0);

  fixture.writeRuns({ delivery: { inputs: {
    target: 'production', sha: fixture.currentSha, ci_run_id: fixture.ciRun,
    ci_run_attempt: fixture.ciAttempt, config_contract_sha256: fixture.configSha,
    operation: 'deploy',
  } } });
  const productionWithoutActivation = run(
    path.join(fixture.workspace, 'ops/beacon-account/delivery/hb-account-delivery-root'),
    ['probe', 'production', fixture.currentSha, fixture.ciRun, fixture.ciAttempt,
      fixture.deliveryRun, fixture.deliveryAttempt, 'deploy', fixture.configSha],
    { cwd: fixture.workspace, env: fixture.env },
  );
  assert.notEqual(productionWithoutActivation.status, 0);
  assert.match(productionWithoutActivation.stderr, /production-activation/);
  fixture.writeRuns();

  fixture.writeRuns({ delivery: { inputs: {
    target: 'staging', sha: fixture.currentSha, ci_run_id: fixture.ciRun,
    ci_run_attempt: fixture.ciAttempt, config_contract_sha256: fixture.configSha,
    operation: 'interruption-checkpoint',
  } } });
  const interruptionWithoutFixture = fixture.invoke('probe', fixture.currentSha, 'interruption-checkpoint');
  assert.notEqual(interruptionWithoutFixture.status, 0);
  assert.match(interruptionWithoutFixture.stderr, /staging-synthetic-fixture/);
  fixture.writeRuns();

  git(fixture.workspace, 'checkout', '-q', '--detach', fixture.staleSha);
  fixture.writeRuns({ sha: fixture.staleSha });
  const stale = fixture.invoke('probe', fixture.staleSha);
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /source identity|stale|remote early-birds tip/i);

  git(fixture.workspace, 'checkout', '-q', '-B', 'foreign', fixture.currentSha);
  fs.writeFileSync(path.join(fixture.workspace, 'foreign'), 'foreign\n');
  git(fixture.workspace, 'add', 'foreign');
  git(fixture.workspace, 'commit', '-q', '-m', 'foreign fixture');
  const foreignSha = git(fixture.workspace, 'rev-parse', 'HEAD');
  fixture.writeRuns({ sha: foreignSha });
  const foreign = fixture.invoke('probe', foreignSha);
  assert.notEqual(foreign.status, 0);
  assert.match(foreign.stderr, /source identity|foreign|remote early-birds tip/i);

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

  const lock = path.join(fixture.state, '.delivery-staging.lock');
  fs.writeFileSync(lock, '', { mode: 0o600 });
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

test('receipt contract enforces mutually exclusive deploy, rollback and synthetic interruption states', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'account-receipt-states-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const synthetic = JSON.parse(read(RECEIPT));
  const candidate = synthetic.source_sha;
  const previous = synthetic.revisions.previous;
  const validate = (value, label, expected) => {
    const file = path.join(directory, `${label}.json`);
    fs.writeFileSync(file, JSON.stringify(value));
    const runtime = run(process.execPath, [VALIDATOR, file]);
    assert.equal(runtime.status === 0, expected, `${label} runtime: ${runtime.stderr}`);
    const schema = run('python3', ['-c', [
      'import json, jsonschema, sys',
      'schema=json.load(open(sys.argv[1]))',
      'value=json.load(open(sys.argv[2]))',
      'jsonschema.Draft202012Validator(schema).validate(value)',
    ].join(';'), SCHEMA, file]);
    assert.equal(schema.status === 0, expected, `${label} schema: ${schema.stderr}`);
  };

  validate(synthetic, 'synthetic-valid', true);
  const deployed = structuredClone(synthetic);
  Object.assign(deployed, { evidence_scope: 'runtime', target: 'production', operation: 'deploy', outcome: 'deployed', interruption: null });
  deployed.artifact.source_sha = candidate;
  Object.assign(deployed.actions.delivery, { target: 'production', operation: 'deploy' });
  deployed.revisions = { previous, current: { kind: 'candidate' } };
  deployed.rollback = { result: 'not-required', revision: null };
  validate(deployed, 'deploy-valid', true);
  const rolledBack = structuredClone(deployed);
  rolledBack.outcome = 'rolled-back';
  rolledBack.artifact.source_sha = previous;
  rolledBack.revisions = { previous, current: { kind: 'restored' } };
  rolledBack.rollback = { result: 'verified', revision: 'previous' };
  validate(rolledBack, 'rollback-valid', true);

  const invalid = [
    ['deploy-current-mismatch', deployed, (value) => { value.revisions.current = { kind: 'restored', revision: previous }; }],
    ['deploy-rollback-revision', deployed, (value) => { value.rollback.revision = previous; }],
    ['deploy-verified-rollback', deployed, (value) => { value.rollback = { result: 'verified', revision: previous }; }],
    ['rollback-current-candidate', rolledBack, (value) => { value.revisions.current = { kind: 'candidate' }; }],
    ['rollback-wrong-revision', rolledBack, (value) => { value.rollback.revision = candidate; }],
    ['rollback-not-required', rolledBack, (value) => { value.rollback = { result: 'not-required', revision: null }; }],
    ['synthetic-no-interruption', synthetic, (value) => { value.interruption = null; }],
    ['synthetic-production', synthetic, (value) => { value.target = 'production'; }],
  ];
  for (const [label, base, mutate] of invalid) {
    const value = structuredClone(base);
    mutate(value);
    validate(value, label, false);
  }
});

test('receipt binds exact source, current artifact, config and CI/delivery attempts end to end', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'account-receipt-bindings-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const base = JSON.parse(read(RECEIPT));
  let sequence = 0;
  const validate = (value) => {
    const file = path.join(directory, `${sequence += 1}.json`);
    fs.writeFileSync(file, JSON.stringify(value));
    return run(process.execPath, [VALIDATOR, file]);
  };
  assert.equal(validate(base).status, 0);
  for (const [label, mutate] of [
    ['artifact source', (value) => { delete value.artifact.source_sha; }],
    ['CI head', (value) => { value.actions.ci.head_sha = 'a'.repeat(40); }],
    ['delivery head', (value) => { value.actions.delivery.head_sha = 'a'.repeat(40); }],
    ['delivery target', (value) => { value.actions.delivery.target = 'production'; }],
    ['delivery operation', (value) => { value.actions.delivery.operation = 'deploy'; }],
    ['delivery CI run', (value) => { value.actions.delivery.ci_run_id = '999'; }],
    ['delivery CI attempt', (value) => { value.actions.delivery.ci_attempt = 99; }],
    ['delivery config', (value) => { value.actions.delivery.config_contract_sha256 = 'f'.repeat(64); }],
  ]) {
    const value = structuredClone(base);
    mutate(value);
    const result = validate(value);
    assert.notEqual(result.status, 0, label);
  }
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
    HB_ACCOUNT_TRUSTED_SOURCE_SHA: SHA,
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
