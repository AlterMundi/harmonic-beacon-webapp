import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OLD_SHA = 'ca2d7a8b060d690fdc698a68831481b91617e010';
const NEW_SHA = 'b'.repeat(40);
const ISSUER = 'https://account.harmonicbeacon.com';
// Fixed Docker-boundary fixtures; real TypeScript/config/provisioner execution
// lives in authority-provisioning.test.ts under Vitest, which installs npm deps.
// This wildcard is executed in validate-contract without npm ci.
const PRIOR_CLIENTS = [
  ['hb-listener', 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER',
    'https://listen.harmonicbeacon.com/api/account/callback',
    'https://listen.harmonicbeacon.com/api/account/frontchannel-logout'],
  ['hb-live', 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE',
    'https://live.harmonicbeacon.com/api/account/callback',
    'https://live.harmonicbeacon.com/api/account/frontchannel-logout'],
  ['hb-psicopompo', 'BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO',
    'https://psicopompo.altermundi.net/api/auth/beacon/callback', null],
];
const TRIAL_CLIENT = ['hb-psicopompo-trial', 'BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO_TRIAL',
  'https://pruebas.psicopompo.altermundi.net/api/auth/beacon/callback', null];

function trialEnvironment() {
  return {
    NODE_ENV: 'production', BEACON_ACCOUNT_BASE_URL: ISSUER,
    BEACON_ACCOUNT_PROVISION_CONFIRM_ISSUER: ISSUER,
    BEACON_ACCOUNT_PSICOPOMPO_ENABLED: '1', BEACON_ACCOUNT_PSICOPOMPO_TRIAL_ENABLED: '1',
    BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER: 'listener-'.repeat(8),
    BEACON_ACCOUNT_CLIENT_SECRET_HB_LIVE: 'live-'.repeat(12),
    BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO: 'pmp-'.repeat(12),
    BEACON_ACCOUNT_CLIENT_SECRET_HB_PSICOPOMPO_TRIAL: 'trial-'.repeat(12),
  };
}

function provisionFixture(state, environment, { old = false, fault = '', event = () => {} } = {}) {
  const clients = old ? PRIOR_CLIENTS : [...PRIOR_CLIENTS, TRIAL_CLIENT];
  if (!old) event('jwks');
  event('transaction');
  for (const [clientId, secret, redirectUri, postLogoutRedirectUri] of clients) {
    state.rows[clientId] = {
      id: state.rows[clientId]?.id ?? `fixture-${clientId}`, clientId,
      clientSecret: createHash('sha256').update(environment[secret]).digest('base64url'),
      disabled: false, skipConsent: true, enableEndSession: true,
      subjectType: 'public', scopes: ['openid', 'profile', 'email'], name: clientId,
      redirectUris: [redirectUri], postLogoutRedirectUris: postLogoutRedirectUri ? [postLogoutRedirectUri] : [],
      tokenEndpointAuthMethod: 'client_secret_basic', grantTypes: ['authorization_code'],
      responseTypes: ['code'], public: false, type: 'web', requirePKCE: true, contacts: [],
    };
  }
  for (const [id, row] of Object.entries(state.rows)) {
    if (!clients.some(([clientId]) => clientId === id)) row.disabled = true;
  }
  event('commit');
  if (old) event('jwks');
  return fault === 'jwks' ? 1 : 0;
}

function log(directory, entry) {
  fs.appendFileSync(path.join(directory, 'events.jsonl'), `${JSON.stringify(entry)}\n`);
}

