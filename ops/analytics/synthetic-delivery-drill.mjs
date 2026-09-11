#!/usr/bin/env node
import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const REPOSITORY = 'ghcr.io/altermundi/harmonic-beacon-analytics';
const FIXED_SYNTHETIC_COMPOSE = '/usr/local/libexec/harmonic-beacon/analytics/compose.synthetic.yml';
const scriptPath = fileURLToPath(import.meta.url);
const flagKeys = new Set(['--worker']);
const valueKeys = new Set(['--state-root', '--source', '--digest', '--image-id', '--config', '--previous-source', '--previous-digest', '--previous-image-id', '--previous-config', '--compose']);

function parse(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length;) {
    const key = argv[index++];
    if (flagKeys.has(key)) {
      if (values.has(key)) throw new Error('duplicate synthetic drill flag');
      values.set(key, true);
      continue;
    }
    const value = argv[index++];
    if (!valueKeys.has(key) || value === undefined || values.has(key)) throw new Error('invalid synthetic drill arguments');
    values.set(key, value);
  }
  return values;
}

function required(values, key, pattern) {
  const value = values.get(key);
  if (!pattern.test(value ?? '')) throw new Error(`invalid ${key}`);
  return value;
}

function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function atomicJson(path, value) {
  const temporary = `${path}.new-${process.pid}`;
  const fd = openSync(temporary, 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(temporary, path);
  syncDirectory(dirname(path));
}

function readJson(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600) throw new Error('unsafe synthetic state');
  return JSON.parse(readFileSync(path, 'utf8'));
}

function validateStateRoot(input) {
  const stateRoot = resolve(input ?? '');
  const info = lstatSync(stateRoot);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o022) !== 0) throw new Error('unsafe synthetic state root');
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    if (!stateRoot.startsWith('/var/lib/harmonic-beacon/analytics-delivery/synthetic-drills/') || info.uid !== 0) throw new Error('root synthetic state root is outside the fixed state tree');
  } else {
    const temp = resolve(tmpdir());
    if (dirname(stateRoot) !== temp || !basename(stateRoot).startsWith('analytics-synthetic-')) throw new Error('test synthetic state root must be direct under the system temporary directory');
  }
  return stateRoot;
}

function composeEnvironment(state) {
  const selected = state.selected;
  return {
    ...process.env,
    ANALYTICS_IMAGE_REF: `${REPOSITORY}@${selected.digest}`,
    ANALYTICS_SYNTHETIC_DATABASE_PASSWORD: 'analytics-synthetic-password-not-production',
    ANALYTICS_SYNTHETIC_HANDOFF_SECRET: 'analytics-synthetic-handoff-not-production',
    ANALYTICS_SYNTHETIC_SERVER_SECRET: 'analytics-synthetic-server-not-production',
    ANALYTICS_SYNTHETIC_NONPRODUCTION_SECRET: 'analytics-synthetic-nonproduction-only',
    ANALYTICS_SYNTHETIC_NETWORK_SECRET: 'analytics-synthetic-network-not-production',
    ANALYTICS_SYNTHETIC_SOURCE_SHA: selected.sourceSha,
    ANALYTICS_SYNTHETIC_IMAGE_ID: selected.imageId,
    ANALYTICS_SYNTHETIC_IMAGE_DIGEST: selected.digest,
    ANALYTICS_SYNTHETIC_CONFIG_SHA256: selected.configSha256,
  };
}

function runDocker(stateRoot, state, ...args) {
  const project = `analytics-synthetic-drill-${basename(stateRoot).replace(/[^a-z0-9-]/g, '').slice(-30)}`;
  // The live drill always drives /usr/bin/docker compose against the fixed isolated bundle.
  const result = spawnSync('/usr/bin/docker', ['compose', '--file', state.compose, '--project-name', project, '--profile', 'synthetic-drill', ...args], {
    env: composeEnvironment(state), encoding: 'utf8', timeout: 120000,
  });
  if (result.error || result.status !== 0) throw new Error(`synthetic docker compose failed: ${result.stderr || result.error?.message}`);
  return result.stdout.trim();
}

