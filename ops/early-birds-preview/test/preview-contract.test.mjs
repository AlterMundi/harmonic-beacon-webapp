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
    ['real OAuth seam', 'EARLY_BIRDS_GOOGLE_CLIENT_ID=real-client-id', /must stay empty/],
    ['event database identity', 'EARLYBIRDS_PREVIEW_DB_NAME=beacon', /must be earlybirds_preview/],
    ['unsafe kill switch value', 'EARLY_BIRDS_ENABLED=true', /must be 0 or 1/],
    ['unsafe team-entry switch', 'EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=true', /must be 0 or 1/],
    ['wrong team-entry host', 'EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS=staging.example.invalid', /must be earlybirds-staging/],
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
});

test('compose gates the loopback Listener on a forward-only isolated database migration', async () => {
  const source = await readPreview('compose.yml');
  assert.match(source, /^  listener:$/m);
  assert.match(source, /127\.0\.0\.1:\$\{EARLYBIRDS_PREVIEW_APP_PORT:-13000\}:3000/);
  assert.match(source, /^  migration:$/m);
  assert.match(source, /command: \["npx", "prisma", "migrate", "deploy"\]/);
  assert.match(source, /condition: service_completed_successfully/);
  assert.doesNotMatch(source, /prisma[^\n]*(migrate reset|db push)/i);
  assert.match(source, /EARLY_BIRDS_ENABLED: \$\{EARLY_BIRDS_ENABLED:-0\}/);
  assert.match(source, /EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED: \$\{EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED:-0\}/);
  assert.match(source, /NODE_ENV: production/);
  assert.match(source, /preview_db:[\s\S]*internal: true/);
  assert.match(source, /listener_egress:/);
  assert.doesNotMatch(source, /livekit:|playlist-bot:|tapestry:/i);
  assert.doesNotMatch(source, /paypal|mercadopago|checkout/i);

  const postgresBlock = source.slice(source.indexOf('  postgres:'), source.indexOf('\n  # Forward-only'));
  assert.doesNotMatch(postgresBlock, /ports:/, 'preview PostgreSQL must stay container-private');
  assert.match(postgresBlock, /earlybirds-preview-postgres/, 'preview PostgreSQL needs a collision-proof alias');
  assert.match(source, /@earlybirds-preview-postgres:5432/, 'database URLs must use the collision-proof alias');
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

test('nginx templates name only the two staging hosts and proxy only fixed loopback ports', async () => {
  const app = await readPreview('nginx/earlybirds-staging.harmonicbeacon.com.conf.template');
  const stream = await readPreview('nginx/stream.harmonicbeacon.com.conf.template');
  const combined = `${app}\n${stream}`;
  const serverNames = [...combined.matchAll(/server_name\s+([^;]+);/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(serverNames)].sort(), [
    'earlybirds-staging.harmonicbeacon.com',
    'stream.harmonicbeacon.com',
  ]);
  const proxyTargets = [...combined.matchAll(/proxy_pass\s+([^;]+);/g)].map((match) => match[1]);
  assert.ok(proxyTargets.length >= 4);
  assert.ok(proxyTargets.every((target) => /^http:\/\/127\.0\.0\.1:(13000|18080)$/.test(target)));
  assert.doesNotMatch(combined, /live\.harmonicbeacon\.com/);
  assert.match(app, /letsencrypt\/live\/earlybirds-staging\.harmonicbeacon\.com/);
  assert.match(stream, /letsencrypt\/live\/stream\.harmonicbeacon\.com/);
  assert.match(app, /location \^~ \/api\/internal\//);
  assert.match(app, /location \^~ \/api\/early-birds\//);
  assert.match(app, /location = \/ \{\s*return 302 \/early-birds;/);
  assert.match(app, /location \/ \{\s*return 404;/);
  assert.doesNotMatch(app, /location \^~ \/api\/(auth|ops)|location \^~ \/(login|ops|session)/);
  assert.doesNotMatch(stream, /proxy_pass[^\n]*(9090|readyz|metrics)/);
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

test('smoke and rollback contracts cover both probes without deleting state', async () => {
  const smoke = await readRepository('scripts/early-birds-preview/health-smoke.sh');
  assert.match(smoke, /api\/health"/);
  assert.match(smoke, /api\/health\/ready/);
  assert.match(smoke, /stream_port}\/healthz/);
  assert.match(smoke, /127\.0\.0\.1:9090\/readyz/);
  assert.match(smoke, /State\.ExitCode/);

  const rollback = await readRepository('scripts/early-birds-preview/rollback.sh');
  assert.match(rollback, /stop listener beacon-stream/);
  assert.doesNotMatch(rollback, /preview_compose_command[^\n]*stop[^\n]*postgres|\bdown\b|volume rm/);
  const stop = await readRepository('scripts/early-birds-preview/stop.sh');
  assert.match(stop, /stop listener beacon-stream postgres/);
  assert.doesNotMatch(stop, /\bdown\b|-v\b|volume rm/);
});
