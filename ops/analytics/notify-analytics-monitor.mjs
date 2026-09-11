#!/usr/bin/env node
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DEFAULT_URL = 'http://127.0.0.1:9093/api/v2/alerts';
const DEFAULT_STATE_DIR = '/var/lib/harmonic-beacon/analytics-monitor-notification';
const labels = {
  alertname: 'HarmonicBeaconAnalyticsMonitorFailed',
  service: 'analytics',
  severity: 'warning',
};

function stateDirectory() {
  const override = process.env.HB_ANALYTICS_NOTIFY_STATE_DIR;
  if (override && typeof process.getuid === 'function' && process.getuid() !== 0) return override;
  return DEFAULT_STATE_DIR;
}

function alertmanagerUrl() {
  const override = process.env.HB_ANALYTICS_ALERTMANAGER_URL;
  if (override && typeof process.getuid === 'function' && process.getuid() !== 0) return override;
  return DEFAULT_URL;
}

function payload(event, state = {}, now = new Date()) {
  const startsAt = state.startsAt ?? now.toISOString();
  const alert = {
    labels,
    annotations: {
      summary: event === 'failure'
        ? 'Analytics monitor failed; product traffic remains independent'
        : 'Analytics monitor recovered; product traffic remained independent',
    },
    startsAt,
  };
  if (event === 'recovery') alert.endsAt = state.endsAt ?? now.toISOString();
  return [alert];
}

function secureStateDir(path) {
  mkdirSync(path, { recursive: true, mode: 0o700 });
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o700) throw new Error('notification state directory is unsafe');
  if (typeof process.getuid === 'function' && process.getuid() === 0 && info.uid !== 0) throw new Error('notification state directory is not root-owned');
}

function syncDirectory(path) {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function atomicState(path, value) {
  const temporary = `${path}.new-${process.pid}`;
  const fd = openSync(temporary, 'wx', 0o600);
  try {
    writeFileSync(fd, `${JSON.stringify(value)}\n`);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  renameSync(temporary, path);
  syncDirectory(dirname(path));
}

function readState(path) {
  try {
    const info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || (info.mode & 0o777) !== 0o600) throw new Error('notification state file is unsafe');
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!value || !['failure-pending', 'failure-sent', 'recovery-pending', 'healthy'].includes(value.phase)) throw new Error('notification state is malformed');
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function post(event, state) {
  const response = await fetch(alertmanagerUrl(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload(event, state)),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Alertmanager rejected analytics ${event} (${response.status})`);
}

function failpoint(name) {
  if (typeof process.getuid === 'function' && process.getuid() !== 0 && process.env.HB_ANALYTICS_NOTIFY_FAILPOINT === name) {
    throw new Error(`injected notification interruption at ${name}`);
  }
}

async function reconcile(event, directory) {
  const path = join(directory, 'notification.json');
  let state = readState(path);
  if (event === 'failure') {
    if (!state || state.phase === 'healthy') {
      state = { schemaVersion: 'hb.analytics.notification-state.v1', phase: 'failure-pending', startsAt: new Date().toISOString(), route: 'alertmanager', recipientDelivery: 'unproven' };
      atomicState(path, state);
    }
    if (state.phase === 'recovery-pending') throw new Error('recovery is already pending; refusing contradictory failure');
    await post('failure', state);
    failpoint('after-post');
    atomicState(path, { ...state, phase: 'failure-sent' });
    return;
  }

  if (!state || state.phase === 'healthy') return;
  if (state.phase === 'failure-pending') {
    await post('failure', state);
    atomicState(path, { ...state, phase: 'failure-sent' });
    state = readState(path);
  }
  if (state.phase === 'failure-sent') {
    state = { ...state, phase: 'recovery-pending', endsAt: new Date().toISOString() };
    atomicState(path, state);
  }
  await post('recovery', state);
  failpoint('after-recovery-post');
  atomicState(path, {
    schemaVersion: 'hb.analytics.notification-state.v1', phase: 'healthy',
    startsAt: state.startsAt, endsAt: state.endsAt, route: 'alertmanager', recipientDelivery: 'unproven',
  });
}

const args = process.argv.slice(2);
const render = args[0] === '--render';
const locked = args[0] === '--locked';
const event = render || locked ? args[1] : args[0];
const extra = render || locked ? args[2] : args[1];
if (extra || !['failure', 'recovery'].includes(event)) {
  process.stderr.write('usage: notify-analytics-monitor.mjs [--render] {failure|recovery}\n');
  process.exit(2);
}

if (render) {
  process.stdout.write(`${JSON.stringify(payload(event))}\n`);
} else {
  const directory = stateDirectory();
  secureStateDir(directory);
  if (!locked) {
    const result = spawnSync('/usr/bin/flock', ['-x', join(directory, 'notification.lock'), process.execPath, fileURLToPath(import.meta.url), '--locked', event], {
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' }, encoding: 'utf8',
    });
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    process.exit(result.status ?? 1);
  }
  await reconcile(event, directory);
}
