import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseEnvFile, validatePair } from '../validate.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PROD = path.join(ROOT, 'account.production.env.example');
const STAGING = path.join(ROOT, 'account.staging.env.example');
const STAGING_DB = path.join(ROOT, 'database.staging.env.example');
const PROD_WORKER = path.join(ROOT, 'account-mail-worker.production.env.example');
const STAGING_WORKER = path.join(ROOT, 'account-mail-worker.staging.env.example');
const HEALTH_JSON_VERIFY = path.resolve(ROOT, '../../scripts/beacon-account/verify-health-json.sh');
const ACCOUNT_LIFECYCLE_LIB = path.resolve(ROOT, '../../scripts/beacon-account/lib.sh');
const HEALTH_ISSUER = 'https://account-staging.harmonicbeacon.com';
const HEALTH_SHA = 'a'.repeat(40);
const HEALTH_SCHEMA = '20260818010000_beacon_account_authority';

function mutate(source, from, to) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-account-contract-'));
  const target = path.join(directory, path.basename(source));
  const content = fs.readFileSync(source, 'utf8');
  assert.ok(content.includes(from), `fixture does not include ${from}`);
  fs.writeFileSync(target, content.replace(from, to));
  return target;
}

function composeService(source, name) {
  const marker = `\n  ${name}:\n`;
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `missing Compose service ${name}`);
  const remainder = source.slice(start + marker.length);
  const next = remainder.search(/\n  [a-z0-9][a-z0-9-]*:\n/);
  return next < 0 ? remainder : remainder.slice(0, next);
}

function verifyHealthFixture({ jwks, ready = {}, discovery = {} }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-account-health-'));
  const write = (name, value) => fs.writeFileSync(
    path.join(directory, `${name}.json`), JSON.stringify(value),
  );
  write('ready', {
    status: 'ok', gitSha: HEALTH_SHA, schemaVersion: HEALTH_SCHEMA,
    checks: {
      database: 'ok', mail: 'ok', issuer: 'ok', jwks: 'ok', clients: 'ok', providers: 'ok',
    },
    ...ready,
  });
  write('discovery', {
    issuer: HEALTH_ISSUER,
    jwks_uri: `${HEALTH_ISSUER}/.well-known/jwks.json`,
    authorization_endpoint: `${HEALTH_ISSUER}/api/account/auth/oauth2/authorize`,
    token_endpoint: `${HEALTH_ISSUER}/api/account/auth/oauth2/token`,
    userinfo_endpoint: `${HEALTH_ISSUER}/api/account/auth/oauth2/userinfo`,
    introspection_endpoint: `${HEALTH_ISSUER}/api/account/auth/oauth2/introspect`,
    revocation_endpoint: `${HEALTH_ISSUER}/api/account/auth/oauth2/revoke`,
    end_session_endpoint: `${HEALTH_ISSUER}/api/account/auth/oauth2/end-session`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
    ...discovery,
  });
  write('jwks', jwks);
  const result = spawnSync('sh', [
    HEALTH_JSON_VERIFY, directory, HEALTH_ISSUER, HEALTH_SHA, HEALTH_SCHEMA,
  ], { encoding: 'utf8' });
  fs.rmSync(directory, { recursive: true, force: true });
  return result;
}

