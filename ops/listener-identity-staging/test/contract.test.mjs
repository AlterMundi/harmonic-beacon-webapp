import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import { validateFiles } from '../validate.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const REPO = path.resolve(ROOT, '../..');
const DEPLOY = path.join(ROOT, 'deploy.env.example');
const APP = path.join(ROOT, 'app.env.example');
const DATABASE = path.join(ROOT, 'database.env.example');

function source(file) {
  return fs.readFileSync(file, 'utf8');
}

function mutated(file, from, to) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'listener-identity-staging-'));
  const target = path.join(directory, path.basename(file));
  const contents = source(file);
  assert.ok(contents.includes(from), `fixture must contain ${from}`);
  fs.writeFileSync(target, contents.replace(from, to));
  return target;
}

test('example contract is internally consistent and explicitly placeholder-only', () => {
  assert.doesNotThrow(() => validateFiles(DEPLOY, APP, DATABASE, true));
  assert.throws(() => validateFiles(DEPLOY, APP, DATABASE), /placeholder/);
});

test('validator rejects production, shared database and unsafe Account cutovers', () => {
  const cases = [
    [DEPLOY, 'LISTENER_IDENTITY_STAGING_APP_PORT=13001', 'LISTENER_IDENTITY_STAGING_APP_PORT=13000', /must be 13001/],
    [APP, '@listener-identity-staging-postgres:', '@earlybirds-preview-postgres:', /dedicated staging PostgreSQL/],
    [APP, 'BEACON_LISTENER_ACCOUNT_ENABLED=0', 'BEACON_LISTENER_ACCOUNT_ENABLED=1', /must be 0/],
    [APP, 'BEACON_LISTENER_FREE_FOR_ALL=0', 'BEACON_LISTENER_FREE_FOR_ALL=1', /must be 0/],
    [APP, 'BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED=0', 'BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED=1', /must be 0/],
  ];
  for (const [file, from, to, message] of cases) {
    const changed = mutated(file, from, to);
    assert.throws(() => validateFiles(
      file === DEPLOY ? changed : DEPLOY,
      file === APP ? changed : APP,
      file === DATABASE ? changed : DATABASE,
      true,
    ), message);
  }
  const withProductionSecret = mutated(
    APP,
    'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING=',
    'BEACON_LISTENER_ACCOUNT_CLIENT_SECRET=forbidden-production-secret\nBEACON_LISTENER_ACCOUNT_CLIENT_SECRET_STAGING=',
  );
  assert.throws(() => validateFiles(DEPLOY, withProductionSecret, DATABASE, true), /production secret must be absent/);
});

test('compose has a private database plane and exact immutable application boundary', () => {
  const compose = source(path.join(ROOT, 'compose.yml'));
  assert.match(compose, /postgres:16-alpine@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777/);
  assert.match(compose, /name: listener_identity_staging_database\n\s+internal: true/);
  assert.match(compose, /name: listener-identity-staging-postgres/);
  assert.match(compose, /127\.0\.0\.1:\$\{LISTENER_IDENTITY_STAGING_APP_PORT:-13001\}:3000/);
  assert.match(compose, /harmonic-beacon\/listener-identity-staging:\$\{LISTENER_IDENTITY_STAGING_IMAGE_TAG:\?exact_sha40_required\}/);
  assert.match(compose, /migrate:[\s\S]*command: \["npx", "prisma", "migrate", "deploy"\]/);
  assert.match(compose, /depends_on:\n\s+migrate: \{ condition: service_completed_successfully \}/);
  assert.match(compose, /earlybirds_stream_control_internal/);
  assert.match(compose, /earlybirds_authority_private/);
  assert.match(compose, /aliases: \[listener-identity-staging\]/);
  const authorityAttachment = compose.match(/app:[\s\S]*?authority_private:\n\s+aliases: \[listener-identity-staging\]/);
  assert.ok(authorityAttachment, 'only the app must advertise the dedicated authority callback alias');
  const beforeApp = compose.slice(0, compose.indexOf('\n  app:'));
  assert.doesNotMatch(beforeApp, /authority_private|listener-identity-staging\]/);
  assert.doesNotMatch(compose, /earlybirds_preview_db_internal|127\.0\.0\.1:13000|livekit:|playlist|tapestry|commerce/);
});

