#!/usr/bin/env node

import { setTimeout as delay } from 'node:timers/promises';

import { assertExternalHost, writePrivateJsonAtomic } from './src/smoke-safety.mjs';
import { createContainerBaseline, loopbackTunnelOrigin, probeMonitor } from './src/target-probe.mjs';

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

async function main() {
  const args = process.argv.slice(2);
  const known = new Set([
    '--prometheus-url', '--alertmanager-url', '--status-file', '--interval-ms', '--once',
  ]);
  for (const argument of args.filter((value) => value.startsWith('--'))) {
    if (!known.has(argument)) throw new Error(`unknown option ${argument}`);
  }
  const statusPath = option(args, '--status-file');
  const prometheus = loopbackTunnelOrigin(
    option(args, '--prometheus-url', 'http://127.0.0.1:19090'),
    'Prometheus',
  );
  const alertmanager = loopbackTunnelOrigin(
    option(args, '--alertmanager-url', 'http://127.0.0.1:19093'),
    'Alertmanager',
  );
  const intervalMs = Number(option(args, '--interval-ms', '5000'));
  if (!statusPath) throw new Error('--status-file is required');
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 2_000 || intervalMs > 10_000) {
    throw new Error('--interval-ms must be between 2000 and 10000');
  }
  const hostHash = assertExternalHost();
  const baseline = createContainerBaseline();
  let stopping = false;
  process.once('SIGINT', () => { stopping = true; });
  process.once('SIGTERM', () => { stopping = true; });
  // A passing status requires an established restart/OOM baseline verified by
  // a later matching sample, so --once deliberately probes twice.
  const minimumProbes = args.includes('--once') ? 2 : 1;
  let probes = 0;
  do {
    const status = await probeMonitor({
      prometheusOrigin: prometheus,
      alertmanagerOrigin: alertmanager,
      hostHash,
      baseline,
    });
    await writePrivateJsonAtomic(statusPath, status);
    process.stdout.write(`External target monitor: ${status.status}\n`);
    probes += 1;
    if (args.includes('--once') && probes >= minimumProbes) break;
    await delay(intervalMs, undefined, { ref: true });
  } while (!stopping);
}

main().catch((error) => {
  process.stderr.write(`External target monitor refused: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