function verifyRunningFixture({ expectedWorkerPresent, actualWorkerPresent }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-account-runtime-'));
  const docker = path.join(directory, 'docker');
  fs.writeFileSync(docker, `#!/bin/sh
set -eu
test "$1" = inspect
target=$2
format=$4
is_worker=0
case "$target" in *mail-worker*) is_worker=1 ;; esac
case "$format" in
  *State.Health*)
    if [ "$is_worker" -eq 1 ] && [ "$MOCK_WORKER_PRESENT" -eq 0 ]; then
      echo exited
    else
      echo healthy
    fi
    ;;
  *State.Status*)
    if [ "$is_worker" -eq 1 ] && [ "$MOCK_WORKER_PRESENT" -eq 0 ]; then
      exit 1
    fi
    echo running
    ;;
  *Config.Image*) echo "harmonic-beacon/account:$MOCK_SHA" ;;
  *Config.Env*) echo "BEACON_GIT_SHA=$MOCK_SHA" ;;
  *HostConfig.PortBindings*)
    if [ "$is_worker" -eq 1 ]; then
      echo null
    else
      echo '{"3000/tcp":[{"HostIp":"127.0.0.1","HostPort":"13003"}]}'
    fi
    ;;
  *) echo "unexpected docker inspect format: $format" >&2; exit 2 ;;
esac
`);
  fs.chmodSync(docker, 0o755);
  const sha = 'c'.repeat(40);
  const result = spawnSync('sh', ['-c', `
    . "$ACCOUNT_LIFECYCLE_LIB"
    BEACON_ACCOUNT_GIT_SHA="$MOCK_SHA"
    BEACON_ACCOUNT_IMAGE_TAG="$MOCK_SHA"
    account_verify_running staging "$MOCK_SHA" "$MOCK_SHA" "$EXPECTED_WORKER_PRESENT"
  `], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      ACCOUNT_LIFECYCLE_LIB,
      EXPECTED_WORKER_PRESENT: String(expectedWorkerPresent),
      MOCK_WORKER_PRESENT: String(actualWorkerPresent),
      MOCK_SHA: sha,
    },
  });
  fs.rmSync(directory, { recursive: true, force: true });
  return result;
}

function navigationAssetCapabilityFixture(present) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'beacon-account-nav-capability-'));
  const docker = path.join(directory, 'docker');
  fs.writeFileSync(docker, `#!/bin/sh
set -eu
test "$1" = image
test "$2" = inspect
if [ "$MOCK_NAV_ASSET_PRESENT" -eq 1 ]; then
  echo BEACON_ACCOUNT_NAV_ASSET=1
else
  echo NODE_ENV=production
fi
`);
  fs.chmodSync(docker, 0o755);
  const result = spawnSync('sh', ['-c', `
    . "$ACCOUNT_LIFECYCLE_LIB"
    actual=0
    account_image_supports_navigation_asset "${'d'.repeat(40)}" && actual=1
    test "$actual" = "$MOCK_NAV_ASSET_PRESENT"
  `], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      ACCOUNT_LIFECYCLE_LIB,
      MOCK_NAV_ASSET_PRESENT: present ? '1' : '0',
    },
  });
  fs.rmSync(directory, { recursive: true, force: true });
  return result;
}

const publicEd25519Key = {
  kid: 'staging-ed25519-key', kty: 'OKP', alg: 'EdDSA', crv: 'Ed25519', x: 'A'.repeat(43),
};

test('production and staging examples are isolated and fail closed', () => {
  validatePair(PROD, STAGING, STAGING_DB, true);
  assert.equal(parseEnvFile(PROD).get('BEACON_ACCOUNT_APPLE_ENABLED'), '0');
  assert.equal(parseEnvFile(STAGING).get('BEACON_ACCOUNT_APPLE_ENABLED'), '0');
});

test('validator rejects a shared staging database schema', () => {
  const bad = mutate(STAGING, 'account-staging-postgres:5432/beacon_account_staging', 'earlybirds-preview-postgres:5432/earlybirds_preview');
  assert.throws(() => validatePair(PROD, bad, STAGING_DB, true), /isolated account-staging-postgres/);
});

test('validator pins the production runtime role and bounded database password shape', () => {
  const wrongRole = mutate(PROD, 'postgresql://account_prod:', 'postgresql://earlybirds_preview:');
  assert.throws(() => validatePair(wrongRole, STAGING, STAGING_DB, true), /dedicated account_prod role/);
  const unsafePassword = mutate(
    PROD,
    'account_prod:replace-production-database-password-32-random@earlybirds-preview-postgres',
    'account_prod:short@earlybirds-preview-postgres',
  );
  assert.throws(() => validatePair(unsafePassword, STAGING, STAGING_DB, true), /32-128 base64url/);
});