test('compose renders from examples without reading a production file', () => {
  const result = spawnSync('docker', [
    'compose', '--project-name', 'listener-identity-staging',
    '--env-file', DEPLOY, '-f', path.join(ROOT, 'compose.yml'), 'config', '--quiet',
  ], {
    cwd: REPO,
    env: {
      ...process.env,
      LISTENER_IDENTITY_STAGING_APP_ENV_FILE: APP,
      LISTENER_IDENTITY_STAGING_DATABASE_ENV_FILE: DATABASE,
    },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
});

test('lifecycle is forward-only, provenance checked and scoped away from production', () => {
  const lib = source(path.join(REPO, 'scripts/listener-identity-staging/lib.sh'));
  const start = source(path.join(REPO, 'scripts/listener-identity-staging/start.sh'));
  const smoke = source(path.join(REPO, 'scripts/listener-identity-staging/health-smoke.sh'));
  const edge = source(path.join(REPO, 'scripts/listener-identity-staging/edge-smoke.sh'));
  const rollback = source(path.join(REPO, 'scripts/listener-identity-staging/rollback.sh'));
  assert.match(start, /build app/);
  assert.match(start, /up -d postgres/);
  assert.match(start, /listener_staging_backup/);
  assert.ok(start.indexOf('listener_staging_backup') < start.indexOf('docker stop listener-ui-dev'));
  assert.match(start, /up -d app/);
  assert.match(start, /protected_before=.*listener_staging_fingerprint_protected/);
  assert.match(start, /test "\$protected_before" = "\$protected_after"/);
  assert.match(lib, /image provenance does not match its immutable tag/);
  assert.match(lib, /earlybirds-preview-listener-1 earlybirds-preview-postgres-1/);
  assert.match(lib, /database network exists outside the reviewed project/);
  assert.match(lib, /PostgreSQL volume exists outside the reviewed project/);
  assert.match(smoke, /listener-identity-staging-migrate/);
  assert.match(smoke, /'listenerAccount' in/);
  assert.match(smoke, /listenerRuntime !== 'ok'/);
  assert.match(start, /listener_staging_install_edge/);
  assert.match(start, /edge-smoke\.sh/);
  assert.match(lib, /nginx-previous\.conf/);
  assert.match(lib, /nginx-previous\.sha256/);
  assert.match(lib, /nginx-current\.sha256/);
  assert.match(lib, /nginx -t/);
  assert.match(lib, /systemctl reload nginx/);
  assert.match(rollback, /listener_staging_restore_edge/);
  assert.match(edge, /active staging vhost is not the reviewed template/);
  assert.match(edge, /sentinel/);
  assert.match(edge, /\/var\/log\/nginx/);
  assert.doesNotMatch(`${lib}\n${start}\n${smoke}\n${rollback}`, /compose down|down -v|volume rm|docker (?:system )?prune|migrate reset|migrate down/);
  assert.doesNotMatch(`${start}\n${rollback}`, /docker (?:stop|rm|restart) earlybirds-preview|docker (?:stop|rm|restart) beacon-/);
  assert.doesNotMatch(rollback, /prisma|migrate/);
});

test('existing public staging vhost targets only the staging app and authority', () => {
  const nginx = source(path.join(REPO, 'ops/early-birds-preview/nginx/earlybirds-staging.harmonicbeacon.com.conf.template'));
  const targets = [...nginx.matchAll(/proxy_pass http:\/\/127\.0\.0\.1:(\d+);/g)].map((match) => match[1]);
  assert.ok(targets.filter((port) => port === '13001').length >= 10);
  assert.ok(targets.every((port) => ['13001', '18876'].includes(port)));
  assert.doesNotMatch(nginx, /127\.0\.0\.1:13000/);
  for (const route of ['login', 'callback', 'frontchannel-logout']) {
    const exact = nginx.match(new RegExp(`location = /api/account/${route} \\{([\\s\\S]*?)\\n    \\}`));
    assert.ok(exact, `missing exact Account route ${route}`);
    assert.match(exact[1], /access_log off;/);
    assert.match(exact[1], /proxy_pass http:\/\/127\.0\.0\.1:13001;/);
    assert.match(exact[1], /Cache-Control "private, no-store"/);
    assert.match(exact[1], /Referrer-Policy "no-referrer"/);
  }
  const wildcard = nginx.match(/location \^~ \/api\/account\/ \{([\s\S]*?)\n    \}/);
  assert.ok(wildcard, 'unknown Account suffixes need an explicit fail-closed prefix');
  assert.match(wildcard[1], /access_log off;/);
  assert.match(wildcard[1], /return 404;/);
});

test('authority seam uses a dedicated staging identity in both directions', () => {
  const app = source(APP);
  const runbook = source(path.join(ROOT, 'README.md'));
  assert.match(app, /EARLY_BIRDS_AUTHORITY_SERVICE_KEY_ID=listener-identity-staging-v1/);
  assert.match(app, /EARLY_BIRDS_BEACON_SERVICE_KEY_CURRENT_ID=listener-identity-staging-v1/);
  assert.match(runbook, /http:\/\/listener-identity-staging:3000/);
  assert.match(runbook, /does not reuse its production Listener credential/);
});

test('shell entrypoints are executable and parse in POSIX sh', () => {
  for (const name of ['lib.sh', 'start.sh', 'health-smoke.sh', 'edge-smoke.sh', 'rollback.sh']) {
    const file = path.join(REPO, 'scripts/listener-identity-staging', name);
    assert.ok((fs.statSync(file).mode & 0o111) !== 0, `${name} must be executable`);
    const parsed = spawnSync('sh', ['-n', file], { encoding: 'utf8' });
    assert.equal(parsed.status, 0, parsed.stderr);
  }
});