function fileDriver(stateRoot, state, operation) {
  if (typeof process.getuid === 'function' && process.getuid() === 0) throw new Error('file driver is forbidden for root');
  const service = join(stateRoot, 'service.json');
  if (operation === 'cleanup') {
    rmSync(service, { force: true });
    return { cleanupObserved: !readFileOptional(service) };
  }
  atomicJson(service, state.selected);
  return { ...readJson(service), status: 'ready' };
}

function readFileOptional(path) {
  try { return readFileSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

function drive(stateRoot, state, operation) {
  if (process.env.HB_ANALYTICS_DRILL_DRIVER === 'file') return fileDriver(stateRoot, state, operation);
  if (operation === 'cleanup') {
    runDocker(stateRoot, state, 'down', '--volumes', '--remove-orphans');
    const remaining = runDocker(stateRoot, state, 'ps', '-aq');
    return { cleanupObserved: remaining === '' };
  }
  runDocker(stateRoot, state, 'up', '-d', '--no-build', '--pull', 'never', '--force-recreate', 'postgres-synthetic', 'collector-synthetic');
  const collector = runDocker(stateRoot, state, 'ps', '-q', 'collector-synthetic');
  if (!/^[0-9a-f]{12,64}$/.test(collector)) throw new Error('synthetic collector was not observed');
  let inspected;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    inspected = spawnSync('/usr/bin/docker', ['inspect', collector, '--format', '{{.State.Status}}:{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.Image}}'], { encoding: 'utf8' });
    if (inspected.status === 0 && inspected.stdout.trim() === `running:healthy|${state.selected.imageId}`) break;
    spawnSync('/usr/bin/sleep', ['1']);
  }
  if (inspected?.status !== 0 || inspected.stdout.trim() !== `running:healthy|${state.selected.imageId}`) throw new Error('synthetic collector did not become healthy on the exact image ID');
  return { ...state.selected, status: 'ready', observedContainer: collector };
}

function identity(values) {
  const digest = required(values, '--digest', SHA256);
  const previousDigest = required(values, '--previous-digest', SHA256);
  const compose = resolve(values.get('--compose') ?? (process.getuid?.() === 0
    ? FIXED_SYNTHETIC_COMPOSE
    : fileURLToPath(new URL('./compose.synthetic.yml', import.meta.url))));
  if (process.getuid?.() === 0 && compose !== FIXED_SYNTHETIC_COMPOSE) throw new Error('root synthetic Compose path is not the installed bundle');
  return {
    schemaVersion: 'hb.analytics.synthetic-drill-state.v2',
    candidate: {
      sourceSha: required(values, '--source', SHA40), digest,
      imageId: values.get('--image-id') ?? digest, configSha256: values.get('--config') ?? `sha256:${'c'.repeat(64)}`,
    },
    previous: {
      sourceSha: required(values, '--previous-source', SHA40), digest: previousDigest,
      imageId: values.get('--previous-image-id') ?? previousDigest,
      configSha256: values.get('--previous-config') ?? `sha256:${'d'.repeat(64)}`,
    },
    compose,
  };
}

function validateCompose(path) {
  const compose = readFileSync(path, 'utf8');
  if (!compose.includes('analytics_synthetic') || !compose.includes('internal: true') || /external:\s*true|\/mnt\/beacon-data|container_name:|analytics_owner/.test(compose)) {
    throw new Error('synthetic Compose isolation contract failed');
  }
}

async function worker(values, stateRoot) {
  const journalPath = join(stateRoot, 'attempt.json');
  let journal = readFileOptional(journalPath) ? readJson(journalPath) : null;
  const requested = identity(values);
  validateCompose(requested.compose);
  if (!journal) {
    journal = { ...requested, phase: 'prepared', generation: 1 };
    atomicJson(journalPath, journal);
    const baseline = drive(stateRoot, { ...journal, selected: journal.previous }, 'activate');
    atomicJson(join(stateRoot, 'current.json'), baseline);
    journal = { ...journal, phase: 'baseline-observed', generation: 2 };
    atomicJson(journalPath, journal);
  } else if (JSON.stringify({ ...journal, phase: undefined, generation: undefined }) !== JSON.stringify({ ...requested, phase: undefined, generation: undefined })) {
    throw new Error('synthetic drill replay identity conflict');
  }

  if (journal.phase === 'baseline-observed') {
    const activated = drive(stateRoot, { ...journal, selected: journal.candidate }, 'activate');
    atomicJson(join(stateRoot, 'current.json'), activated);
    journal = { ...journal, phase: 'candidate-observed', generation: 3 };
    atomicJson(journalPath, journal);
    atomicJson(join(stateRoot, 'activation-observed.json'), { phase: journal.phase, sourceSha: activated.sourceSha, digest: activated.digest });
    await new Promise(() => {
      setInterval(() => {}, 60000);
    });
  }

  if (journal.phase === 'candidate-observed') {
    journal = { ...journal, phase: 'compensation-intent', generation: 4 };
    atomicJson(journalPath, journal);
    const restored = drive(stateRoot, { ...journal, selected: journal.previous }, 'activate');
    atomicJson(join(stateRoot, 'current.json'), restored);
    journal = { ...journal, phase: 'previous-observed', generation: 5 };
    atomicJson(journalPath, journal);
  }
  if (journal.phase === 'compensation-intent') {
    const restored = drive(stateRoot, { ...journal, selected: journal.previous }, 'activate');
    atomicJson(join(stateRoot, 'current.json'), restored);
    journal = { ...journal, phase: 'previous-observed', generation: 5 };
    atomicJson(journalPath, journal);
  }
  if (journal.phase === 'previous-observed') {
    const cleanup = drive(stateRoot, { ...journal, selected: journal.previous }, 'cleanup');
    if (cleanup.cleanupObserved !== true) throw new Error('synthetic cleanup was not observed');
    const result = {
      schemaVersion: 'hb.analytics.synthetic-drill-result.v2', profile: 'analytics-synthetic',
      interruption: { signal: 'SIGKILL', candidateObserved: true }, current: journal.previous,
      rollback: { required: true, performed: true, status: 'passed', previousDigest: journal.previous.digest },
      cleanupObserved: true,
    };
    atomicJson(join(stateRoot, 'result.json'), result);
    atomicJson(journalPath, { ...journal, phase: 'committed', generation: 6 });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  if (journal.phase === 'committed') process.stdout.write(readFileSync(join(stateRoot, 'result.json'), 'utf8'));
}

async function waitFor(path, milliseconds) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    if (readFileOptional(path)) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error('synthetic candidate activation was not observed before timeout');
}

async function orchestrate(values, stateRoot) {
  const forwarded = process.argv.slice(2).filter((value) => value !== '--worker');
  const lockPath = join(stateRoot, 'delivery.lock');
  const child = spawn('/usr/bin/flock', ['--no-fork', '-x', lockPath, process.execPath, scriptPath, '--worker', ...forwarded], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  const childExit = new Promise((resolveExit) => child.once('exit', resolveExit));
  let childError = '';
  child.stderr.on('data', (chunk) => { childError += chunk; });
  await waitFor(join(stateRoot, 'activation-observed.json'), 120000);
  child.kill('SIGKILL');
  await childExit;
  const resumed = spawnSync('/usr/bin/flock', ['-x', lockPath, process.execPath, scriptPath, '--worker', ...forwarded], { env: process.env, encoding: 'utf8', timeout: 180000 });
  if (resumed.error || resumed.status !== 0) throw new Error(`synthetic resume failed: ${resumed.stderr || resumed.error?.message || childError}`);
  const result = readJson(join(stateRoot, 'result.json'));
  if (result.interruption?.signal !== 'SIGKILL' || result.cleanupObserved !== true || result.rollback?.status !== 'passed') throw new Error('synthetic recovery observations are incomplete');
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

try {
  const values = parse(process.argv.slice(2));
  const stateRoot = validateStateRoot(values.get('--state-root'));
  const requested = identity(values);
  for (const field of [requested.candidate.imageId, requested.candidate.configSha256, requested.previous.imageId, requested.previous.configSha256]) required(new Map([['value', field]]), 'value', SHA256);
  if (values.has('--worker')) await worker(values, stateRoot);
  else await orchestrate(values, stateRoot);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : 'synthetic drill failed'}\n`);
  process.exit(1);
}
