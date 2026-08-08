import { constants } from 'node:fs';
import { chmod, rename, writeFile, access, readFile, lstat } from 'node:fs/promises';
import { hostname } from 'node:os';

import { assertAllowedUrl, sha256 } from './contracts.mjs';

export const SMOKE_TARGET_ID = 'listener-staging-smoke-10';
export const SMOKE_ORIGIN = 'https://stream.harmonicbeacon.com';
export const EXTERNAL_CANARY_KIND = 'harmonic-beacon-external-decoded-canary';
export const TARGET_MONITOR_KIND = 'harmonic-beacon-listener-target-monitor';
export const EXTERNAL_CANARY_ROLE = 'decoded-canary';
export const TARGET_MONITOR_ROLE = 'target-monitor';
export const CANARY_MAX_AGE_MS = 45_000;
export const MONITOR_MAX_AGE_MS = 15_000;
export const SIGNED_MANIFEST_MAX_BYTES = 4_096;
export const STATUS_MAX_BYTES = 16_384;

// Immediate stop thresholds for the ten-client smoke. The monitor applies them
// and the wrapper re-verifies them, so neither side can weaken them silently.
export const MONITOR_THRESHOLDS = Object.freeze({
  maxCpuUsedRatio: 0.5,
  maxMemoryUsedRatio: 0.7,
  minRootFreeRatio: 0.3,
  maxEgressBitsPerSecond: 1_500_000_000,
  maxTcpRetransmitRatio: 0.01,
  maxInterfaceErrorsDrops: 0,
});

const MAX_ALERT_COUNT = 10_000;
const MAX_RESTART_OBSERVATIONS = 1_000;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseTimestamp(value, field) {
  const milliseconds = Date.parse(String(value ?? ''));
  assert(Number.isFinite(milliseconds), `${field} must be a valid timestamp`);
  return milliseconds;
}

export async function readPrivateFile(path, label, maxBytes = STATUS_MAX_BYTES) {
  assert(typeof path === 'string' && path.length > 0, `${label} file is required`);
  assert(Number.isSafeInteger(maxBytes) && maxBytes > 0, `${label} size bound is invalid`);
  try {
    await access(path, constants.R_OK);
  } catch {
    throw new Error(`cannot read ${label} file`);
  }
  // lstat never follows a symlink, so a symlink, device or other non-regular
  // source is refused instead of being silently dereferenced.
  const details = await lstat(path);
  assert(details.isFile(), `${label} source must be a regular file, not a symlink or device`);
  assert((details.mode & 0o777) === 0o600, `${label} source mode must be exactly 0600`);
  assert(details.size <= maxBytes, `${label} source exceeds the ${maxBytes} byte bound`);
  return { text: await readFile(path, 'utf8'), details };
}

export function validateFreshSignedManifest({
  value,
  allowedOrigins,
  nowMs = Date.now(),
  requiredThroughMs,
  writtenAtMs = null,
}) {
  assert(typeof value === 'string' && value.trim() === value && value.length > 0,
    'signed manifest file must contain exactly one URL');
  assert(!value.includes('\n') && !value.includes('\r'),
    'signed manifest file must contain exactly one URL');
  const url = assertAllowedUrl(value, allowedOrigins);
  assert(/^\/v1\/hls\/[a-z0-9][a-z0-9._-]{0,127}\/live\.m3u8$/.test(url.pathname),
    'signed manifest path is not the canonical media-playlist path');
  const keys = [...url.searchParams.keys()].sort();
  assert(JSON.stringify(keys) === JSON.stringify(['exp', 'sig']),
    'signed manifest must contain only exp and sig');
  const expiresAtSeconds = Number(url.searchParams.get('exp'));
  const signature = url.searchParams.get('sig') ?? '';
  assert(Number.isSafeInteger(expiresAtSeconds), 'signed manifest expiry is invalid');
  assert(/^[A-Za-z0-9_-]{32,}$/.test(signature), 'signed manifest signature shape is invalid');
  const expiresAtMs = expiresAtSeconds * 1000;
  assert(expiresAtMs > nowMs, 'signed manifest is expired');
  assert(expiresAtMs >= requiredThroughMs, 'signed manifest expires before smoke recovery begins');
  assert(expiresAtMs <= nowMs + 130_000, 'signed manifest expiry exceeds the bounded origin TTL');
  if (writtenAtMs !== null) {
    assert(writtenAtMs <= nowMs + 5_000 && nowMs - writtenAtMs <= 30_000,
      'signed manifest file was not refreshed in the last 30 seconds');
  }
  return { origin: url.origin, expiresAtMs };
}