async function fakeDocker(args) {
  const directory = process.env.RECOVERY_FIXTURE;
  const file = path.join(directory, 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const event = (kind, extra = {}) => log(directory, { kind, ...extra });
  const save = () => fs.writeFileSync(file, JSON.stringify(state));
  if (args[0] === 'run') {
    assert.equal(args.at(-1), 'account:provision');
    const image = args.find((arg) => arg.startsWith('harmonic-beacon/account:'));
    const old = image === `harmonic-beacon/account:${OLD_SHA}`;
    assert.ok(old || image === `harmonic-beacon/account:${NEW_SHA}`);
    assert.equal(args[args.indexOf('--network') + 1], 'earlybirds_preview_db_internal');
    assert.ok(args.includes('--read-only'));
    const environmentPath = args[args.indexOf('--env-file') + 1];
    assert.equal(environmentPath, path.join(directory, 'production.env'));
    const environment = Object.fromEntries(fs.readFileSync(environmentPath, 'utf8')
      .trim().split('\n').map((line) => line.split(/=(.*)/s).slice(0, 2)));
    event('provision', { image, environment });
    const fault = old && process.env.RECOVERY_SCENARIO === 'old-postcommit-error' ? 'jwks' : '';
    const status = provisionFixture(state, environment, { old, fault, event: (kind) => event(kind, { old }) });
    save();
    if (!old && process.env.RECOVERY_SCENARIO === 'term-after-commit') {
      event('signal', { signal: 'SIGTERM', provisionExit: 0 });
      process.kill(process.ppid, 'SIGTERM');
    }
    process.exitCode = !old && process.env.RECOVERY_SCENARIO === 'after-commit' ? 71 : status;
    return;
  }
  if (args[0] === 'compose') {
    const image = process.env.BEACON_ACCOUNT_IMAGE_TAG;
    event('compose', { image, args });
    if (image === OLD_SHA && args.includes('account-production')) {
      assert.equal(state.rows['hb-psicopompo-trial'].disabled, true);
      if (process.env.RECOVERY_SCENARIO === 'restore-compose-error') {
        process.exitCode = 74;
        return;
      }
    }
    state.runtime = image;
    state.worker = args.includes('account-mail-worker-production') || args.includes('account-mail-worker-staging');
    save();
    return;
  }
  if (args[0] === 'inspect') {
    event('health', { container: args[1] });
    console.log(process.env.RECOVERY_SCENARIO === 'restore-health-error' ? 'exited' : 'healthy');
    return;
  }
  if (args[0] === 'rm') {
    event('remove', { container: args.at(-1) });
    save();
    return;
  }
  throw new Error(`unexpected fake docker command: ${args[0]}`);
}

async function lifecycle(scenario, { environment = 'production', previous = OLD_SHA, worker = 1, direct = false } = {}) {
  const parent = path.join(ROOT, '.agent-work/pmp-human-vm-20261010');
  fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'recovery-test-'));
  try {
    const env = trialEnvironment();
    const state = { marker: { issuer: ISSUER }, rows: {}, identities: ['unchanged-human'], mail: ['unchanged-receipt'] };
    assert.equal(provisionFixture(state, env, { old: true }), 0);
    const previousRows = structuredClone(state.rows);
    if (direct) assert.equal(provisionFixture(state, env), 0);
    state.runtime = previous;
    state.worker = Boolean(worker);
    fs.writeFileSync(path.join(directory, 'state.json'), JSON.stringify(state));
    fs.writeFileSync(path.join(directory, 'production.env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n'));
    fs.mkdirSync(path.join(directory, 'scripts/beacon-account'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'scripts/beacon-account/start.sh'), path.join(directory, 'scripts/beacon-account/start.sh'));
    // Keep start.sh unchanged and execute the real recovery/provision/compose/
    // wait functions. Only unrelated preflight, migrations, backup and smoke
    // are stubbed; this test neither certifies nor performs host operations.
    fs.writeFileSync(path.join(directory, 'scripts/beacon-account/lib.sh'), fs.readFileSync(
      path.join(ROOT, 'scripts/beacon-account/lib.sh'), 'utf8',
    ) + `
account_load_deploy_env() { export BEACON_ACCOUNT_IMAGE_TAG="$NEW_SHA" BEACON_ACCOUNT_GIT_SHA="$NEW_SHA" BEACON_ACCOUNT_PRODUCTION_ENV_FILE="$RECOVERY_FIXTURE/production.env" COMPOSE_PROJECT_NAME=beacon-account; }
account_require_internal_mail_network() { :; }
account_capture_previous_runtime() { printf '%s\\n' "$PREVIOUS_SHA"; }
account_capture_previous_worker() { printf '%s\\n' "$PREVIOUS_WORKER"; }
account_require_prepared_image() { :; }
account_validate() { :; }
account_check_production_migrations() { :; }
account_backup_production() { :; }
account_migrate_production() { :; }
account_provision_production_role() { :; }
account_verify_running() { return 73; }
`);
    const docker = path.join(directory, 'docker');
    fs.writeFileSync(docker, `#!/bin/sh\nexport ACCOUNT_RECOVERY_FAKE_DOCKER=1\nexec '${process.execPath}' -- '${import.meta.filename}' "$@"\n`, { mode: 0o755 });
    const command = direct
      ? ['-c', `. "$RECOVERY_FIXTURE/scripts/beacon-account/lib.sh"; account_load_deploy_env; account_restore_previous_runtime "$RECOVERY_ENVIRONMENT" "$PREVIOUS_SHA" "$PREVIOUS_WORKER"`]
      : [path.join(directory, 'scripts/beacon-account/start.sh'), environment, path.join(directory, 'deploy.env'),
        environment === 'staging' ? 'interrupt-after-cutover' : 'normal'];
    const result = spawnSync('sh', command, {
      encoding: 'utf8', timeout: 15000, env: {
        NODE_OPTIONS: process.env.NODE_OPTIONS ?? '',
        PATH: `${directory}:${process.env.PATH}`, RECOVERY_FIXTURE: directory, RECOVERY_SCENARIO: scenario,
        RECOVERY_ENVIRONMENT: environment, PREVIOUS_SHA: previous, PREVIOUS_WORKER: String(worker),
        NEW_SHA, ACCOUNT_DEPLOY_FILE: path.join(directory, 'deploy.env'), HB_ACCOUNT_TRUSTED_SOURCE_SHA: NEW_SHA, HB_ACCOUNT_DELIVERY_LOCK_HELD: '1',
      },
    });
    const eventsFile = path.join(directory, 'events.jsonl');
    const events = fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, 'utf8').trim().split('\n').map(JSON.parse) : [];
    return { result, events, state: JSON.parse(fs.readFileSync(path.join(directory, 'state.json'), 'utf8')), previousRows, environment: env };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

