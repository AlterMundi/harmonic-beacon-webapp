import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'earlybirds-preview-'));
const envFile = path.join(temporary, 'preview.env');
await fs.writeFile(envFile, [
  'EARLYBIRDS_PREVIEW_ENV=synthetic',
  'EARLYBIRDS_PREVIEW_DB_USER=earlybirds_preview',
  'EARLYBIRDS_PREVIEW_DB_PASSWORD=synthetic-local-only-not-a-secret',
  'EARLYBIRDS_PREVIEW_DB_NAME=earlybirds_preview',
  'BEACON_STREAM_ARTIFACTS_HOST_PATH=.',
  'BEACON_STREAM_MEDIA_ROOT=/media/artifacts',
  'BEACON_STREAM_ARTIFACT_ID=synthetic-preview-artifact',
  'BEACON_STREAM_PUBLIC_ORIGIN=http://earlybirds-staging.localhost',
  'BEACON_STREAM_SIGNING_SECRET=synthetic-local-only-32-character-minimum-secret',
  '',
].join('\n'), { mode: 0o600 });
try {
  const composeArgs = ['compose', '--project-name', 'earlybirds-preview-validation', '--env-file', envFile,
    '-f', path.join(root, 'ops/early-birds-preview/compose.yml'),
    '-f', path.join(root, 'services/beacon-stream/docker-compose.yml'),
    '-f', path.join(root, 'ops/early-birds-preview/stream-build.override.yml')];
  execFileSync('docker', [...composeArgs, 'config', '--quiet'], { stdio: 'inherit' });
  const resolved = JSON.parse(execFileSync('docker', [...composeArgs, 'config', '--format', 'json'], { encoding: 'utf8' }));
  const build = resolved.services?.['beacon-stream']?.build;
  assert.equal(build?.context, path.join(root, 'services/beacon-stream'));
  assert.equal(build?.dockerfile, 'Dockerfile');
  console.log('EarlyBirds preview compose configuration is valid.');
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