function validateCommonStatus(status, { kind, role, maxAgeMs, nowMs, label }) {
  assert(status && typeof status === 'object', `${label} status is required`);
  assert(status.schemaVersion === 1 && status.kind === kind, `${label} status schema is invalid`);
  assert(status.role === role, `${label} status role is invalid`);
  assert(status.status === 'PASS', `${label} is not passing`);
  assert(status.external === true, `${label} must attest external execution`);
  assert(status.targetId === SMOKE_TARGET_ID && status.targetOrigin === SMOKE_ORIGIN,
    `${label} target does not match the ten-client smoke`);
  assert(/^[a-f0-9]{12}$/.test(String(status.hostHash ?? '')),
    `${label} host fingerprint is invalid`);
  const observedAtMs = parseTimestamp(status.observedAt, `${label}.observedAt`);
  assert(observedAtMs <= nowMs + 5_000, `${label} status is from the future`);
  assert(nowMs - observedAtMs <= maxAgeMs, `${label} status is stale`);
}

function boundedCount(value, field, maximum) {
  assert(Number.isSafeInteger(value) && value >= 0 && value <= maximum,
    `${field} must be a bounded count`);
}

function boundedRatio(value, field, minimum, maximum) {
  assert(typeof value === 'number' && Number.isFinite(value)
    && value >= minimum && value <= maximum,
  `${field} must be a finite number between ${minimum} and ${maximum}`);
}

export function validateExternalCanaryStatus(status, nowMs = Date.now()) {
  validateCommonStatus(status, {
    kind: EXTERNAL_CANARY_KIND,
    role: EXTERNAL_CANARY_ROLE,
    maxAgeMs: CANARY_MAX_AGE_MS,
    nowMs,
    label: 'external decoded canary',
  });
  assert(status.decodedAudio === true, 'external decoded canary did not decode audio');
  boundedCount(status.decodedSeconds, 'external decoded canary decoded seconds', 600);
  assert(status.decodedSeconds >= 6, 'external decoded canary did not decode six seconds');
  assert(Number.isFinite(status.manifestAgeSeconds)
    && status.manifestAgeSeconds >= 0 && status.manifestAgeSeconds <= 18,
  'external decoded canary manifest is stale');
  return status;
}

export function validateTargetMonitorStatus(status, nowMs = Date.now()) {
  validateCommonStatus(status, {
    kind: TARGET_MONITOR_KIND,
    role: TARGET_MONITOR_ROLE,
    maxAgeMs: MONITOR_MAX_AGE_MS,
    nowMs,
    label: 'target monitor',
  });
  assert(status.listenerReady === true && status.streamHealthy === true
    && status.liveReady === true && status.originUp === true && status.canaryOk === true,
  'target monitor has a failed health check');
  assert(status.alertmanagerReady === true, 'target monitor Alertmanager is not ready');
  boundedCount(status.activeAlerts, 'target monitor active alerts', MAX_ALERT_COUNT);
  boundedCount(status.prometheusFiringAlerts, 'target monitor firing alerts', MAX_ALERT_COUNT);
  assert(status.activeAlerts === 0 && status.prometheusFiringAlerts === 0,
    'target monitor reports active alerts');
  // The declared thresholds must equal the fixed smoke policy exactly; a
  // monitor running with weaker limits can never produce an accepted PASS.
  const declared = status.thresholds;
  assert(declared && typeof declared === 'object'
    && Object.keys(declared).length === Object.keys(MONITOR_THRESHOLDS).length
    && Object.entries(MONITOR_THRESHOLDS).every(([key, value]) => declared[key] === value),
  'target monitor thresholds differ from the fixed smoke policy');
  // Bounded direct telemetry at the immediate stop thresholds. A monitor PASS
  // with an out-of-policy value is rejected here as well.
  boundedRatio(status.cpuUsedRatio, 'target monitor CPU used ratio', 0, 1);
  assert(status.cpuUsedRatio < MONITOR_THRESHOLDS.maxCpuUsedRatio,
    'target monitor CPU used ratio reached the immediate stop threshold');
  boundedRatio(status.memoryUsedRatio, 'target monitor memory used ratio', 0, 1);
  assert(status.memoryUsedRatio < MONITOR_THRESHOLDS.maxMemoryUsedRatio,
    'target monitor memory used ratio reached the immediate stop threshold');
  boundedRatio(status.rootFreeRatio, 'target monitor root free ratio', 0, 1);
  assert(status.rootFreeRatio > MONITOR_THRESHOLDS.minRootFreeRatio,
    'target monitor root free ratio reached the immediate stop threshold');
  boundedRatio(status.egressBitsPerSecond, 'target monitor egress bits/s', 0, 1e12);
  assert(status.egressBitsPerSecond < MONITOR_THRESHOLDS.maxEgressBitsPerSecond,
    'target monitor egress reached the immediate stop threshold');
  boundedRatio(status.tcpRetransmitRatio, 'target monitor TCP retransmit ratio', 0, 1);
  assert(status.tcpRetransmitRatio < MONITOR_THRESHOLDS.maxTcpRetransmitRatio,
    'target monitor TCP retransmit ratio reached the immediate stop threshold');
  boundedCount(status.interfaceErrorsDrops, 'target monitor interface errors/drops', 1e9);
  assert(status.interfaceErrorsDrops === MONITOR_THRESHOLDS.maxInterfaceErrorsDrops,
    'target monitor reports interface errors or drops');
  // A status that has not established and verified a restart/OOM baseline can
  // never be accepted; nor can one that observed a restart or OOM kill.
  assert(status.restartBaselineEstablished === true,
    'target monitor has not established a restart/OOM baseline');
  boundedCount(status.containerRestartsObserved, 'target monitor container restarts',
    MAX_RESTART_OBSERVATIONS);
  boundedCount(status.oomEventsDelta, 'target monitor OOM events', MAX_RESTART_OBSERVATIONS);
  assert(status.containerRestartsObserved === 0 && status.oomEventsDelta === 0,
    'target monitor observed a container restart or OOM event');
  return status;
}

