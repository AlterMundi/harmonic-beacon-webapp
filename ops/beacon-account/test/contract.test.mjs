import assert from 'node:assert/strict';
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

test('production and staging examples are isolated and fail closed', () => {
  validatePair(PROD, STAGING, STAGING_DB, true);
  assert.equal(parseEnvFile(PROD).get('BEACON_ACCOUNT_APPLE_ENABLED'), '0');
  assert.equal(parseEnvFile(STAGING).get('BEACON_ACCOUNT_APPLE_ENABLED'), '0');
});

test('validator rejects a shared staging database schema', () => {
  const bad = mutate(STAGING, 'account-staging-postgres:5432/beacon_account_staging', 'earlybirds-preview-postgres:5432/earlybirds_preview');
  assert.throws(() => validatePair(PROD, bad, STAGING_DB, true), /isolated account-staging-postgres/);
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
  assert.match(start, /account_compose up -d "account-mail-worker-\$environment" "account-\$environment"/);
  assert.match(start, /account_check_production_migrations before/);
  assert.match(start, /account_check_production_migrations after/);
  assert.match(start, /flock -n 9/);
  assert.match(start, /account_backup_production/);
  assert.match(start, /account_restore_previous_runtime/);
  assert.match(start, /account_capture_previous_worker/);
  assert.match(lib, /running mail worker SHA mismatch/);
  assert.match(lib, /Account mail worker must not publish ports/);
  assert.match(lib, /account_wait_container=\$1/);
  assert.doesNotMatch(lib, /account_wait_healthy\(\) \{\s+container=\$1/);
  assert.match(lib, /account_image_supports_mail_worker/);
  assert.match(lib, /scripts\/process-account-mail-outbox\.ts/);
  assert.match(rollback, /previous_worker_present=0/);
  assert.match(rollback, /account_image_supports_mail_worker/);
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
  assert.match(smoke, /ready\.status !== 'ok'/);
  assert.match(smoke, /discovery\.issuer !== issuer/);
  assert.match(smoke, /jwks\.keys\.length < 1/);
  const migrationGuard = fs.readFileSync(path.resolve(ROOT, '../../scripts/beacon-account/check-migrations.mjs'), 'utf8');
  assert.match(migrationGuard, /pending migrations differ from the reviewed Account-only list/);
  assert.match(migrationGuard, /unresolved migration/);
  assert.doesNotMatch(`${start}\n${lib}`, /migrate reset|migrate down|docker compose down|volume rm|prune/);
  const dockerfile = fs.readFileSync(path.resolve(ROOT, '../../Dockerfile'), 'utf8');
  assert.match(dockerfile, /ops\/beacon-account\/validate\.mjs/);
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

test('nginx keeps Account hosts isolated and never logs token-bearing routes', () => {
  for (const [name, port, zone] of [
    ['account.harmonicbeacon.com.conf.template', '13002', 'beacon_account_prod_auth'],
    ['account-staging.harmonicbeacon.com.conf.template', '13003', 'beacon_account_staging_auth'],
  ]) {
    const nginx = fs.readFileSync(path.join(ROOT, 'nginx', name), 'utf8');
    assert.match(nginx, new RegExp(`proxy_pass http://127\\.0\\.0\\.1:${port}`));
    assert.match(nginx, new RegExp(`limit_req zone=${zone}`));
    for (const route of ['/verify-email', '/reset-password', '/nav-slot']) {
      const start = nginx.indexOf(`location = ${route} {`);
      assert.ok(start >= 0, `${route} must be exact`);
      assert.match(nginx.slice(start, nginx.indexOf('\n    }', start)), /access_log off;/);
      assert.match(nginx.slice(start, nginx.indexOf('\n    }', start)), /Referrer-Policy "no-referrer"/);
      assert.match(nginx.slice(start, nginx.indexOf('\n    }', start)), /Strict-Transport-Security/);
    }
    const redirectServer = nginx.slice(0, nginx.indexOf('server {', nginx.indexOf('server {') + 1));
    assert.match(redirectServer, /access_log off;/);
    assert.match(nginx, /location \/ \{ return 404; \}/);
    assert.doesNotMatch(nginx, /proxy_pass http:\/\/127\.0\.0\.1:(?!13002|13003)/);
    assert.doesNotMatch(nginx, /livekit|listener\/checkout|webhooks|events/);
  }
});

test('Account staging ACME bootstrap exposes only the certificate challenge', () => {
  const nginx = fs.readFileSync(
    path.join(ROOT, 'nginx/account-staging-acme-bootstrap.conf.template'),
    'utf8',
  );
  assert.match(nginx, /server_name account-staging\.harmonicbeacon\.com;/);
  assert.match(nginx, /access_log off;/);
  assert.match(nginx, /location \^~ \/\.well-known\/acme-challenge\/ \{/);
  assert.match(nginx, /root \/var\/www\/letsencrypt;/);
  assert.match(nginx, /location \/ \{ return 503; \}/);
  assert.doesNotMatch(nginx, /listen 443|ssl_certificate|proxy_pass|1300[0-9]/);
});