test('validator rejects a production client secret in staging', () => {
  const bad = mutate(STAGING, 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER=', 'BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER=wrong-boundary');
  assert.throws(() => validatePair(PROD, bad, STAGING_DB, true), /must be empty outside its issuer/);
});

test('validator rejects reused active RP secrets across issuers', () => {
  const bad = mutate(
    STAGING,
    'BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER_STAGING=replace-staging-listener-client-secret-32-random',
    'BEACON_ACCOUNT_CLIENT_SECRET_HB_LISTENER_STAGING=replace-production-listener-client-secret-32-random',
  );
  assert.throws(() => validatePair(PROD, bad, STAGING_DB, true), /must differ (?:from production|between issuers)/);
});

test('validator rejects a reused mail outbox encryption key across issuers', () => {
  const badApplication = mutate(
    STAGING,
    'BEACON_ACCOUNT_MAIL_OUTBOX_KEY=replaceStagingOutboxKeyAAAAAAAAAAAAAAAAAAAA',
    'BEACON_ACCOUNT_MAIL_OUTBOX_KEY=replaceProdOutboxKeyAAAAAAAAAAAAAAAAAAAAAAA',
  );
  const badWorker = mutate(
    STAGING_WORKER,
    'BEACON_ACCOUNT_MAIL_OUTBOX_KEY=replaceStagingOutboxKeyAAAAAAAAAAAAAAAAAAAA',
    'BEACON_ACCOUNT_MAIL_OUTBOX_KEY=replaceProdOutboxKeyAAAAAAAAAAAAAAAAAAAAAAA',
  );
  assert.throws(
    () => validatePair(PROD, badApplication, STAGING_DB, true, PROD_WORKER, badWorker),
    /must differ (?:from production|between issuers)/,
  );
});

test('validator rejects a mail outbox key that is not canonical base64url32', () => {
  const bad = mutate(
    STAGING,
    'BEACON_ACCOUNT_MAIL_OUTBOX_KEY=replaceStagingOutboxKeyAAAAAAAAAAAAAAAAAAAA',
    'BEACON_ACCOUNT_MAIL_OUTBOX_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.',
  );
  assert.throws(() => validatePair(PROD, bad, STAGING_DB, true), /base64url for exactly 32 bytes/);
});

test('mail worker env rejects browser and OAuth secrets', () => {
  const badWorker = mutate(
    STAGING_WORKER,
    '# This file deliberately excludes browser auth, OAuth provider and RP secrets.',
    'BEACON_ACCOUNT_AUTH_SECRET=forbidden-worker-auth-secret-32-random',
  );
  assert.throws(
    () => validatePair(PROD, STAGING, STAGING_DB, true, PROD_WORKER, badWorker),
    /mail worker contains forbidden key BEACON_ACCOUNT_AUTH_SECRET/,
  );
});

test('runtime validation rejects copied placeholder secrets', () => {
  assert.throws(() => validatePair(PROD, STAGING, STAGING_DB), /still a placeholder/);
});

test('CLI does not trust copied files merely because they end in .example', () => {
  const copiedProduction = mutate(PROD, '# Copy', '# Copied');
  const copiedStaging = mutate(STAGING, '# Copy', '# Copied');
  const copiedDatabase = mutate(STAGING_DB, '# Copy', '# Copied');
  for (const [source, target] of [[copiedProduction, `${copiedProduction}.example`], [copiedStaging, `${copiedStaging}.example`], [copiedDatabase, `${copiedDatabase}.example`]]) {
    fs.renameSync(source, target);
  }
  assert.throws(() => validatePair(`${copiedProduction}.example`, `${copiedStaging}.example`, `${copiedDatabase}.example`), /still a placeholder/);
});

test('compose exposes only fixed loopback ports and keeps the DB external', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yml'), 'utf8');
  assert.match(compose, /127\.0\.0\.1:\$\{BEACON_ACCOUNT_PRODUCTION_PORT:-13002\}:3000/);
  assert.match(compose, /127\.0\.0\.1:\$\{BEACON_ACCOUNT_STAGING_PORT:-13003\}:3000/);
  assert.match(compose, /account_production_db:\s+external: true\s+name: earlybirds_preview_db_internal/s);
  assert.match(compose, /account_staging_db:\s+internal: true/s);
  assert.match(compose, /account_mail_production:\s+external: true\s+name: beacon_account_mail_production/s);
  assert.match(compose, /account_mail_staging:\s+external: true\s+name: beacon_account_mail_staging/s);
  assert.match(compose, /account_egress_production:\s+name: beacon_account_production_egress/s);
  assert.match(compose, /account_egress_staging:\s+name: beacon_account_staging_egress/s);
  assert.match(compose, /postgres@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777/);
  assert.match(compose, /beacon-account-staging-postgres:\s+name: beacon-account-staging-postgres/s);
  assert.match(compose, /provision-production:[\s\S]*account:provision/);
  assert.match(compose, /provision-staging:[\s\S]*account:provision/);
  assert.match(compose, /account-mail-worker-production:[\s\S]*account:mail-worker/);
  assert.match(compose, /account-mail-worker-staging:[\s\S]*account:mail-worker/);
  assert.match(compose, /account-mail-worker-production:[\s\S]*networks: \[account_production_db, account_mail_production\]/);
  assert.match(compose, /account-mail-worker-staging:[\s\S]*networks: \[account_staging_db, account_mail_staging\]/);
  for (const worker of ['account-mail-worker-production', 'account-mail-worker-staging']) {
    const block = composeService(compose, worker);
    assert.doesNotMatch(block, /\n\s+ports:/);
    assert.doesNotMatch(block, /account_egress/);
    assert.match(block, /ACCOUNT_MAIL_WORKER_(?:PRODUCTION|STAGING)_ENV_FILE/);
    assert.doesNotMatch(block, /ACCOUNT_(?:PRODUCTION|STAGING)_ENV_FILE/);
  }
  assert.match(compose, /BEACON_ACCOUNT_MAIL_WORKER_HEARTBEAT_FILE/);
  assert.match(compose, /Date\.now\(\)-Date\.parse\(h\.at\)>120000/);
  assert.match(compose, /h\.oldestPendingSeconds>300/);
  assert.match(compose, /h\.consecutiveErrors!==0/);
  const dockerfile = fs.readFileSync(path.resolve(ROOT, '../../Dockerfile'), 'utf8');
  assert.match(dockerfile, /scripts\/process-account-mail-outbox\.ts/);
  assert.doesNotMatch(compose, /(?:^|\s)ports:\s*\n[^\n]*(?:postgres|5432)/m);
});