export function validateNetworkSmokePreconditions({
  plan,
  target,
  manifest,
  canaryStatus,
  monitorStatus,
  nowMs = Date.now(),
  expectedHostHash = assertExternalHost(),
}) {
  assert(plan?.profileName === 'staging-smoke', 'dedicated smoke accepts only staging-smoke');
  assert(plan.profile?.clients === 10 && plan.profile?.soakSeconds === 60
    && plan.profile?.rampPerSecond === 2 && plan.shardCount === 1,
  'dedicated smoke plan must remain exactly ten clients for sixty seconds');
  assert(target?.id === SMOKE_TARGET_ID && target?.limits?.maxClients === 10,
    'dedicated smoke policy is not capped at ten clients');
  assert(target.origins.length === 1 && target.origins[0] === SMOKE_ORIGIN,
    'dedicated smoke origin allowlist differs');
  validateFreshSignedManifest({
    ...manifest,
    allowedOrigins: target.origins,
    nowMs,
    requiredThroughMs: Date.parse(plan.endAt) + 10_000,
  });
  validateExternalCanaryStatus(canaryStatus, nowMs);
  validateTargetMonitorStatus(monitorStatus, nowMs);
  // The canary and monitor status files are read from local disk, so both
  // safety producers must be co-located with this wrapper on one external
  // host. Identical fingerprints on a second host would fail this check too.
  // The fingerprint is a truncated hostname hash, not a cryptographic
  // attestation: it catches misplaced producers but cannot prove topology, so
  // the runbook still requires a trusted operator and external inspection of
  // the generator host.
  assert(/^[a-f0-9]{12}$/.test(expectedHostHash), 'local host fingerprint is invalid');
  assert(canaryStatus.hostHash === expectedHostHash
    && monitorStatus.hostHash === expectedHostHash,
  'external canary and target monitor must run on this external host');
}

export async function readJsonStatus(path, label) {
  const { text } = await readPrivateFile(path, label);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} file is not valid JSON`);
  }
}

export function assertExternalHost(host = hostname()) {
  // Defense-in-depth only, NOT cryptographic topology proof: this rejects
  // mona-like hostnames and derives a non-cryptographic hash of the local
  // hostname. It cannot prove where a safety producer really ran — a renamed
  // or misconfigured host passes silently. A trusted operator plus external
  // inspection of the generator host (documented in the runbook) remains
  // required; do not weaken the rejection below.
  const labels = String(host).trim().toLowerCase().replace(/\.+$/, '').split('.');
  assert(!labels.some((label) => label === 'mona' || label.startsWith('mona-')),
    'external safety process is forbidden from mona');
  return sha256(String(host)).slice(0, 12);
}

export async function writePrivateJsonAtomic(path, value) {
  const temporaryPath = `${path}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'w' });
  await chmod(temporaryPath, 0o600);
  await rename(temporaryPath, path);
}
