import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (name) => fs.readFile(path.join(root, name), 'utf8');

const runGuard = (envFile) => spawnSync('sh', ['-c', '. "$1"; require_synthetic_env "$2"', 'sh',
  path.resolve(root, '../../scripts/early-birds-preview/lib.sh'), envFile], { encoding: 'utf8' });

test('synthetic env guard accepts comments and rejects effective dangerous assignments', async () => {
  const source = await read('preview.env.synthetic.example');
  assert.match(source, /^EARLYBIRDS_PREVIEW_ENV=synthetic$/m);
  const example = path.join(root, 'preview.env.synthetic.example');
  assert.equal(runGuard(example).status, 0);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'earlybirds-preview-guard-'));
  const dangerous = path.join(temporary, 'dangerous.env');
  await fs.writeFile(dangerous, `${source}\nBEACON_STREAM_PUBLIC_ORIGIN=https://harmonicbeacon.com\n`);
  const result = runGuard(dangerous);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /production\/provider value/);
  await fs.rm(temporary, { recursive: true, force: true });
});

test('preview compose has an isolated database and an on-demand migration rehearsal', async () => {
  const source = await read('compose.yml');
  assert.match(source, /postgres:/);
  assert.match(source, /earlybirds-preview-postgres/);
  assert.match(source, /migration-rehearsal:/);
  assert.match(source, /profiles: \[migration\]/);
  assert.match(source, /prisma", "migrate", "deploy/);
  assert.doesNotMatch(source, /livekit|playlist-bot|tapestry/i);
});

test('stream build overlay pins the service directory after compose merge', async () => {
  const source = await read('stream-build.override.yml');
  assert.match(source, /context: \.\.\/\.\.\/services\/beacon-stream/);
  assert.match(source, /dockerfile: Dockerfile/);
});