if (process.env.ACCOUNT_RECOVERY_FAKE_DOCKER === '1') {
  await fakeDocker(process.argv.slice(2));
} else {
  for (const scenario of ['after-commit', 'after-cutover', 'term-after-commit']) {
    test(`real start restores prior inventory before prior runtime on ${scenario}`, async () => {
      const { result, events, state, previousRows, environment } = await lifecycle(scenario);
      assert.equal(result.status, scenario === 'after-commit' ? 71 : scenario === 'term-after-commit' ? 143 : 73, result.stderr);
      if (scenario === 'term-after-commit') {
        assert.deepEqual(events.find((e) => e.kind === 'signal'), { kind: 'signal', signal: 'SIGTERM', provisionExit: 0 });
        assert.equal(events.filter((e) => e.kind === 'compose' && e.image === NEW_SHA).length, 0);
      }
      assert.match(result.stderr, /prior runtime state restored/);
      const provisions = events.filter((e) => e.kind === 'provision');
      assert.deepEqual(provisions.map((e) => e.image), [`harmonic-beacon/account:${NEW_SHA}`, `harmonic-beacon/account:${OLD_SHA}`]);
      for (const p of provisions) assert.deepEqual(p.environment, environment);
      assert.ok(events.findIndex((e) => e.kind === 'commit' && e.old) < events.findIndex((e) => e.kind === 'compose' && e.image === OLD_SHA));
      assert.equal(state.runtime, OLD_SHA);
      assert.equal(state.worker, true);
      assert.equal(state.rows['hb-psicopompo-trial'].disabled, true);
      assert.deepEqual(Object.fromEntries(Object.entries(state.rows).filter(([id]) => id !== 'hb-psicopompo-trial')), previousRows);
      assert.deepEqual(state.identities, ['unchanged-human']);
      assert.deepEqual(state.mail, ['unchanged-receipt']);
      assert.equal(Object.values(state.rows).filter((row) => !row.disabled).length, 3);
      assert.deepEqual(Object.keys(state.rows).filter((id) => !state.rows[id].disabled).sort(),
        PRIOR_CLIENTS.map(([clientId]) => clientId).sort());
    });
  }

  for (const scenario of ['old-postcommit-error', 'restore-compose-error', 'restore-health-error']) {
    test(`recovery fails explicitly and stops before later steps on ${scenario}`, async () => {
      const { result, events, state } = await lifecycle(scenario);
      assert.equal(result.status, 1, result.stderr);
      assert.match(result.stderr, /recovery failed; prior runtime was not confirmed restored/);
      assert.doesNotMatch(result.stderr, /prior runtime state restored/);
      assert.equal(state.rows['hb-psicopompo-trial'].disabled, true);
      assert.equal(state.runtime, scenario === 'restore-health-error' ? OLD_SHA : NEW_SHA);
      assert.equal(events.filter((e) => e.kind === 'compose' && e.image === OLD_SHA).length, scenario === 'old-postcommit-error' ? 0 : 1);
      assert.equal(events.filter((e) => e.kind === 'health').length, scenario === 'restore-health-error' ? 1 : 0);
    });
  }

  test('staging interruption restores only staging runtime, without production provisioning', async () => {
    const { result, events } = await lifecycle('staging', { environment: 'staging' });
    assert.equal(result.status, 86, result.stderr);
    assert.equal(events.filter((e) => e.kind === 'provision').length, 0);
    assert.ok(events.filter((e) => e.kind === 'compose').every((e) => e.args.includes('account-staging') && !e.args.includes('account-production')));
  });

  test('no previous runtime removes only that target and never invents an inventory', async () => {
    for (const environment of ['production', 'staging']) {
      const { result, events } = await lifecycle('absent', { environment, previous: '', worker: 0, direct: true });
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(events.map((e) => e.kind), ['remove', 'remove']);
      assert.ok(events.every((e) => e.container.endsWith(`${environment}-1`)));
    }
  });

  test('previous app without worker preserves absence after inventory restoration', async () => {
    const { result, events, state } = await lifecycle('no-worker', { worker: 0, direct: true });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(state.worker, false);
    assert.equal(state.rows['hb-psicopompo-trial'].disabled, true);
    assert.equal(events.filter((e) => e.kind === 'compose').length, 1);
    assert.ok(!events.find((e) => e.kind === 'compose').args.includes('account-mail-worker-production'));
  });

}
