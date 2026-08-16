#!/usr/bin/env node

import { setTimeout as delay } from 'node:timers/promises';

import { decodeManifest, parseManifest } from '../../ops/early-birds/canary/canary-exporter.mjs';
import { assertAllowedUrl } from './src/contracts.mjs';
import {
  EXTERNAL_CANARY_KIND,
  EXTERNAL_CANARY_ROLE,
  SIGNED_MANIFEST_MAX_BYTES,
  SMOKE_ORIGIN,
  SMOKE_TARGET_ID,
  assertExternalHost,
  readPrivateFile,
  writePrivateJsonAtomic,
} from './src/smoke-safety.mjs';

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

async function probe(manifestPath, hostHash) {
  const now = new Date();
  const base = {
    schemaVersion: 1,
    kind: EXTERNAL_CANARY_KIND,
    role: EXTERNAL_CANARY_ROLE,
    status: 'FAIL',
    external: true,
    targetId: SMOKE_TARGET_ID,
    targetOrigin: SMOKE_ORIGIN,
    hostHash,
    observedAt: now.toISOString(),
    decodedAudio: false,
    decodedSeconds: 0,
    manifestAgeSeconds: null,
  };
  try {
    const { text } = await readPrivateFile(manifestPath, 'signed manifest', SIGNED_MANIFEST_MAX_BYTES);
    const manifestUrl = text.trim();
    assertAllowedUrl(manifestUrl, [SMOKE_ORIGIN]);
    const response = await fetch(manifestUrl, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error('manifest unavailable');
    if (response.headers.get('x-harmonic-beacon-environment') !== 'early-birds-staging') {
      throw new Error('staging attestation missing');
    }
    const manifest = await response.text();
    const { manifestAgeSeconds } = parseManifest(manifest);
    await decodeManifest(manifest);
    return {
      ...base,
      status: manifestAgeSeconds <= 18 ? 'PASS' : 'FAIL',
      observedAt: new Date().toISOString(),
      decodedAudio: true,
      decodedSeconds: 6,
      manifestAgeSeconds,
    };
  } catch {
    return { ...base, observedAt: new Date().toISOString() };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const known = new Set(['--manifest-url-file', '--status-file', '--interval-ms', '--once']);
  for (const argument of args.filter((value) => value.startsWith('--'))) {
    if (!known.has(argument)) throw new Error(`unknown option ${argument}`);
  }
  const manifestPath = option(args, '--manifest-url-file');
  const statusPath = option(args, '--status-file');
  const intervalMs = Number(option(args, '--interval-ms', '30000'));
  if (!manifestPath || !statusPath) throw new Error('--manifest-url-file and --status-file are required');
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 5_000 || intervalMs > 30_000) {
    throw new Error('--interval-ms must be between 5000 and 30000');
  }
  const hostHash = assertExternalHost();
  let stopping = false;
  process.once('SIGINT', () => { stopping = true; });
  process.once('SIGTERM', () => { stopping = true; });
  do {
    const status = await probe(manifestPath, hostHash);
    await writePrivateJsonAtomic(statusPath, status);
    process.stdout.write(`External decoded canary: ${status.status}\n`);
    if (args.includes('--once')) break;
    await delay(intervalMs, undefined, { ref: true });
  } while (!stopping);
}

main().catch((error) => {
  process.stderr.write(`External decoded canary refused: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
