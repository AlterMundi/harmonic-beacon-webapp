import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'earlybirds-preview-'));
const envFile = path.join(temporary, 'preview.env');
const syntheticSecret = 'synthetic-preview-stream-signing-secret-at-least-32-characters';

const syntheticEnv = [
  'EARLYBIRDS_PREVIEW_ENV=synthetic',
  'EARLYBIRDS_PREVIEW_DB_USER=earlybirds_preview',
  'EARLYBIRDS_PREVIEW_DB_PASSWORD=synthetic-preview-database-password',
  'EARLYBIRDS_PREVIEW_DB_NAME=earlybirds_preview',
  'EARLYBIRDS_PREVIEW_APP_PORT=13000',
  'EARLYBIRDS_PREVIEW_IMAGE_TAG=synthetic',
  'EARLYBIRDS_WITHDRAWAL_OPERATOR_IMAGE_TAG=synthetic',
  'EARLYBIRDS_WITHDRAWAL_OPERATOR_GIT_SHA=synthetic-preview',
  'EARLYBIRDS_PREVIEW_GIT_SHA=synthetic-preview',
  'EARLYBIRDS_PREVIEW_BUILD_TIME=synthetic-preview',
  'EARLYBIRDS_PREVIEW_SCHEMA_VERSION=preview-forward-only',
  'EARLYBIRDS_PREVIEW_AUTHORITY_NETWORK=',
  'EARLY_BIRDS_ENABLED=0',
  'EARLY_BIRDS_FREE_FOR_ALL=0',
  'EARLY_BIRDS_AUTH_BASE_URL=https://earlybirds-staging.harmonicbeacon.com',
  'EARLY_BIRDS_TRUSTED_ORIGINS=https://earlybirds-staging.harmonicbeacon.com',
  'EARLY_BIRDS_AUTH_SECRET=synthetic-preview-auth-secret-at-least-32-characters',
  'EARLY_BIRDS_GOOGLE_CLIENT_ID=',
  'EARLY_BIRDS_GOOGLE_CLIENT_SECRET=',
  'EARLY_BIRDS_APPLE_CLIENT_ID=',
  'EARLY_BIRDS_APPLE_CLIENT_SECRET=',
  'EARLY_BIRDS_TEST_ACCESS_ENABLED=1',
  'EARLY_BIRDS_TEST_LOGIN_SECRET=synthetic-preview-login-secret-at-least-32-characters',
  'EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=0',
  'BEACON_LISTENER_REACTIVE_FIELD_LAB_ENABLED=0',
  'LISTENER_WITHDRAWAL_ENABLED=0',
  'LISTENER_WITHDRAWAL_SECRET=',
  'EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS=earlybirds-staging.harmonicbeacon.com',
  'BEACON_LISTENER_GEOIP_HOST_PATH=.',
  'EARLY_BIRDS_AUTHORITY_BASE_URL=https://authority.example.invalid',
  'EARLY_BIRDS_AUTHORITY_SERVICE_KEY_ID=synthetic-v1',
  'EARLY_BIRDS_AUTHORITY_SERVICE_TOKEN=synthetic-preview-authority-token-at-least-43-characters-long',
  'EARLY_BIRDS_BEACON_SERVICE_KEY_CURRENT_ID=synthetic-v1',
  'EARLY_BIRDS_BEACON_SERVICE_KEY_CURRENT=synthetic-preview-inbound-token-at-least-43-characters-long',
  'EARLY_BIRDS_STREAM_ORIGIN=https://stream.harmonicbeacon.com',
  'EARLY_BIRDS_STREAM_CONTROL_ORIGIN=http://beacon-stream:8080',
  'EARLY_BIRDS_STREAM_ARTIFACT_ID=synthetic-preview-artifact',
  `EARLY_BIRDS_STREAM_SIGNING_SECRET=${syntheticSecret}`,
  'EARLY_BIRDS_DEVICE_PEPPER=synthetic-preview-device-pepper-at-least-32-characters',
  'EARLY_BIRDS_DROPIN_ES_PATH=',
  'EARLY_BIRDS_DROPIN_EN_PATH=',
  'BEACON_STREAM_ARTIFACTS_HOST_PATH=.',
  'BEACON_STREAM_MEDIA_ROOT=/media/artifacts',
  'BEACON_STREAM_ARTIFACT_ID=synthetic-preview-artifact',
  'BEACON_STREAM_PUBLIC_ORIGIN=https://stream.harmonicbeacon.com',
  'BEACON_STREAM_ALLOWED_ORIGINS=https://earlybirds-staging.harmonicbeacon.com',
  `BEACON_STREAM_SIGNING_SECRET=${syntheticSecret}`,
  'BEACON_STREAM_HOST_PORT=18080',
  '',
].join('\n');
await fs.writeFile(envFile, syntheticEnv, { mode: 0o600 });

