import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const previewRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(previewRoot, '../..');
const readPreview = (name) => fs.readFile(path.join(previewRoot, name), 'utf8');
const readRepository = (name) => fs.readFile(path.join(repositoryRoot, name), 'utf8');

const runGuard = (envFile) => spawnSync(
  'sh',
  ['-c', '. "$1"; require_synthetic_env "$2"', 'sh',
    path.resolve(repositoryRoot, 'scripts/early-birds-preview/lib.sh'), envFile],
  { encoding: 'utf8' },
);

test('synthetic guard accepts the example and rejects unsafe effective values', async (t) => {
  const source = await readPreview('preview.env.synthetic.example');
  assert.equal(runGuard(path.join(previewRoot, 'preview.env.synthetic.example')).status, 0);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'earlybirds-preview-guard-'));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));

  const cases = [
    ['live hostname', 'EARLY_BIRDS_AUTH_BASE_URL=https://live.harmonicbeacon.com', /must be https:\/\/earlybirds-staging/],
    ['HTTP stream origin', 'EARLY_BIRDS_STREAM_ORIGIN=http://stream.harmonicbeacon.com', /must be https:\/\/stream/],
    ['half-configured OAuth seam', 'EARLY_BIRDS_GOOGLE_CLIENT_ID=real-client-id', /configured together/],
    ['event database identity', 'EARLYBIRDS_PREVIEW_DB_NAME=beacon', /must be earlybirds_preview/],
    ['unsafe kill switch value', 'EARLY_BIRDS_ENABLED=true', /must be 0 or 1/],
    ['unsafe free-for-all switch', 'EARLY_BIRDS_FREE_FOR_ALL=true', /must be 0 or 1/],
    ['unsafe team-entry switch', 'EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=true', /must be 0 or 1/],
    ['unsafe PayPal checkout switch', 'BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED=true', /must be 0 or 1/],
    ['unsafe Mercado Pago checkout switch', 'BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED=true', /must be 0 or 1/],
    ['unsafe PayPal Live switch', 'BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED=1', /must be 0/],
    ['unsafe Mercado Pago Live switch', 'BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED=1', /must be 0/],
    ['unsafe private Live workbench switch', 'BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED=1', /must be 0/],
    ['synthetic private Live account', 'BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ACCOUNT_ID=opaque-account', /cannot contain a private Live account/],
    ['wrong team-entry host', 'EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS=staging.example.invalid', /must be earlybirds-staging/],
    ['unreviewed GeoIP path', 'BEACON_LISTENER_GEOIP_HOST_PATH=/tmp/random.mmdb', /reviewed absolute July 2026/],
    ['non-synthetic secret', 'EARLY_BIRDS_AUTH_SECRET=not-a-real-but-long-enough-secret-value', /visibly synthetic/],
  ];

  for (const [name, assignment, errorPattern] of cases) {
    await t.test(name, async () => {
      const envFile = path.join(temporary, `${name.replaceAll(' ', '-')}.env`);
      await fs.writeFile(envFile, `${source}\n${assignment}\n`, { mode: 0o600 });
      const result = runGuard(envFile);
      assert.equal(result.status, 2);
      assert.match(result.stderr, errorPattern);
    });
  }

  await t.test('guarded private authority handoff', async () => {
    const envFile = path.join(temporary, 'private-authority.env');
    await fs.writeFile(envFile, [
      source,
      'EARLYBIRDS_PREVIEW_AUTHORITY_NETWORK=earlybirds_authority_private',
      'EARLY_BIRDS_AUTHORITY_BASE_URL=http://pmp-myth-api:8765',
      '',
    ].join('\n'), { mode: 0o600 });
    assert.equal(runGuard(envFile).status, 0);
  });

  await t.test('guarded reviewed Beacon artifact handoff', async () => {
    const envFile = path.join(temporary, 'reviewed-beacon.env');
    await fs.writeFile(envFile, source
      .replaceAll('synthetic-preview-artifact', 'beacon-luz-20260624-2hs-aac320-v2'), { mode: 0o600 });
    assert.equal(runGuard(envFile).status, 0);
  });

  await t.test('guarded public Google OAuth handoff', async () => {
    const envFile = path.join(temporary, 'public-google-oauth.env');
    await fs.writeFile(envFile, source
      .replace(
        'EARLY_BIRDS_AUTH_BASE_URL=https://earlybirds-staging.harmonicbeacon.com',
        'EARLY_BIRDS_AUTH_BASE_URL=https://listen.harmonicbeacon.com',
      )
      .replace(
        'EARLY_BIRDS_TRUSTED_ORIGINS=https://earlybirds-staging.harmonicbeacon.com',
        'EARLY_BIRDS_TRUSTED_ORIGINS=https://listen.harmonicbeacon.com,https://earlybirds-staging.harmonicbeacon.com',
      )
      .replace('EARLY_BIRDS_GOOGLE_CLIENT_ID=', 'EARLY_BIRDS_GOOGLE_CLIENT_ID=google-client-id')
      .replace('EARLY_BIRDS_GOOGLE_CLIENT_SECRET=', 'EARLY_BIRDS_GOOGLE_CLIENT_SECRET=google-client-secret'), {
      mode: 0o600,
    });
    assert.equal(runGuard(envFile).status, 0);
  });

  await t.test('mismatched Listener and origin artifacts fail closed', async () => {
    const envFile = path.join(temporary, 'mismatched-beacon.env');
    await fs.writeFile(envFile, `${source}\nEARLY_BIRDS_STREAM_ARTIFACT_ID=beacon-luz-20260624-2hs-aac320-v2\n`, { mode: 0o600 });
    const result = runGuard(envFile);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /artifact IDs must match/);
  });
});

