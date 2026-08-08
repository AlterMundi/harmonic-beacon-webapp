import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const previewRoot = path.resolve(import.meta.dirname, '..');
const repositoryRoot = path.resolve(previewRoot, '../..');
const script = path.join(repositoryRoot, 'scripts/early-birds-preview/disable-public.sh');
const example = path.join(previewRoot, 'preview.env.synthetic.example');

async function executable(pathname, content) {
  await fs.writeFile(pathname, content, { mode: 0o700 });
  await fs.chmod(pathname, 0o700);
}

async function fixture(t, { denialStatus = '503', healthFailures = 0 } = {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'listener-disable-public-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const envFile = path.join(directory, 'preview.env');
  const source = (await fs.readFile(example, 'utf8'))
    .replace('EARLY_BIRDS_ENABLED=0', 'EARLY_BIRDS_ENABLED=1')
    .replace('EARLY_BIRDS_FREE_FOR_ALL=0', 'EARLY_BIRDS_FREE_FOR_ALL=1')
    .replace(
      'EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=0',
      'EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=1',
    );
  await fs.writeFile(envFile, source, { mode: 0o600 });
  await fs.chmod(envFile, 0o600);

  const bin = path.join(directory, 'bin');
  await fs.mkdir(bin);
  const commandLog = path.join(directory, 'commands.log');
  await executable(path.join(bin, 'id'), '#!/bin/sh\necho 0\n');
  await executable(path.join(bin, 'docker'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$TEST_COMMAND_LOG"',
    'case "$*" in',
    '  "ps -q --filter label=com.docker.compose.project=earlybirds-preview --filter label=com.docker.compose.service=listener") printf "isolated-listener-id\\n" ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  await executable(path.join(bin, 'curl'), [
    '#!/bin/sh',
    'printf "%s\\n" "$*" >> "$TEST_COMMAND_LOG"',
    'case "$*" in',
    `  *api/early-birds/stream/lease*) printf '${denialStatus}' ;;`,
    '  *api/health*)',
    '    attempts=$(grep -c "api/health" "$TEST_COMMAND_LOG" || true)',
    '    test "$attempts" -le "$TEST_HEALTH_FAILURES" && exit 56',
    '    ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n'));
  return { directory, envFile, bin, commandLog, source, healthFailures };
}

function run(mode, current) {
  return spawnSync('sh', [script, mode, current.envFile], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${current.bin}:${process.env.PATH}`,
      TEST_COMMAND_LOG: current.commandLog,
      TEST_HEALTH_FAILURES: String(current.healthFailures),
    },
  });
}

test('explicit dry-run is non-mutating and invokes no runtime command', async (t) => {
  const current = await fixture(t);
  const before = await fs.readFile(current.envFile, 'utf8');
  const result = run('--dry-run', current);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /DRY RUN/);
  assert.equal(await fs.readFile(current.envFile, 'utf8'), before);
  await assert.rejects(fs.access(current.commandLog));
  const files = await fs.readdir(current.directory);
  assert.equal(files.some((name) => name.includes('pre-disable-public')), false);
});

test('dry-run refuses a concurrent public-mode operation', async (t) => {
  const current = await fixture(t);
  const lockFile = `${current.envFile}.listener-public.lock`;
  const holder = spawn('flock', [
    lockFile,
    'sh', '-c', 'echo locked; read line',
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  await once(holder.stdout, 'data');
  try {
    const result = run('--dry-run', current);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /holds the lock/);
  } finally {
    holder.stdin.end();
    await once(holder, 'close');
  }
});

test('dry-run refuses duplicate public switch assignments', async (t) => {
  const current = await fixture(t);
  await fs.appendFile(current.envFile, '\nEARLY_BIRDS_ENABLED=0\n');
  const result = run('--dry-run', current);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /EARLY_BIRDS_ENABLED must appear exactly once/);
});

test('apply backs up mode 0600, disables every public flag and recreates only Listener', async (t) => {
  const current = await fixture(t);
  const result = run('--apply', current);
  assert.equal(result.status, 0, result.stderr);
  const updated = await fs.readFile(current.envFile, 'utf8');
  assert.match(updated, /^EARLY_BIRDS_ENABLED=0$/m);
  assert.match(updated, /^EARLY_BIRDS_FREE_FOR_ALL=0$/m);
  assert.match(updated, /^EARLY_BIRDS_STAGING_TEAM_ENTRY_ENABLED=0$/m);
  assert.equal((await fs.stat(current.envFile)).mode & 0o777, 0o600);

  const backupName = (await fs.readdir(current.directory))
    .find((name) => name.includes('pre-disable-public'));
  assert.ok(backupName);
  const backup = path.join(current.directory, backupName);
  assert.equal((await fs.stat(backup)).mode & 0o777, 0o600);
  assert.equal(await fs.readFile(backup, 'utf8'), current.source);

  const commands = await fs.readFile(current.commandLog, 'utf8');
  const dockerCommands = commands.split('\n').filter((line) => line.startsWith('compose '));
  assert.equal(dockerCommands.length, 1);
  assert.match(dockerCommands[0], / up -d --no-deps --force-recreate --no-build listener$/);
  assert.match(commands, /api\/health\b/);
  assert.match(commands, /api\/health\/ready/);
  assert.match(commands, /api\/early-birds\/stream\/lease/);
  assert.match(result.stdout, /denied with 503/);
});

test('failed denial smoke leaves flags disabled and stops only Listener', async (t) => {
  const current = await fixture(t, { denialStatus: '401' });
  const result = run('--apply', current);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /stopping only Listener/);
  const updated = await fs.readFile(current.envFile, 'utf8');
  assert.match(updated, /^EARLY_BIRDS_ENABLED=0$/m);
  const commands = await fs.readFile(current.commandLog, 'utf8');
  assert.match(commands, /ps -q --filter label=com\.docker\.compose\.project=earlybirds-preview --filter label=com\.docker\.compose\.service=listener/);
  assert.match(commands, /stop isolated-listener-id/);
  assert.doesNotMatch(commands, /stop (?:.* )?(postgres|beacon-stream|livekit|playlist-bot)/);
});

test('apply tolerates a healthy Listener that needs several startup probes', async (t) => {
  const current = await fixture(t, { healthFailures: 2 });
  const result = run('--apply', current);
  assert.equal(result.status, 0, result.stderr);
  const commands = await fs.readFile(current.commandLog, 'utf8');
  const healthAttempts = commands.split('\n').filter((line) => /api\/health$/.test(line));
  assert.equal(healthAttempts.length, 3);
  assert.match(result.stdout, /denied with 503/);
});