test('lifecycle verifies immutable provenance and does not downgrade schemas', () => {
  const start = fs.readFileSync(path.resolve(ROOT, '../../scripts/beacon-account/start.sh'), 'utf8');
  const lib = fs.readFileSync(path.resolve(ROOT, '../../scripts/beacon-account/lib.sh'), 'utf8');
  const rollback = fs.readFileSync(path.resolve(ROOT, '../../scripts/beacon-account/rollback-app.sh'), 'utf8');
  const smoke = fs.readFileSync(path.resolve(ROOT, '../../scripts/beacon-account/health-smoke.sh'), 'utf8');
  assert.match(start, /git -C "\$root" rev-parse HEAD/);
  assert.match(start, /docker image inspect "harmonic-beacon\/account:\$BEACON_ACCOUNT_IMAGE_TAG"/);
  assert.match(start, /account_compose build account-production[\s\S]*account_validate/);
  assert.match(start, /account_compose up -d --no-deps[\s\\]+account-mail-worker-production account-production/);
  assert.match(start, /account_compose up -d account-mail-worker-staging account-staging/);
  assert.match(start, /health-smoke\.sh"[\s\\]+"\$environment" "\$ACCOUNT_DEPLOY_FILE" "\$BEACON_ACCOUNT_GIT_SHA" 1 1/);
  assert.ok(start.indexOf('health-smoke.sh') < start.lastIndexOf('cutover_started=0'));
  assert.match(start, /account_check_production_migrations before/);
  assert.match(start, /account_check_production_migrations after/);
  assert.match(start, /account_migrate_production/);
  assert.match(start, /account_provision_production_role/);
  assert.match(start, /account_provision_production_authority/);
  assert.ok(start.indexOf('account_backup_production') < start.indexOf('account_migrate_production'));
  assert.ok(start.indexOf('account_migrate_production') < start.indexOf('account_provision_production_role'));
  assert.ok(start.indexOf('account_provision_production_role') < start.indexOf('cutover_started=1', start.indexOf('if [ "$environment" = production ]')));
  assert.match(start, /flock -n 9/);
  assert.match(start, /account_backup_production/);
  assert.match(start, /account_restore_previous_runtime/);
  assert.match(start, /account_capture_previous_worker/);
  assert.match(lib, /running mail worker SHA mismatch/);
  assert.match(lib, /Account mail worker must not publish ports/);
  assert.match(lib, /account_wait_container=\$1/);
  assert.match(lib, /expected_sha=\$\{2:-\$BEACON_ACCOUNT_GIT_SHA\}/);
  assert.match(lib, /expected_image_tag=\$\{3:-\$BEACON_ACCOUNT_IMAGE_TAG\}/);
  assert.match(lib, /expected_worker_present=\$\{4:-1\}/);
  assert.doesNotMatch(lib, /account_wait_healthy\(\) \{\s+container=\$1/);
  assert.match(lib, /account_image_supports_mail_worker/);
  assert.match(lib, /scripts\/process-account-mail-outbox\.ts/);
  assert.match(lib, /account_image_supports_navigation_asset/);
  assert.match(rollback, /previous_worker_present=0/);
  assert.match(rollback, /account_image_supports_mail_worker/);
  assert.match(rollback, /previous_nav_asset_present=0/);
  assert.match(rollback, /account_image_supports_navigation_asset/);
  assert.match(rollback, /health-smoke\.sh"[\s\\]+"\$environment" "\$ACCOUNT_DEPLOY_FILE" "\$previous_sha" "\$previous_worker_present"[\s\\]+"\$previous_nav_asset_present"/);
  assert.doesNotMatch(rollback, /account_restore_previous_runtime "\$environment" "\$previous_sha" 1/);
  assert.match(start, /account_require_internal_mail_network "\$environment"/);
  assert.match(lib, /docker network inspect "\$network"/);
  assert.match(lib, /must be an exact internal bridge/);
  assert.match(lib, /docker run --rm --network none --read-only --cap-drop ALL --user 0:0/);
  assert.match(lib, /\/app\/ops\/beacon-account\/validate\.mjs/);
  assert.doesNotMatch(lib, /\n\s*node "\$root\/ops\/beacon-account\/validate\.mjs"/);
  assert.match(lib, /pg_dump --format=custom/);
  assert.match(lib, /openssl enc -aes-256-cbc -salt -pbkdf2/);
  assert.match(lib, /openssl enc -d -aes-256-cbc/);
  assert.doesNotMatch(lib, /> "\$backup_dir\/\$backup_name"\s*$/m);
  assert.match(lib, /database was not downgraded|account_restore_previous_runtime/);
  assert.match(lib, /account_write_production_admin_env/);
  assert.match(lib, /--network none --read-only --cap-drop ALL --user 0:0/);
  assert.match(lib, /--network earlybirds_preview_db_internal --read-only --tmpfs \/tmp/);
  assert.match(lib, /provision-production-role\.mjs/);
  assert.doesNotMatch(lib, /GRANT\s+earlybirds_preview\s+TO\s+account_prod/i);
  assert.match(smoke, /verify-health-json\.sh/);
  assert.match(smoke, /--connect-timeout 3 --max-time 8/);
  assert.match(smoke, /\/assets\/hb-global-nav\.js\?v=\$expected_sha/);
  assert.match(smoke, /docker exec "\$container" sha256sum \/app\/public\/assets\/hb-global-nav\.js/);
  assert.match(smoke, /public navigation asset differs from running image/);
  assert.equal((smoke.match(/--proto '=https'/g) ?? []).length, 3);
  assert.doesNotMatch(smoke, /\bnode\b/);
  const migrationGuard = fs.readFileSync(path.resolve(ROOT, '../../scripts/beacon-account/check-migrations.mjs'), 'utf8');
  assert.match(migrationGuard, /pending migrations differ from the reviewed Account-only list/);
  assert.match(migrationGuard, /pending\.length === 0 && applied\.has\(target\)/);
  assert.match(migrationGuard, /unresolved migration/);
  assert.doesNotMatch(`${start}\n${lib}`, /migrate reset|migrate down|docker compose down|volume rm|prune/);
  const dockerfile = fs.readFileSync(path.resolve(ROOT, '../../Dockerfile'), 'utf8');
  assert.match(dockerfile, /BEACON_ACCOUNT_NAV_ASSET=1/);
  assert.match(dockerfile, /ops\/beacon-account\/validate\.mjs/);
  assert.match(dockerfile, /scripts\/beacon-account\/provision-production-role\.mjs/);
  for (const fixture of [
    'account.production.env.example',
    'account.staging.env.example',
    'database.staging.env.example',
    'account-mail-worker.production.env.example',
    'account-mail-worker.staging.env.example',
  ]) {
    assert.match(dockerfile, new RegExp(`ops/beacon-account/${fixture.replaceAll('.', '\\\.')}`));
  }
});

test('production runtime role provisioning is explicit, non-owner and allowlisted', () => {
  const source = fs.readFileSync(
    path.resolve(ROOT, '../../scripts/beacon-account/provision-production-role.mjs'),
    'utf8',
  );
  assert.match(source, /RUNTIME_ROLE = 'account_prod'/);
  assert.match(source, /NOSUPERUSER NOCREATEDB NOCREATEROLE/);
  assert.match(source, /NOREPLICATION NOBYPASSRLS/);
  assert.match(source, /runtime database role must not inherit another role/);
  assert.match(source, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM account_prod/);
  assert.match(source, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE/);
  assert.match(source, /beacon_account_mail_outbox/);
  assert.match(source, /beacon_oauth_access_tokens/);
  assert.doesNotMatch(source, /GRANT\s+earlybirds_preview\s+TO\s+account_prod/i);
  assert.doesNotMatch(source, /GRANT\s+ALL\s+(?:PRIVILEGES\s+)?ON\s+ALL\s+TABLES/i);
});

test('runtime verification preserves the pre-worker rollback boundary', () => {
  assert.equal(verifyRunningFixture({ expectedWorkerPresent: 0, actualWorkerPresent: 0 }).status, 0);
  assert.equal(verifyRunningFixture({ expectedWorkerPresent: 1, actualWorkerPresent: 1 }).status, 0);
  assert.notEqual(
    verifyRunningFixture({ expectedWorkerPresent: 0, actualWorkerPresent: 1 }).status,
    0,
  );
  assert.notEqual(
    verifyRunningFixture({ expectedWorkerPresent: 1, actualWorkerPresent: 0 }).status,
    0,
  );
});

test('navigation asset smoke preserves the pre-asset rollback boundary', () => {
  assert.equal(navigationAssetCapabilityFixture(false).status, 0);
  assert.equal(navigationAssetCapabilityFixture(true).status, 0);
});

test('health verifier accepts the exact public Ed25519 contract without optional use', () => {
  assert.equal(verifyHealthFixture({ jwks: { keys: [publicEd25519Key] } }).status, 0);
  assert.equal(verifyHealthFixture({
    jwks: { keys: [{ ...publicEd25519Key, use: 'sig', key_ops: ['verify'] }] },
  }).status, 0);
});

test('health verifier rejects unusable, private or ambiguous JWKS material', () => {
  const invalid = [
    ['empty set', { keys: [] }],
    ['wrong use', { keys: [{ ...publicEd25519Key, use: 'enc' }] }],
    ['wrong operations', { keys: [{ ...publicEd25519Key, key_ops: ['sign'] }] }],
    ['wrong type', { keys: [{ ...publicEd25519Key, kty: 'EC' }] }],
    ['wrong algorithm', { keys: [{ ...publicEd25519Key, alg: 'ES256' }] }],
    ['wrong curve', { keys: [{ ...publicEd25519Key, crv: 'X25519' }] }],
    ['missing public material', { keys: [{ ...publicEd25519Key, x: undefined }] }],
    ['invalid public material', { keys: [{ ...publicEd25519Key, x: `${'A'.repeat(42)}=` }] }],
    ['equivalent noncanonical public material', { keys: [{ ...publicEd25519Key, x: `${'A'.repeat(42)}B` }] }],
    ['private material', { keys: [{ ...publicEd25519Key, d: 'B'.repeat(43) }] }],
    ['missing key id', { keys: [{ ...publicEd25519Key, kid: '' }] }],
    ['duplicate key id', { keys: [publicEd25519Key, { ...publicEd25519Key }] }],
  ];
  for (const [label, jwks] of invalid) {
    assert.notEqual(verifyHealthFixture({ jwks }).status, 0, label);
  }
});

test('health verifier rejects readiness provenance and OIDC contract drift', () => {
  assert.notEqual(verifyHealthFixture({
    jwks: { keys: [publicEd25519Key] }, ready: { gitSha: 'b'.repeat(40) },
  }).status, 0);
  assert.notEqual(verifyHealthFixture({
    jwks: { keys: [publicEd25519Key] },
    discovery: { token_endpoint_auth_methods_supported: ['client_secret_post'] },
  }).status, 0);
});

test('nginx keeps Account hosts isolated and never logs token-bearing routes', () => {
  for (const [name, port, zone] of [
    ['account.harmonicbeacon.com.conf.template', '13002', 'beacon_account_prod_auth'],
    ['account-staging.harmonicbeacon.com.conf.template', '13003', 'beacon_account_staging_auth'],
  ]) {
    const nginx = fs.readFileSync(path.join(ROOT, 'nginx', name), 'utf8');
    assert.match(nginx, new RegExp(`proxy_pass http://127\\.0\\.0\\.1:${port}`));
    assert.match(nginx, new RegExp(`limit_req zone=${zone}`));
    for (const route of [
      '/verify-email',
      '/reset-password',
      '/assets/hb-global-nav.js',
    ]) {
      const start = nginx.indexOf(`location = ${route} {`);
      assert.ok(start >= 0, `${route} must be exact`);
      assert.match(nginx.slice(start, nginx.indexOf('\n    }', start)), /access_log off;/);
      assert.match(nginx.slice(start, nginx.indexOf('\n    }', start)), /Referrer-Policy "no-referrer"/);
      assert.match(nginx.slice(start, nginx.indexOf('\n    }', start)), /Strict-Transport-Security/);
    }
    const redirectServer = nginx.slice(0, nginx.indexOf('server {', nginx.indexOf('server {') + 1));
    assert.match(redirectServer, /access_log off;/);
    assert.doesNotMatch(nginx, /location \^~ \/assets\//);
    assert.match(nginx, /location \/ \{ return 404; \}/);
    assert.doesNotMatch(nginx, /proxy_pass http:\/\/127\.0\.0\.1:(?!13002|13003)/);
    assert.doesNotMatch(nginx, /livekit|listener\/checkout|webhooks|events/);
  }
});

test('Account ACME bootstraps expose only the exact certificate challenge', () => {
  for (const [name, host] of [
    ['account-acme-bootstrap.conf.template', 'account.harmonicbeacon.com'],
    ['account-staging-acme-bootstrap.conf.template', 'account-staging.harmonicbeacon.com'],
  ]) {
    const nginx = fs.readFileSync(path.join(ROOT, 'nginx', name), 'utf8');
    assert.match(nginx, new RegExp(`server_name ${host.replaceAll('.', '\\.')};`));
    assert.match(nginx, /access_log off;/);
    assert.match(nginx, /location \^~ \/\.well-known\/acme-challenge\/ \{/);
    assert.match(nginx, /root \/var\/www\/letsencrypt;/);
    assert.match(nginx, /location \/ \{ return 503; \}/);
    assert.doesNotMatch(nginx, /listen 443|ssl_certificate|proxy_pass|1300[0-9]/);
  }
});

test('Account production edge stays truthful while its upstream is unavailable', () => {
  const nginx = fs.readFileSync(
    path.join(ROOT, 'nginx/account.harmonicbeacon.com.conf.template'),
    'utf8',
  );
  assert.match(nginx, /proxy_intercept_errors on;/);
  assert.match(nginx, /error_page 502 503 504 = @account_unavailable;/);
  const unavailable = nginx.slice(nginx.indexOf('location @account_unavailable'));
  assert.match(unavailable, /access_log off;/);
  assert.match(unavailable, /Cache-Control "no-store" always;/);
  assert.match(unavailable, /return 503;/);
});

test('social-provider runbook uses only central Account callbacks and default-off activation', () => {
  const runbook = fs.readFileSync(
    path.resolve(ROOT, '../../docs/operations/BEACON_ACCOUNT_SOCIAL_PROVIDERS.md'),
    'utf8',
  );
  for (const environment of ['account-staging', 'account']) {
    for (const provider of ['google', 'apple']) {
      assert.match(runbook, new RegExp(
        `https://${environment}\\.harmonicbeacon\\.com/api/account/auth/callback/${provider}`,
      ));
    }
  }
  for (const provider of ['GOOGLE', 'APPLE']) {
    assert.match(runbook, new RegExp(`BEACON_ACCOUNT_${provider}_CLIENT_ID`));
    assert.match(runbook, new RegExp(`BEACON_ACCOUNT_${provider}_CLIENT_SECRET`));
  }
  assert.match(runbook, /activate-social-provider\.sh/);
  assert.match(runbook, /rollback-social-provider\.sh/);
  assert.match(runbook, /There is no installed-but-disabled intermediate state/);
  assert.doesNotMatch(runbook, /api\/early-birds\/auth\/callback\/(?:google|apple)/);
  assert.match(runbook, /Matching email never links or merges accounts/);

  const legacy = fs.readFileSync(
    path.resolve(ROOT, '../../docs/operations/LISTENER_APPLE_IDENTITY.md'),
    'utf8',
  );
  assert.match(legacy, /Legacy cutover note/);
  assert.match(legacy, /BEACON_ACCOUNT_SOCIAL_PROVIDERS\.md/);
});

test('social-provider activation is exact-image, offline, backed up and app-only', () => {
  const activate = fs.readFileSync(
    path.resolve(ROOT, '../../scripts/beacon-account/activate-social-provider.sh'),
    'utf8',
  );
  const rollback = fs.readFileSync(
    path.resolve(ROOT, '../../scripts/beacon-account/rollback-social-provider.sh'),
    'utf8',
  );
  const transformer = fs.readFileSync(
    path.resolve(ROOT, '../../scripts/beacon-account/social-provider-env.mjs'),
    'utf8',
  );
  const dockerfile = fs.readFileSync(path.resolve(ROOT, '../../Dockerfile'), 'utf8');
  assert.match(activate, /account-provider-\$environment-\$provider\.env/);
  assert.match(activate, /account_backup_(?:production|staging)/);
  assert.match(activate, /--network none --read-only --user 0:0 --cap-drop ALL/);
  assert.match(activate, /social-provider-env\.mjs/);
  assert.match(activate, /validate\.mjs/);
  assert.match(activate, /up -d --no-deps --force-recreate --no-build "account-\$environment"/);
  assert.match(activate, /mail worker changed during provider activation/);
  assert.doesNotMatch(activate, /account-mail-worker-\$environment"/);
  assert.doesNotMatch(activate, /^state=/m);
  assert.doesNotMatch(rollback, /^state=/m);
  assert.match(rollback, /identities and sessions were retained/);
  assert.match(transformer, /bundle must contain only the exact provider client ID and secret/);
  assert.match(dockerfile, /scripts\/beacon-account\/social-provider-env\.mjs/);
  for (const script of [
    'activate-social-provider.sh',
    'rollback-social-provider.sh',
  ]) {
    const checked = spawnSync('sh', ['-n', path.resolve(ROOT, `../../scripts/beacon-account/${script}`)], {
      encoding: 'utf8',
    });
    assert.equal(checked.status, 0, checked.stderr);
  }
});