test('payment workbench keeps OAuth state and callback on the staging origin', async () => {
  const source = await readRepository('scripts/listener-ui-preview.sh');
  assert.match(source, /PREVIEW_ORIGIN="https:\/\/earlybirds-staging\.harmonicbeacon\.com"/);
  assert.match(source, /set_env_file_value BEACON_LISTENER_AUTH_BASE_URL "\$PREVIEW_ORIGIN"/);
  assert.match(source, /set_env_file_value EARLY_BIRDS_AUTH_BASE_URL "\$PREVIEW_ORIGIN"/);
  assert.match(source, /PREVIEW_LIVE_WORKBENCH="\$\{LISTENER_UI_PREVIEW_LIVE_WORKBENCH_ENABLED:-0\}"/);
  assert.match(source, /LIVE_WORKBENCH_ENV_FILE="\/etc\/harmonic-beacon\/listener-live-workbench\.env"/);
  assert.match(source, /harmonic-beacon\/earlybirds-preview-listener:\$\{PREVIEW_EXPECTED_SHA\}/);
  assert.match(source, /grep -Fqx "BEACON_GIT_SHA=\$PREVIEW_EXPECTED_SHA"/);
  assert.match(source, /PREVIEW_LIVE_WORKBENCH" = 1/);
  assert.match(source, /set_env_file_value EARLY_BIRDS_FREE_FOR_ALL 0/);
  assert.match(source, /set_env_file_value BEACON_LISTENER_FREE_FOR_ALL 0/);
  assert.match(source, /set_env_file_value BEACON_GIT_SHA "\$PREVIEW_EXPECTED_SHA"/);
  assert.match(source, /sudo stat -c '%u:%g:%a'/);
  assert.match(source, /workbench_container_started=1/);
  assert.match(source, /workbench_validated=1/);
  assert.match(source, /docker rm -f "\$DEV_CONTAINER"/);
  assert.match(source, /127\.0\.0\.1:13001/);
  assert.match(source, /api\/health\/ready/);
  assert.doesNotMatch(source, /PREVIEW_ORIGIN="https:\/\/listen\.harmonicbeacon\.com"/);
});

test('compose gates the loopback Listener on a forward-only isolated database migration', async () => {
  const source = await readPreview('compose.yml');
  const env = await readPreview('preview.env.synthetic.example');
  const schemaVersion = env.match(/^EARLYBIRDS_PREVIEW_SCHEMA_VERSION=(.+)$/m)?.[1];
  const migrations = await fs.readdir(path.join(repositoryRoot, 'prisma/migrations'));
  assert.ok(schemaVersion, 'preview schema provenance must be explicit');
  assert.ok(migrations.includes(schemaVersion), 'preview schema provenance must name a checked-in migration');
  assert.match(source, /BEACON_DATABASE_SCHEMA_VERSION: \$\{EARLYBIRDS_PREVIEW_SCHEMA_VERSION:\?set_in_preview\.env\}/);
  assert.equal((source.match(/BEACON_GIT_SHA: \$\{EARLYBIRDS_PREVIEW_GIT_SHA:-synthetic-preview\}/g) ?? []).length, 2);
  assert.equal((source.match(/BEACON_BUILD_TIME: \$\{EARLYBIRDS_PREVIEW_BUILD_TIME:-synthetic-preview\}/g) ?? []).length, 2);
  assert.equal((source.match(/BEACON_DATABASE_SCHEMA_VERSION: \$\{EARLYBIRDS_PREVIEW_SCHEMA_VERSION:\?set_in_preview\.env\}/g) ?? []).length, 2);
  assert.doesNotMatch(source, /preview-forward-only/);
  assert.match(source, /^  listener:$/m);
  assert.match(source, /127\.0\.0\.1:\$\{EARLYBIRDS_PREVIEW_APP_PORT:-13000\}:3000/);
  assert.match(source, /^  migration:$/m);
  assert.match(source, /command: \["npx", "prisma", "migrate", "deploy"\]/);
  assert.match(source, /condition: service_completed_successfully/);
  assert.doesNotMatch(source, /prisma[^\n]*(migrate reset|db push)/i);
  assert.match(source, /EARLY_BIRDS_ENABLED: \$\{EARLY_BIRDS_ENABLED:-0\}/);
  assert.match(source, /EARLY_BIRDS_FREE_FOR_ALL: \$\{EARLY_BIRDS_FREE_FOR_ALL:-0\}/);
  assert.match(source, /EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED: \$\{EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED:-0\}/);
  assert.match(source, /BEACON_LISTENER_REACTIVE_FIELD_LAB_ENABLED: \$\{BEACON_LISTENER_REACTIVE_FIELD_LAB_ENABLED:-0\}/);
  assert.match(source, /BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED: \$\{BEACON_LISTENER_PAYPAL_SANDBOX_CHECKOUT_ENABLED:-0\}/);
  assert.match(source, /BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED: \$\{BEACON_LISTENER_MERCADO_PAGO_TEST_CHECKOUT_ENABLED:-0\}/);
  assert.match(source, /BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED: \$\{BEACON_LISTENER_PAYPAL_LIVE_CHECKOUT_ENABLED:-0\}/);
  assert.match(source, /BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED: \$\{BEACON_LISTENER_MERCADO_PAGO_LIVE_CHECKOUT_ENABLED:-0\}/);
  assert.match(source, /BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED: \$\{BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ENABLED:-0\}/);
  assert.match(source, /BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ACCOUNT_ID: \$\{BEACON_LISTENER_STAGING_LIVE_WORKBENCH_ACCOUNT_ID:-\}/);
  assert.match(source, /BEACON_LISTENER_STAGING_LIVE_WORKBENCH_PROVIDER: \$\{BEACON_LISTENER_STAGING_LIVE_WORKBENCH_PROVIDER:-\}/);
  assert.match(source, /BEACON_LISTENER_STAGING_LIVE_WORKBENCH_CSRF_SECRET: \$\{BEACON_LISTENER_STAGING_LIVE_WORKBENCH_CSRF_SECRET:-\}/);
  assert.match(source, /NODE_ENV: production/);
  assert.match(source, /preview_db:[\s\S]*internal: true/);
  assert.match(source, /listener_egress:/);
  assert.doesNotMatch(source, /livekit:|playlist-bot:|tapestry:/i);
  assert.doesNotMatch(source, /PAYPAL_(?:CLIENT|SECRET|PRODUCT|PLAN|WEBHOOK)|MERCADO_PAGO_(?:ACCESS_TOKEN|WEBHOOK_SECRET)|PAID_CHECKOUT_ENABLED/);

  const postgresBlock = source.slice(source.indexOf('  postgres:'), source.indexOf('\n  # Forward-only'));
  assert.doesNotMatch(postgresBlock, /ports:/, 'preview PostgreSQL must stay container-private');
  assert.match(postgresBlock, /earlybirds-preview-postgres/, 'preview PostgreSQL needs a collision-proof alias');
  assert.match(source, /@earlybirds-preview-postgres:5432/, 'database URLs must use the collision-proof alias');
  assert.match(source, /BEACON_LISTENER_GEOIP_DB_PATH: \/data\/geoip\/dbip-country-lite\.mmdb/);
  assert.match(source, /BEACON_LISTENER_GEOIP_HOST_PATH[^\n]*:\/data\/geoip\/dbip-country-lite\.mmdb:ro/);
});

test('optional authority overlay joins only the dedicated external private network', async () => {
  const source = await readPreview('authority-network.override.yml');
  assert.match(source, /^  listener:$/m);
  assert.match(source, /authority_private:/);
  assert.match(source, /external: true/);
  assert.match(source, /EARLYBIRDS_PREVIEW_AUTHORITY_NETWORK/);
  assert.match(source, /earlybirds-listener/);
  assert.doesNotMatch(source, /paypal|mercadopago|checkout|pmp_beacon_internal/i);
  const helper = await readRepository('scripts/early-birds-preview/lib.sh');
  assert.match(helper, /docker network inspect --format '\{\{\.Internal\}\}'/);
  assert.match(helper, /authority network must already exist with Internal=true/);
});

test('stream overlay preserves its isolated build and adds a public liveness probe', async () => {
  const source = await readPreview('stream-build.override.yml');
  assert.match(source, /context: \.\.\/\.\.\/services\/beacon-stream/);
  assert.match(source, /dockerfile: Dockerfile/);
  assert.match(source, /127\.0\.0\.1:8080\/healthz/);
});

test('stream publishes only through a dedicated edge network', async () => {
  const source = await readRepository('services/beacon-stream/docker-compose.yml');
  assert.match(source, /127\.0\.0\.1:\$\{BEACON_STREAM_HOST_PORT:-18080\}:8080/);
  assert.match(source, /- stream_observability\s+[^]*- stream_edge/);
  assert.match(source, /stream_observability:\s+name: earlybirds_stream_observability\s+internal: true/);
  assert.match(source, /stream_edge:\s+name: earlybirds_stream_edge/);
});

test('nginx templates isolate staging, stream and the constrained public Listener host', async () => {
  const app = await readPreview('nginx/earlybirds-staging.harmonicbeacon.com.conf.template');
  const listener = await readPreview('nginx/listen.harmonicbeacon.com.conf.template');
  const stream = await readPreview('nginx/stream.harmonicbeacon.com.conf.template');
  const combined = `${app}\n${listener}\n${stream}`;
  const serverNames = [...combined.matchAll(/server_name\s+([^;]+);/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(serverNames)].sort(), [
    'earlybirds-staging.harmonicbeacon.com',
    'listen.harmonicbeacon.com',
    'stream.harmonicbeacon.com',
  ]);
  const proxyTargets = [...combined.matchAll(/proxy_pass\s+([^;]+);/g)].map((match) => match[1]);
  assert.ok(proxyTargets.length >= 4);
  assert.ok(proxyTargets.every((target) => /^http:\/\/127\.0\.0\.1:(13000|13001|18080|18876)$/.test(target)));
  assert.doesNotMatch(combined, /live\.harmonicbeacon\.com/);
  assert.match(app, /letsencrypt\/live\/earlybirds-staging\.harmonicbeacon\.com/);
  assert.match(stream, /letsencrypt\/live\/stream\.harmonicbeacon\.com/);
  assert.match(listener, /letsencrypt\/live\/listen\.harmonicbeacon\.com/);
  assert.match(app, /location \^~ \/api\/internal\//);
  assert.match(app, /location \^~ \/api\/early-birds\//);
  assert.equal(
    (app.match(/X-Harmonic-Beacon-Environment "early-birds-staging"/g) ?? []).length,
    10,
    'server plus nine sensitive HTTPS staging locations retain the environment attestation when add_header inheritance stops',
  );
  assert.equal(
    (listener.match(/X-Harmonic-Beacon-Environment "listener-public-free"/g) ?? []).length,
    9,
    'server plus eight sensitive HTTPS locations retain the environment attestation when add_header inheritance stops',
  );
  assert.match(app, /location = \/ \{[^}]*access_log off;[^}]*rewrite \^ \/listener break;[^}]*proxy_pass http:\/\/127\.0\.0\.1:13001;/s);
  assert.match(app, /location \/_next\/webpack-hmr \{[^}]*proxy_pass http:\/\/127\.0\.0\.1:13001;[^}]*Upgrade \$http_upgrade;[^}]*Connection "upgrade";/s);
  assert.match(app, /location \/_next\/static\/ \{[^}]*proxy_pass http:\/\/127\.0\.0\.1:13001;[^}]*Cache-Control "private, no-store"/s);
  assert.match(app, /location = \/api\/listener\/analysis\/frame \{[^}]*proxy_pass http:\/\/127\.0\.0\.1:13001;[^}]*Cache-Control "private, no-store"/s);
  assert.match(app, /location = \/api\/listener\/checkout \{[^}]*access_log off;[^}]*client_max_body_size 512;[^}]*limit_req zone=listener_checkout burst=4 nodelay;[^}]*limit_req_status 429;[^}]*proxy_pass http:\/\/127\.0\.0\.1:13001;[^}]*Cache-Control "private, no-store"/s);
  assert.match(app, /location = \/api\/listener\/checkout\/live-workbench \{[^}]*access_log off;[^}]*client_max_body_size 256;[^}]*limit_req zone=listener_checkout burst=2 nodelay;[^}]*limit_req_status 429;[^}]*proxy_pass http:\/\/127\.0\.0\.1:13001;[^}]*Cache-Control "private, no-store"/s);
  assert.doesNotMatch(listener, /location = \/api\/listener\/checkout\/live-workbench/);
  assert.match(app, /location = \/api\/listener\/membership\/action \{[^}]*access_log off;[^}]*client_max_body_size 256;[^}]*limit_req zone=listener_checkout burst=2 nodelay;[^}]*proxy_pass http:\/\/127\.0\.0\.1:13001;/s);
  assert.match(app, /location = \/listener\/terms \{[^}]*proxy_pass http:\/\/127\.0\.0\.1:13001;/s);
  assert.match(app, /location = \/listener\/privacy \{[^}]*proxy_pass http:\/\/127\.0\.0\.1:13001;/s);
  assert.match(listener, /location = \/api\/listener\/checkout \{[^}]*access_log off;[^}]*limit_req zone=listener_live_checkout burst=4 nodelay;[^}]*client_max_body_size 512;[^}]*proxy_pass http:\/\/127\.0\.0\.1:13000;[^}]*Cache-Control "private, no-store"/s);
  assert.match(listener, /location = \/api\/listener\/membership\/action \{[^}]*access_log off;[^}]*limit_req zone=listener_membership_action burst=2 nodelay;[^}]*client_max_body_size 256;[^}]*proxy_pass http:\/\/127\.0\.0\.1:13000;/s);
  assert.doesNotMatch(app, /location = \/api\/listener\/membership\/cancel/);
  assert.doesNotMatch(listener, /location = \/api\/listener\/membership\/cancel/);
  assert.match(listener, /location = \/listener\/terms \{[^}]*proxy_pass http:\/\/127\.0\.0\.1:13000;/s);
  assert.match(listener, /location = \/listener\/privacy \{[^}]*proxy_pass http:\/\/127\.0\.0\.1:13000;/s);
  assert.match(listener, /limit_req_zone \$binary_remote_addr zone=listener_live_checkout:1m rate=6r\/m;/);
  assert.match(listener, /limit_req_zone \$binary_remote_addr zone=listener_provider_webhook:1m rate=120r\/m;/);
  assert.match(app, /limit_req_zone \$binary_remote_addr zone=listener_visual_analysis:1m rate=20r\/s;/);
  assert.match(app, /limit_req_zone \$binary_remote_addr zone=listener_payment_webhooks:1m rate=60r\/m;/);
  assert.match(app, /limit_req_zone \$binary_remote_addr zone=listener_checkout:1m rate=6r\/m;/);
  assert.match(app, /log_format listener_payment_webhook '[^']*\$request_method \$uri \$status[^']*';/);
  assert.doesNotMatch(app, /log_format listener_payment_webhook[^\n]*(\$request_uri|\$args|\$query_string)/);
  for (const provider of ['paypal', 'mercado-pago']) {
    const start = app.indexOf(`location = /v1/webhooks/early-birds/${provider} {`);
    assert.notEqual(start, -1);
    const nextLocation = app.indexOf('\n\n    location ', start + 1);
    const block = app.slice(start, nextLocation === -1 ? undefined : nextLocation);
    assert.match(block, /request_method != POST/);
    assert.match(block, /return 405;/);
    assert.match(block, /client_max_body_size 1m;/);
    assert.match(block, /limit_req zone=listener_payment_webhooks burst=60 nodelay;/);
    assert.match(block, /limit_req_status 429;/);
    assert.match(block, /access_log \/var\/log\/nginx\/listener-payment-webhooks\.log listener_payment_webhook;/);
    assert.match(block, /proxy_pass http:\/\/127\.0\.0\.1:18876;/);
  }
  assert.equal((app.match(/proxy_pass http:\/\/127\.0\.0\.1:18876;/g) ?? []).length, 2);
  for (const provider of ['paypal', 'mercado-pago']) {
    const start = listener.indexOf(`location = /v1/webhooks/listener/${provider} {`);
    assert.notEqual(start, -1);
    const nextLocation = listener.indexOf('\n\n    location ', start + 1);
    const block = listener.slice(start, nextLocation === -1 ? undefined : nextLocation);
    assert.match(block, /request_method != POST/);
    assert.match(block, /return 405;/);
    assert.match(block, /access_log off;/);
    assert.match(block, /client_max_body_size 1m;/);
    assert.match(block, /limit_req zone=listener_provider_webhook burst=30 nodelay;/);
    assert.match(block, /proxy_pass http:\/\/127\.0\.0\.1:18876;/);
  }
  assert.equal((listener.match(/proxy_pass http:\/\/127\.0\.0\.1:18876;/g) ?? []).length, 2);
  assert.doesNotMatch(listener, /\/v1\/webhooks\/early-birds\/(paypal|mercado-pago)/);
  assert.match(app, /location = \/api\/listener\/analysis\/frame \{[^}]*limit_req zone=listener_visual_analysis burst=40 nodelay;/s);
  assert.match(listener, /limit_req_zone \$binary_remote_addr zone=listener_public_visual_analysis:1m rate=20r\/s;/);
  assert.match(listener, /location = \/api\/listener\/analysis\/frame \{[^}]*limit_req zone=listener_public_visual_analysis burst=40 nodelay;[^}]*proxy_pass http:\/\/127\.0\.0\.1:13000;[^}]*Cache-Control "private, no-store"/s);
  assert.doesNotMatch(app, /proxy_pass http:\/\/127\.0\.0\.1:13000;/);
  assert.match(app, /location = \/early-birds\/home \{\s*return 302 \/;/);
  assert.match(app, /location \/ \{\s*return 404;/);
  assert.doesNotMatch(app, /location \^~ \/api\/(auth|ops)|location \^~ \/(login|ops|session)/);
  assert.doesNotMatch(stream, /proxy_pass[^\n]*(9090|readyz|metrics)/);
  assert.match(listener, /location \^~ \/api\/early-birds\/stream\//);
  assert.match(listener, /location \^~ \/api\/early-birds\/drop-ins\//);
  assert.match(listener, /location \^~ \/api\/early-birds\/auth\//);
  for (const path of ['early-birds', 'listener']) {
    assert.match(listener, new RegExp(
      `location = /${path} \\{[^}]*access_log off;[^}]*Cache-Control "private, no-store"[^}]*Referrer-Policy "no-referrer"[^}]*return 302 /\\$is_args\\$args;`,
      's',
    ));
  }
  for (const path of ['early-birds/redeem', 'listener/redeem']) {
    assert.match(listener, new RegExp(
      `location = /${path} \\{[^}]*access_log off;[^}]*Cache-Control "private, no-store"[^}]*Referrer-Policy "no-referrer"[^}]*proxy_pass http://127\\.0\\.0\\.1:13000;`,
      's',
    ));
  }
  assert.match(listener, /location = \/ \{[^}]*access_log off;[^}]*rewrite \^ \/listener break;[^}]*proxy_pass http:\/\/127\.0\.0\.1:13000;/s);
  assert.match(listener, /location = \/api\/listener\/access-state/);
  assert.match(listener, /location = \/api\/early-birds\/access-state/);
  assert.match(listener, /location = \/api\/listener\/free-window/);
  assert.match(listener, /location = \/api\/early-birds\/free-window/);
  assert.match(listener, /location = \/api\/listener\/welcome-access/);
  assert.match(listener, /location = \/api\/early-birds\/welcome-access/);
  assert.match(listener, /location = \/api\/listener\/presence/);
  assert.match(listener, /location = \/robots\.txt \{[^}]*rewrite \^ \/api\/listener\/public-discovery\/robots\.txt break;[^}]*proxy_pass http:\/\/127\.0\.0\.1:13000;[^}]*proxy_set_header Host \$host;/s);
  assert.match(listener, /location = \/sitemap\.xml \{[^}]*rewrite \^ \/api\/listener\/public-discovery\/sitemap\.xml break;[^}]*proxy_pass http:\/\/127\.0\.0\.1:13000;[^}]*proxy_set_header Host \$host;/s);
  assert.equal((listener.match(/location = \/robots\.txt/g) ?? []).length, 1);
  assert.equal((listener.match(/location = \/sitemap\.xml/g) ?? []).length, 1);
  assert.doesNotMatch(listener, /location \^~ \/api\/listener\/public-discovery\//);
  assert.doesNotMatch(listener, /location \^~ \/api\/listener\//);
  // The internal session-cookie observations exposition is loopback-only:
  // the public Listener template must never expose or proxy it.
  assert.doesNotMatch(listener, /session-cookie-observations/);
  assert.doesNotMatch(listener, /location \^~ \/api\/internal\//);
  assert.doesNotMatch(listener, /api\/early-birds\/(test-login|membership)/);
  assert.doesNotMatch(listener, /api\/listener\/test-login/);
  assert.doesNotMatch(listener, /location \^~ \/api\/listener\/membership/);
  assert.doesNotMatch(listener, /location \^~ \/early-birds\//);

  assert.match(listener, /limit_req_zone \$binary_remote_addr zone=listener_invitation_redeem:1m rate=30r\/m;/);
  for (const path of ['api/listener/free/redeem', 'api/early-birds/free/redeem']) {
    assert.match(listener, new RegExp(
      `location = /${path} \\{[^}]*access_log off;[^}]*limit_req zone=listener_invitation_redeem burst=20 nodelay;[^}]*Cache-Control "private, no-store"[^}]*Referrer-Policy "no-referrer"[^}]*proxy_pass http://127\\.0\\.0\\.1:13000;`,
      's',
    ));
  }
  const magicVerificationLocations = [...listener.matchAll(
    /location = \/api\/early-birds\/auth\/magic-link\/verify \{([^}]*)\}/g,
  )];
  assert.equal(magicVerificationLocations.length, 2, 'HTTP and HTTPS magic bearer entries must be exact');
  assert.ok(magicVerificationLocations.every((match) => (
    /access_log off;/.test(match[1])
    && /Cache-Control "private, no-store"/.test(match[1])
    && /Referrer-Policy "no-referrer"/.test(match[1])
  )));

  const publicSensitiveEntries = [...listener.matchAll(
    /location = \/(?:listener(?:\/redeem)?|early-birds(?:\/redeem)?)? \{([^}]*)\}/g,
  )];
  assert.equal(publicSensitiveEntries.length, 10, 'HTTP and HTTPS must protect root and every invitation alias');
  assert.ok(publicSensitiveEntries.every((match) => /access_log off;/.test(match[1])));
  const edgeHeaderProtected = publicSensitiveEntries.filter((match) => (
    /Cache-Control "private, no-store"/.test(match[1])
    && /Referrer-Policy "no-referrer"/.test(match[1])
  ));
  assert.equal(edgeHeaderProtected.length, 9, 'the proxied HTTPS root delegates no-store/no-referrer to middleware');

  const invitationEntryLocations = [...app.matchAll(
    /location = \/(?:listener|early-birds)(?:\/redeem)? \{([^}]*)\}/g,
  )];
  assert.equal(invitationEntryLocations.length, 8, 'HTTP and HTTPS must protect canonical and legacy invitation entries');
  assert.ok(invitationEntryLocations.every((match) => (
    /access_log off;/.test(match[1])
    && /Cache-Control "private, no-store"/.test(match[1])
    && /Referrer-Policy "no-referrer"/.test(match[1])
  )));
  for (const path of ['early-birds/redeem', 'listener/redeem']) {
    const stagingRedeemPages = [...app.matchAll(new RegExp(
      `location = /${path} \\{([^}]*)\\}`,
      'g',
    ))];
    assert.equal(stagingRedeemPages.length, 2, `HTTP and HTTPS /${path} must be exact`);
    assert.ok(stagingRedeemPages.every((match) => (
      /access_log off;/.test(match[1])
      && /Cache-Control "private, no-store"/.test(match[1])
      && /Referrer-Policy "no-referrer"/.test(match[1])
      && /return 302 https:\/\/listen\.harmonicbeacon\.com\/listener\/redeem\$is_args\$args;/.test(match[1])
    )));
  }

  const stagingMagicVerificationLocations = [...app.matchAll(
    /location = \/api\/early-birds\/auth\/magic-link\/verify \{([^}]*)\}/g,
  )];
  assert.equal(stagingMagicVerificationLocations.length, 2, 'staging HTTP and HTTPS magic bearer entries must be exact');
  assert.ok(stagingMagicVerificationLocations.every((match) => (
    /access_log off;/.test(match[1])
    && /Cache-Control "private, no-store"/.test(match[1])
    && /Referrer-Policy "no-referrer"/.test(match[1])
    && /return 302 https:\/\/listen\.harmonicbeacon\.com\$request_uri;/.test(match[1])
  )));

  for (const path of ['api/listener/free/redeem', 'api/early-birds/free/redeem']) {
    const closedStagingPosts = [...app.matchAll(new RegExp(
      `location = /${path} \\{([^}]*)\\}`,
      'g',
    ))];
    assert.equal(closedStagingPosts.length, 2, `HTTP and HTTPS /${path} must be exact`);
    assert.ok(closedStagingPosts.every((match) => (
      /access_log off;/.test(match[1])
      && /Cache-Control "private, no-store"/.test(match[1])
      && /Referrer-Policy "no-referrer"/.test(match[1])
      && /return 404;/.test(match[1])
      && !/proxy_pass/.test(match[1])
    )), `staging /${path} must fail closed without reaching the application`);
  }
  const stagingRoots = [...app.matchAll(/location = \/ \{([^}]*)\}/g)];
  assert.equal(stagingRoots.length, 2, 'HTTP and HTTPS staging roots must both be explicit');
  assert.ok(stagingRoots.every((match) => /access_log off;/.test(match[1])));
  for (const path of ['access-state', 'free-window', 'welcome-access']) {
    assert.match(app, new RegExp(`location = /api/listener/${path.replace('/', '\\/')}`));
  }
  assert.doesNotMatch(app, /location \^~ \/api\/listener\//);
});

