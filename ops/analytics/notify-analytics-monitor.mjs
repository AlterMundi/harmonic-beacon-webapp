#!/usr/bin/env node
import { rm, writeFile, readFile } from 'node:fs/promises';

const ALERTMANAGER_URL = 'http://127.0.0.1:9093/api/v2/alerts';
const STATE_FILE = '/run/hb-analytics-monitor.failed';
const labels = {
  alertname: 'HarmonicBeaconAnalyticsMonitorFailed',
  service: 'analytics',
  severity: 'warning',
};

function payload(event, now = new Date()) {
  const alert = {
    labels,
    annotations: {
      summary: event === 'failure'
        ? 'Analytics monitor failed; product traffic remains independent'
        : 'Analytics monitor recovered; product traffic remained independent',
    },
    startsAt: now.toISOString(),
  };
  if (event === 'recovery') alert.endsAt = now.toISOString();
  return [alert];
}

async function post(event) {
  const response = await fetch(ALERTMANAGER_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload(event)),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Alertmanager rejected analytics ${event} (${response.status})`);
}

const args = process.argv.slice(2);
const mode = args[0] === '--render' ? '--render' : '--send';
const event = mode === '--render' ? args[1] : args[0];
const extra = mode === '--render' ? args[2] : args[1];
if (extra || !['failure', 'recovery'].includes(event)) {
  process.stderr.write('usage: notify-analytics-monitor.mjs [--render] {failure|recovery}\n');
  process.exit(2);
}

if (mode === '--render') {
  process.stdout.write(`${JSON.stringify(payload(event))}\n`);
} else if (event === 'failure') {
  await post('failure');
  await writeFile(STATE_FILE, 'failed\n', { mode: 0o600 });
} else {
  let state = null;
  try { state = await readFile(STATE_FILE, 'utf8'); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (state === 'failed\n') {
    await post('recovery');
    await rm(STATE_FILE, { force: true });
  }
}
