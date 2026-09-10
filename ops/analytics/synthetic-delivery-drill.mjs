#!/usr/bin/env node
import { lstat, open, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const allowed = new Set(['--state-root', '--source', '--digest', '--previous-source', '--previous-digest', '--interrupt', '--hold-ms']);
const values = new Map();
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index += 2) {
  const key = args[index];
  const value = args[index + 1];
  if (!allowed.has(key) || value === undefined || values.has(key)) {
    process.stderr.write('invalid synthetic drill arguments\n');
    process.exit(2);
  }
  values.set(key, value);
}

function required(key, pattern) {
  const value = values.get(key);
  if (!pattern.test(value ?? '')) {
    process.stderr.write(`invalid ${key}\n`);
    process.exit(2);
  }
  return value;
}

const stateRootInput = values.get('--state-root');
if (!stateRootInput) {
  process.stderr.write('synthetic state root is required\n');
  process.exit(2);
}
const stateRoot = resolve(stateRootInput);
const stateInfo = await lstat(stateRoot).catch(() => null);
const canonicalRoot = stateInfo ? await realpath(stateRoot) : null;
const canonicalTmp = await realpath(tmpdir());
if (!stateInfo?.isDirectory() || stateInfo.isSymbolicLink() || canonicalRoot !== stateRoot ||
    dirname(stateRoot) !== canonicalTmp || !basename(stateRoot).startsWith('analytics-synthetic-')) {
  process.stderr.write('state root must be a direct, non-symlink analytics-synthetic directory under the system temporary directory\n');
  process.exit(2);
}

const sourceSha = required('--source', SHA40);
const digest = required('--digest', SHA256);
const previousSource = required('--previous-source', SHA40);
const previousDigest = required('--previous-digest', SHA256);
const interruption = values.get('--interrupt') ?? 'none';
if (!['none', 'after-activate'].includes(interruption)) {
  process.stderr.write('unsupported interruption point\n');
  process.exit(2);
}
const holdMsText = values.get('--hold-ms') ?? '0';
if (!/^[0-9]{1,4}$/.test(holdMsText) || Number(holdMsText) > 2000) {
  process.stderr.write('invalid bounded hold\n');
  process.exit(2);
}

const composePath = fileURLToPath(new URL('./compose.synthetic.yml', import.meta.url));
const compose = await readFile(composePath, 'utf8');
if (!compose.includes('name: harmonic-beacon-analytics-synthetic') ||
    !compose.includes('POSTGRES_DB: analytics_synthetic') ||
    /external:\s*true|\/mnt\/beacon-data|container_name:/.test(compose)) {
  process.stderr.write('synthetic Compose isolation contract failed\n');
  process.exit(2);
}

const lockPath = join(stateRoot, '.delivery.lock');
let lock;
try {
  lock = await open(lockPath, 'wx', 0o600);
} catch (error) {
  if (error.code === 'EEXIST') {
    process.stderr.write('another synthetic delivery is active\n');
    process.exit(73);
  }
  throw error;
}

const attemptPath = join(stateRoot, 'attempt.json');
const currentPath = join(stateRoot, 'current.json');
const resultPath = join(stateRoot, 'result.json');
const previous = { sourceSha: previousSource, digest: previousDigest };
const candidate = { sourceSha, digest };

try {
  await writeFile(attemptPath, `${JSON.stringify({ profile: 'analytics-synthetic', previous, candidate })}\n`, { mode: 0o600 });
  if (Number(holdMsText) > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, Number(holdMsText)));
  await writeFile(currentPath, `${JSON.stringify(candidate)}\n`, { mode: 0o600 });
  if (interruption === 'after-activate') throw new Error('deterministic interruption after activate');
  await writeFile(resultPath, `${JSON.stringify({
    profile: 'analytics-synthetic', current: candidate,
    rollback: { required: false, performed: false, status: 'not-required', previousDigest },
    cleanupComplete: true,
  })}\n`, { mode: 0o600 });
} catch (error) {
  await writeFile(currentPath, `${JSON.stringify(previous)}\n`, { mode: 0o600 });
  await writeFile(resultPath, `${JSON.stringify({
    profile: 'analytics-synthetic', current: previous,
    rollback: { required: true, performed: true, status: 'passed', previousDigest },
    cleanupComplete: true,
  })}\n`, { mode: 0o600 });
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 75;
} finally {
  await rm(attemptPath, { force: true });
  await lock.close();
  await rm(lockPath, { force: true });
}