test('ACME bootstrap serves only challenges and never proxies preview traffic', async () => {
  const source = await readPreview('nginx/acme-bootstrap.conf.template');
  assert.match(source, /server_name earlybirds-staging\.harmonicbeacon\.com stream\.harmonicbeacon\.com/);
  assert.match(source, /location \/\.well-known\/acme-challenge\//);
  assert.match(source, /root \/var\/www\/html/);
  assert.match(source, /location \/ \{\s*return 503;/);
  assert.doesNotMatch(source, /listen 443|ssl_certificate|proxy_pass/);
});

test('public Listener certificate bootstrap is HTTP-only and fail closed', async () => {
  const source = await readPreview('nginx/listen-acme-bootstrap.conf.template');
  assert.match(source, /server_name listen\.harmonicbeacon\.com/);
  assert.match(source, /location \/\.well-known\/acme-challenge\//);
  assert.match(source, /location \/ \{\s*return 503;/);
  assert.doesNotMatch(source, /listen 443|ssl_certificate|proxy_pass/);
  assert.doesNotMatch(source, /session-cookie-observations/);
});

test('production Listener HTTPS validation remains fail closed', async () => {
  const streamContract = await readRepository('src/lib/early-birds/stream.ts');
  assert.match(
    streamContract,
    /environment\.NODE_ENV === 'production' && parsed\.protocol !== 'https:'/,
  );
  const compose = await readPreview('compose.yml');
  assert.match(compose, /NODE_ENV: production/);
  const env = await readPreview('preview.env.synthetic.example');
  assert.match(env, /^EARLY_BIRDS_STREAM_ORIGIN=https:\/\/stream\.harmonicbeacon\.com$/m);
});

test('smoke covers both probes while ordinary app rollback preserves the origin and state', async () => {
  const smoke = await readRepository('scripts/early-birds-preview/health-smoke.sh');
  assert.match(smoke, /api\/health"/);
  assert.match(smoke, /databaseSchemaVersion/);
  assert.match(smoke, /EARLYBIRDS_PREVIEW_SCHEMA_VERSION/);
  assert.match(smoke, /grep -Fq/, 'host schema check must use the POSIX host toolchain');
  assert.match(smoke, /api\/health\/ready/);
  assert.match(smoke, /stream_port}\/healthz/);
  assert.match(smoke, /127\.0\.0\.1:9090\/readyz/);
  assert.match(smoke, /State\.ExitCode/);

  const rollback = await readRepository('scripts/early-birds-preview/rollback.sh');
  assert.match(rollback, /stop listener/);
  assert.doesNotMatch(rollback, /preview_compose_command[^\n]*stop[^\n]*(postgres|beacon-stream)|\bdown\b|volume rm/);
  const start = await readRepository('scripts/early-birds-preview/start.sh');
  assert.match(start, /up -d --build listener/);
  assert.doesNotMatch(start, /up[^\n]*listener[^\n]*beacon-stream|up[^\n]*beacon-stream[^\n]*listener/);
  const startOrigin = await readRepository('scripts/early-birds-preview/start-origin.sh');
  assert.match(startOrigin, /up -d --build --no-deps beacon-stream/);
  assert.doesNotMatch(startOrigin, /\blistener\b.*\bup\b|up[^\n]*listener/);
  const stop = await readRepository('scripts/early-birds-preview/stop.sh');
  assert.match(stop, /stop listener beacon-stream postgres/);
  assert.doesNotMatch(stop, /\bdown\b|-v\b|volume rm/);

  const disablePublic = await readRepository('scripts/early-birds-preview/disable-public.sh');
  assert.match(disablePublic, /--dry-run\|--apply/);
  assert.match(disablePublic, /flock -n 9/);
  assert.match(disablePublic, /pre-disable-public/);
  assert.match(disablePublic, /chmod 0600 "\$backup"/);
  assert.match(disablePublic, /mv -f "\$candidate" "\$env_file"/);
  assert.match(disablePublic, /sync -f "\$env_file"/);
  assert.match(disablePublic, /up -d --no-deps --force-recreate --no-build listener/);
  assert.match(disablePublic, /api\/health\/ready/);
  assert.match(disablePublic, /api\/early-birds\/stream\/lease/);
  assert.match(disablePublic, /test "\$denial_status" = 503/);
  assert.match(disablePublic, /stop listener/);
  assert.doesNotMatch(disablePublic, /\bdown\b|volume rm|stop (?:.* )?(postgres|beacon-stream)/);
});

test('canonical Free smoke keeps credentials out of argv and verifies the entitled home', async () => {
  const source = await readRepository('scripts/early-birds-preview/canonical-free-smoke.sh');
  assert.match(source, /require_synthetic_env/);
  assert.match(source, /--config "\$temporary\/login\.curl"/);
  assert.match(source, /api\/early-birds\/free\/redeem/);
  assert.match(source, /\$base_url\//);
  assert.match(source, /invitation\.curl/);
  assert.match(source, /trap 'rm -rf "\$temporary"'/);
  assert.doesNotMatch(source, /echo[^\n]*(login_secret|invitation_token)/);
});

test('registered Free smoke covers weekly quota and device boundaries without exposing its bearer', async () => {
  const source = await readRepository('scripts/early-birds-preview/registered-free-smoke.sh');
  assert.match(source, /require_synthetic_env/);
  assert.match(source, /--config "\$temporary\/login\.curl"/);
  assert.match(source, /personal-7-day-v1/);
  assert.match(source, /baseAllowanceMs == 10800000/);
  assert.match(source, /removed_status" = 404/);
  assert.match(source, /for ordinal in 1 2 3/);
  assert.match(source, /evictedAnotherDevice/);
  assert.match(source, /\.reason == "displaced"/);
  assert.match(source, /api\/early-birds\/stream\/manifest/);
  assert.match(source, /leaseGeneration/);
  assert.match(source, /trap 'rm -rf "\$temporary"'/);
  assert.doesNotMatch(source, /echo[^\n]*login_secret/);
});

test('Free for All quiescence is shipped as a fail-closed server-only operation', async () => {
  const script = await readRepository('scripts/listener-quiesce-for-free-for-all.ts');
  const dockerfile = await readRepository('Dockerfile');
  assert.match(script, /EARLY_BIRDS_ENABLED !== '0'/);
  assert.match(script, /EARLY_BIRDS_FREE_FOR_ALL !== '0'/);
  assert.match(script, /quiescePersonalListenerLeasesForFreeForAll/);
  assert.match(script, /MAX_BATCHES/);
  assert.doesNotMatch(script, /accountId|email|deviceDigest/);
  assert.match(dockerfile, /listener-quiesce-for-free-for-all\.ts/);
  assert.match(dockerfile, /src\/lib\/early-birds\/quota\.ts/);
  assert.match(dockerfile, /src\/lib\/early-birds\/stream\.ts/);
});