const composeArgs = [
  'compose',
  '--project-name', 'earlybirds-preview-validation',
  '--env-file', envFile,
  '-f', path.join(root, 'ops/early-birds-preview/compose.yml'),
  '-f', path.join(root, 'services/beacon-stream/docker-compose.yml'),
  '-f', path.join(root, 'ops/early-birds-preview/stream-build.override.yml'),
];

function publishedPort(service, target) {
  return service.ports?.find((port) => Number(port.target) === target);
}

try {
  execFileSync('docker', [...composeArgs, 'config', '--quiet'], { stdio: 'inherit' });
  const rendered = execFileSync('docker', [...composeArgs, 'config', '--format', 'json'], {
    encoding: 'utf8',
  });
  const resolved = JSON.parse(rendered);
  const { postgres, migration, listener, 'withdrawal-operator': withdrawalOperator, 'beacon-stream': stream } = resolved.services;

  assert.deepEqual(Object.keys(resolved.services).sort(), [
    'beacon-stream', 'listener', 'migration', 'postgres', 'withdrawal-operator',
  ]);
  assert.equal(postgres.ports, undefined, 'PostgreSQL must not publish a host port');
  assert.deepEqual(Object.keys(postgres.networks), ['preview_db']);
  assert.deepEqual(postgres.networks.preview_db.aliases, ['earlybirds-preview-postgres']);
  assert.equal(resolved.networks.preview_db.internal, true);
  assert.equal(resolved.networks.preview_db.name, 'earlybirds_preview_db_internal');
  assert.notEqual(resolved.networks.listener_egress.internal, true);
  assert.equal(resolved.networks.listener_egress.name, 'earlybirds_preview_listener_egress');

  assert.deepEqual(migration.command, ['npx', 'prisma', 'migrate', 'deploy']);
  assert.equal(migration.profiles, undefined);
  assert.equal(migration.depends_on.postgres.condition, 'service_healthy');
  assert.deepEqual(Object.keys(migration.networks), ['preview_db']);

  assert.equal(listener.build.context, root);
  assert.equal(listener.build.target, 'runner');
  assert.equal(listener.environment.NODE_ENV, 'production');
  assert.equal(listener.environment.BEACON_GIT_SHA, 'synthetic-preview');
  assert.equal(listener.environment.BEACON_BUILD_TIME, 'synthetic-preview');
  assert.equal(listener.environment.BEACON_DATABASE_SCHEMA_VERSION, 'preview-forward-only');
  assert.equal(listener.environment.EARLY_BIRDS_ENABLED, '0');
  assert.equal(listener.environment.EARLY_BIRDS_FREE_FOR_ALL, '0');
  assert.equal(listener.environment.EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED, '0');
  assert.equal(listener.environment.BEACON_LISTENER_REACTIVE_FIELD_LAB_ENABLED, '0');
  assert.equal(listener.environment.LISTENER_WITHDRAWAL_ENABLED, '0');
  assert.equal(listener.environment.LISTENER_WITHDRAWAL_SECRET, '');
  assert.equal(
    listener.environment.EARLY_BIRDS_STAGING_TEAM_ENTRY_HOSTS,
    'earlybirds-staging.harmonicbeacon.com',
  );
  assert.equal(listener.environment.EARLY_BIRDS_STREAM_ORIGIN, 'https://stream.harmonicbeacon.com');
  assert.equal(listener.environment.EARLY_BIRDS_GOOGLE_CLIENT_ID, '');
  assert.equal(listener.environment.EARLY_BIRDS_APPLE_CLIENT_ID, '');
  assert.equal(listener.environment.EARLY_BIRDS_DROPIN_ES_PATH, '');
  assert.equal(listener.environment.BEACON_LISTENER_GEOIP_DB_PATH, '/data/geoip/dbip-country-lite.mmdb');
  assert.equal(listener.volumes.length, 2);
  assert.equal(listener.volumes[0].type, 'bind');
  assert.equal(listener.volumes[0].target, '/media/artifacts');
  assert.equal(listener.volumes[0].read_only, true);
  assert.equal(listener.volumes[1].type, 'bind');
  assert.equal(listener.volumes[1].target, '/data/geoip/dbip-country-lite.mmdb');
  assert.equal(listener.volumes[1].read_only, true);
  assert.equal(listener.depends_on.postgres.condition, 'service_healthy');
  assert.equal(listener.depends_on.migration.condition, 'service_completed_successfully');
  assert.deepEqual(Object.keys(listener.networks).sort(), ['listener_egress', 'preview_db', 'stream_control']);
  assert.equal(listener.environment.EARLY_BIRDS_STREAM_CONTROL_ORIGIN, 'http://beacon-stream:8080');
  const appPort = publishedPort(listener, 3000);
  assert.equal(appPort.host_ip, '127.0.0.1');
  assert.equal(Number(appPort.published), 13000);

  assert.equal(withdrawalOperator.image, 'harmonic-beacon/earlybirds-preview-listener:synthetic');
  assert.equal(withdrawalOperator.restart, 'unless-stopped');
  assert.deepEqual(withdrawalOperator.command, ['tail', '-f', '/dev/null']);
  assert.equal(withdrawalOperator.ports, undefined);
  assert.equal(withdrawalOperator.volumes, undefined);
  assert.deepEqual(Object.keys(withdrawalOperator.networks), ['preview_db']);
  assert.equal(withdrawalOperator.depends_on.postgres.condition, 'service_healthy');
  assert.equal(withdrawalOperator.depends_on.migration.condition, 'service_completed_successfully');
  assert.match(withdrawalOperator.environment.DATABASE_URL, /@earlybirds-preview-postgres:5432/);

  assert.equal(stream.build.context, path.join(root, 'services/beacon-stream'));
  assert.equal(stream.build.dockerfile, 'Dockerfile');
  assert.deepEqual(Object.keys(stream.networks).sort(), ['stream_control', 'stream_edge', 'stream_observability']);
  assert.equal(resolved.networks.stream_control.internal, true);
  assert.equal(resolved.networks.stream_control.name, 'earlybirds_stream_control_internal');
  assert.equal(resolved.networks.stream_observability.internal, true);
  assert.equal(resolved.networks.stream_observability.name, 'earlybirds_stream_observability');
  assert.notEqual(resolved.networks.stream_edge.internal, true);
  assert.equal(resolved.networks.stream_edge.name, 'earlybirds_stream_edge');
  const streamPort = publishedPort(stream, 8080);
  assert.equal(streamPort.host_ip, '127.0.0.1');
  assert.equal(Number(streamPort.published), 18080);

  const authorityEnvFile = path.join(temporary, 'authority-preview.env');
  await fs.writeFile(
    authorityEnvFile,
    syntheticEnv
      .replace('EARLYBIRDS_PREVIEW_AUTHORITY_NETWORK=', 'EARLYBIRDS_PREVIEW_AUTHORITY_NETWORK=earlybirds_authority_private')
      .replace('EARLY_BIRDS_AUTHORITY_BASE_URL=https://authority.example.invalid', 'EARLY_BIRDS_AUTHORITY_BASE_URL=http://pmp-myth-api:8765'),
    { mode: 0o600 },
  );
  const authorityComposeArgs = composeArgs.map((argument) => (
    argument === envFile ? authorityEnvFile : argument
  ));
  authorityComposeArgs.push(
    '-f', path.join(root, 'ops/early-birds-preview/authority-network.override.yml'),
  );
  execFileSync('docker', [...authorityComposeArgs, 'config', '--quiet'], { stdio: 'inherit' });
  const authorityResolved = JSON.parse(execFileSync(
    'docker', [...authorityComposeArgs, 'config', '--format', 'json'], { encoding: 'utf8' },
  ));
  assert.equal(authorityResolved.networks.authority_private.external, true);
  assert.equal(authorityResolved.networks.authority_private.name, 'earlybirds_authority_private');
  assert.deepEqual(Object.keys(authorityResolved.services.listener.networks).sort(), [
    'authority_private', 'listener_egress', 'preview_db', 'stream_control',
  ]);
  assert.deepEqual(
    authorityResolved.services.listener.networks.authority_private.aliases,
    ['earlybirds-listener'],
  );

  if (process.argv.includes('--build')) {
    execFileSync('docker', [...composeArgs, 'build', 'migration', 'listener', 'beacon-stream'], {
      stdio: 'inherit',
    });
    console.log('EarlyBirds preview images built successfully.');
  }
  console.log('EarlyBirds preview compose configuration is valid.');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
