import { hostname as systemHostname } from 'node:os';

import {
  EVIDENCE_KIND,
  EVIDENCE_SCHEMA_VERSION,
  assertAllowedUrl,
  assertExternalGenerator,
  assertRedactedEvidence,
  createLatencyHistogram,
  deriveThresholds,
  observeLatency,
  parseMediaPlaylist,
  redactedTarget,
  sha256,
  summarizeLatency,
} from './contracts.mjs';

class RequestFailure extends Error {
  constructor(category, status = null) {
    super(category);
    this.name = 'RequestFailure';
    this.category = category;
    this.status = status;
  }
}

function increment(object, key, amount = 1) {
  object[key] = (object[key] ?? 0) + amount;
}

function currentWindow(measurements) {
  const key = Math.floor(Date.now() / 10_000);
  if (!measurements._windows.has(key)) {
    measurements._windows.set(key, {
      requests: { total: 0, failed: 0 },
      fetch: { opportunities: 0, misses: 0 },
    });
  }
  return measurements._windows.get(key);
}

function recordRequestStart(measurements) {
  const window = currentWindow(measurements);
  measurements.requests.total += 1;
  window.requests.total += 1;
  return window;
}

function recordRequestFailure(measurements, window) {
  measurements.requests.failed += 1;
  window.requests.failed += 1;
}

function recordOpportunity(measurements, amount = 1) {
  measurements.fetchContinuity.opportunities += amount;
  currentWindow(measurements).fetch.opportunities += amount;
}

function markOpportunityMiss(measurements, category, amount = 1) {
  measurements.fetchContinuity.misses += amount;
  currentWindow(measurements).fetch.misses += amount;
  increment(measurements.fetchContinuity.missesByCategory, category, amount);
}

function emptyMeasurements(plan) {
  return {
    clients: {
      planned: plan.shard.localClients,
      started: 0,
      completed: 0,
      generatorScheduleMisses: 0,
    },
    requests: {
      total: 0,
      successful: 0,
      failed: 0,
      byKind: { manifest: 0, segment: 0 },
      errorsByCategory: {},
      httpStatus: {},
    },
    bytes: { total: 0, manifest: 0, segment: 0 },
    fetchContinuity: {
      opportunities: 0,
      successfulMediaFetches: 0,
      misses: 0,
      missesByCategory: {},
    },
    manifest: {
      samples: 0,
      sequenceRegressions: 0,
      windowMisses: 0,
    },
    latencyMs: {
      all: createLatencyHistogram(),
      manifest: createLatencyHistogram(),
      segment: createLatencyHistogram(),
      queue: createLatencyHistogram(),
    },
    _windows: new Map(),
  };
}

function publicPlan(plan) {
  return {
    planHash: plan.planHash,
    profileName: plan.profileName,
    profile: plan.profile,
    startAt: plan.startAt,
    endAt: plan.endAt,
    rampDurationSeconds: plan.rampDurationSeconds,
    shardCount: plan.shardCount,
    target: plan.target,
    plannedMaxRequestStartsPerSecond: plan.plannedMaxRequestStartsPerSecond,
    deterministicSchedule: 'utc-start-plus-global-client-ramp-ordinal',
  };
}

function publicShard(plan) {
  return {
    index: plan.shard.index,
    count: plan.shard.count,
    localClients: plan.shard.localClients,
    clientOrdinalsSha256: plan.shard.clientOrdinalsSha256,
  };
}

function summarizeMeasurements(measurements) {
  const { _windows, ...publicMeasurements } = measurements;
  const errorRate = measurements.requests.total
    ? measurements.requests.failed / measurements.requests.total
    : 1;
  const fetchMissRate = measurements.fetchContinuity.opportunities
    ? measurements.fetchContinuity.misses / measurements.fetchContinuity.opportunities
    : 1;
  const windows = [..._windows.values()];
  const eligibleRequestWindows = windows.filter((window) => window.requests.total >= 20);
  const eligibleFetchWindows = windows.filter((window) => window.fetch.opportunities >= 10);
  const worstRequestErrorRate = eligibleRequestWindows.length
    ? Math.max(...eligibleRequestWindows.map((window) => window.requests.failed / window.requests.total))
    : null;
  const worstFetchMissRate = eligibleFetchWindows.length
    ? Math.max(...eligibleFetchWindows.map((window) => window.fetch.misses / window.fetch.opportunities))
    : null;
  return {
    ...publicMeasurements,
    requests: { ...measurements.requests, errorRate },
    fetchContinuity: { ...measurements.fetchContinuity, fetchMissRate },
    latencyMs: {
      all: summarizeLatency(measurements.latencyMs.all),
      manifest: summarizeLatency(measurements.latencyMs.manifest),
      segment: summarizeLatency(measurements.latencyMs.segment),
      queue: summarizeLatency(measurements.latencyMs.queue),
    },
    rollingWindows: {
      seconds: 10,
      sampled: windows.length,
      eligibleRequestWindows: eligibleRequestWindows.length,
      eligibleFetchWindows: eligibleFetchWindows.length,
      worstRequestErrorRate,
      worstFetchMissRate,
    },
  };
}

function targetWithoutManifest(target) {
  return {
    id: target.id,
    environment: target.environment,
    plane: 'origin-media',
    origin: null,
    manifestPathSha256: null,
    allowlistedOrigins: [...target.origins],
  };
}

export function plannedEvidence({ plan, target, policySha256, profileSha256, hostname = systemHostname() }) {
  return assertRedactedEvidence({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: EVIDENCE_KIND,
    runId: plan.runId,
    status: 'PLANNED',
    generatedAt: new Date().toISOString(),
    target: targetWithoutManifest(target),
    generator: {
      role: 'dry-run',
      hostFingerprintSha256: sha256(String(hostname)),
      networkRequestsMade: false,
    },
    plan: publicPlan(plan),
    shard: publicShard(plan),
    thresholds: deriveThresholds(plan.profile),
    inputs: {
      targetPolicySha256: policySha256,
      profileDocumentSha256: profileSha256,
      confirmationSha256: sha256(plan.confirmation),
    },
    measurements: summarizeMeasurements(emptyMeasurements(plan)),
    redactionChecked: true,
  });
}

function createLimiter(limit) {
  let active = 0;
  const waiting = [];
  const release = () => {
    while (waiting.length > 0) {
      const next = waiting.shift();
      next.signal?.removeEventListener('abort', next.onAbort);
      if (next.signal?.aborted) continue;
      next.resolve();
      return;
    }
    active -= 1;
  };
  return async (operation, signal) => {
    if (signal?.aborted) throw abortError();
    if (active < limit) {
      active += 1;
    } else {
      await new Promise((resolve, reject) => {
        const entry = { resolve, reject, signal, onAbort: null };
        entry.onAbort = () => {
          const index = waiting.indexOf(entry);
          if (index >= 0) waiting.splice(index, 1);
          reject(abortError());
        };
        signal?.addEventListener('abort', entry.onAbort, { once: true });
        waiting.push(entry);
      });
    }
    if (signal?.aborted) {
      release();
      throw abortError();
    }
    try {
      return await operation();
    } finally {
      release();
    }
  };
}

function createStartRateLimiter(maxStartsPerSecond) {
  const starts = [];
  return async (signal) => {
    while (true) {
      if (signal?.aborted) throw abortError();
      const now = Date.now();
      while (starts.length > 0 && starts[0] <= now - 1_000) starts.shift();
      if (starts.length < maxStartsPerSecond) {
        starts.push(now);
        return;
      }
      await sleepUntil(starts[0] + 1_000, signal);
    }
  };
}

function abortError() {
  return new DOMException('run aborted', 'AbortError');
}

async function sleepUntil(timestampMs, signal) {
  const delayMs = timestampMs - Date.now();
  if (delayMs <= 0) return;
  if (signal?.aborted) throw abortError();
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function recordMiss(measurements, category, amount = 1) {
  recordOpportunity(measurements, amount);
  markOpportunityMiss(measurements, category, amount);
}

function categorize(error) {
  if (error?.name === 'AbortError') return 'aborted';
  if (error instanceof RequestFailure) return error.category;
  return 'network';
}

async function readBoundedBody(response, { maxBytes, range, bufferBody }) {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel();
    throw new RequestFailure('body_limit', response.status);
  }
  let expectedRangeBytes = null;
  if (range) {
    if (response.status !== 206) {
      await response.body?.cancel();
      throw new RequestFailure('range_status', response.status);
    }
    const match = response.headers.get('content-range')?.match(/^bytes (\d+)-(\d+)\/(?:\d+|\*)$/);
    if (!match || Number(match[1]) !== range.start || Number(match[2]) !== range.end) {
      await response.body?.cancel();
      throw new RequestFailure('range_mismatch', response.status);
    }
    expectedRangeBytes = range.end - range.start + 1;
    if (expectedRangeBytes > maxBytes) {
      await response.body?.cancel();
      throw new RequestFailure('body_limit', response.status);
    }
  }
  if (!response.body) throw new RequestFailure('empty', response.status);
  const reader = response.body.getReader();
  const chunks = bufferBody ? [] : null;
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new RequestFailure('body_limit', response.status);
    }
    chunks?.push(value);
  }
  if (bytes === 0) throw new RequestFailure('empty', response.status);
  if (expectedRangeBytes !== null && bytes !== expectedRangeBytes) {
    throw new RequestFailure('range_mismatch', response.status);
  }
  return {
    byteLength: bytes,
    buffer: chunks ? Buffer.concat(chunks, bytes) : null,
  };
}

async function fetchBody({
  url,
  kind,
  allowedOrigins,
  timeoutMs,
  maxBytes,
  bufferBody = false,
  attestation,
  range,
  fetchImpl,
  limiter,
  rateLimiter,
  signal,
  measurements,
}) {
  let parsed;
  try {
    parsed = assertAllowedUrl(url, allowedOrigins);
  } catch {
    throw new RequestFailure('target_allowlist');
  }
  const queuedAt = performance.now();
  await rateLimiter(signal);
  return limiter(async () => {
    const admittedAt = performance.now();
    observeLatency(measurements.latencyMs.queue, admittedAt - queuedAt);
    const requestWindow = recordRequestStart(measurements);
    measurements.requests.byKind[kind] += 1;
    let status = null;
    try {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
      const response = await fetchImpl(parsed, {
        method: 'GET',
        cache: 'no-store',
        redirect: 'manual',
        headers: {
          'Accept-Encoding': 'identity',
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        },
        signal: requestSignal,
      });
      status = response.status;
      increment(measurements.requests.httpStatus, String(status));
      if (attestation && response.headers.get(attestation.header) !== attestation.value) {
        await response.body?.cancel();
        throw new RequestFailure('target_attestation', status);
      }
      if (status >= 300 && status < 400) {
        await response.body?.cancel();
        throw new RequestFailure('redirect', status);
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new RequestFailure('http', status);
      }
      const body = await readBoundedBody(response, { maxBytes, range, bufferBody });
      measurements.requests.successful += 1;
      measurements.bytes[kind] += body.byteLength;
      measurements.bytes.total += body.byteLength;
      return body;
    } catch (error) {
      const failure = error?.name === 'TimeoutError'
        ? new RequestFailure('timeout', status)
        : error;
      recordRequestFailure(measurements, requestWindow);
      increment(measurements.requests.errorsByCategory, categorize(failure));
      if (failure?.name === 'AbortError' && signal?.aborted) throw failure;
      throw failure;
    } finally {
      const durationMs = performance.now() - queuedAt;
      observeLatency(measurements.latencyMs.all, durationMs);
      observeLatency(measurements.latencyMs[kind], durationMs);
    }
  }, signal);
}

function chooseSegments({ playlist, nextSequence, profile, measurements }) {
  const first = playlist.segments[0].sequence;
  const last = playlist.segments.at(-1).sequence;
  let wanted = nextSequence;
  if (wanted === null) {
    wanted = Math.max(first, last - profile.startupSegments + 1);
  }
  if (wanted < first) {
    const misses = first - wanted;
    measurements.manifest.windowMisses += misses;
    recordMiss(measurements, 'manifest_window', misses);
    wanted = first;
  }
  let segments = playlist.segments.filter((segment) => segment.sequence >= wanted);
  if (segments.length > profile.maxSegmentsPerPoll) {
    const skipped = segments.length - profile.maxSegmentsPerPoll;
    recordMiss(measurements, 'backlog_limit', skipped);
    segments = segments.slice(-profile.maxSegmentsPerPoll);
  }
  return segments;
}

export async function runShard({
  plan,
  target,
  policySha256,
  profileSha256,
  confirmation,
  manifestUrlProvider,
  externalGenerator,
  declaredGeneratorRole,
  hostname = systemHostname(),
  fetchImpl = fetch,
  signal,
  clockOffsetMs = null,
  onProgress,
}) {
  assertExternalGenerator({
    hostname,
    declaredRole: declaredGeneratorRole,
    externalConfirmed: externalGenerator,
    targetEnvironment: target.environment,
    networkRun: true,
  });
  if (confirmation !== plan.confirmation) throw new Error('exact load confirmation does not match the plan');
  const measuredClockOffsetMs = clockOffsetMs ?? (target.environment === 'synthetic' ? 0 : null);
  if (!Number.isFinite(measuredClockOffsetMs)
    || Math.abs(measuredClockOffsetMs) > target.limits.maxClockOffsetMs) {
    throw new Error(`measured clock offset exceeds ${target.limits.maxClockOffsetMs} ms`);
  }
  const measurements = emptyMeasurements(plan);
  const limiter = createLimiter(plan.profile.maxInflightPerShard);
  const rateLimiter = createStartRateLimiter(Math.max(
    1,
    Math.floor(target.limits.maxRequestsPerSecond / plan.shardCount),
  ));
  const startMs = Date.parse(plan.startAt);
  const endMs = Date.parse(plan.endAt);
  const deadlineSignal = AbortSignal.timeout(Math.max(1, endMs - Date.now()));
  const safetyController = new AbortController();
  const runSignal = AbortSignal.any([
    deadlineSignal,
    safetyController.signal,
    ...(signal ? [signal] : []),
  ]);
  const startedAt = new Date().toISOString();
  let descriptor = null;
  let terminationReason = 'completed';
  let circuitBreakerReason = null;
  const runThresholds = deriveThresholds(plan.profile);
  const progressTimer = typeof onProgress === 'function' ? setInterval(() => {
    onProgress({
      requests: measurements.requests.total,
      failed: measurements.requests.failed,
      bytes: measurements.bytes.total,
      fetchMisses: measurements.fetchContinuity.misses,
      clientsStarted: measurements.clients.started,
      clientsCompleted: measurements.clients.completed,
    });
  }, 10_000) : null;
  progressTimer?.unref();

  function evaluateCircuitBreaker() {
    if (safetyController.signal.aborted) return;
    const requestErrorRate = measurements.requests.total
      ? measurements.requests.failed / measurements.requests.total
      : 0;
    const fetchMissRate = measurements.fetchContinuity.opportunities
      ? measurements.fetchContinuity.misses / measurements.fetchContinuity.opportunities
      : 0;
    if (measurements.requests.total >= runThresholds.circuitBreakerMinRequests
      && requestErrorRate > runThresholds.circuitBreakerErrorRate) {
      circuitBreakerReason = 'request_error_rate';
      safetyController.abort();
    } else if (
      measurements.fetchContinuity.opportunities
        >= runThresholds.circuitBreakerMinFetchOpportunities
      && fetchMissRate > runThresholds.circuitBreakerFetchMissRate
    ) {
      circuitBreakerReason = 'fetch_miss_rate';
      safetyController.abort();
    }
  }

  async function loadManifest() {
    let rawUrl;
    try {
      rawUrl = await manifestUrlProvider();
    } catch {
      throw new RequestFailure('manifest_credential_source');
    }
    let nextDescriptor;
    try {
      nextDescriptor = redactedTarget(rawUrl, target);
    } catch {
      throw new RequestFailure('target_allowlist');
    }
    if (descriptor === null) descriptor = nextDescriptor;
    if (descriptor.origin !== nextDescriptor.origin
      || descriptor.manifestPathSha256 !== nextDescriptor.manifestPathSha256) {
      throw new RequestFailure('manifest_target_changed');
    }
    const body = await fetchBody({
      url: rawUrl,
      kind: 'manifest',
      allowedOrigins: target.origins,
      timeoutMs: plan.profile.requestTimeoutMs,
      maxBytes: target.limits.maxManifestBytes,
      bufferBody: true,
      attestation: target.attestation,
      fetchImpl,
      limiter,
      rateLimiter,
      signal: runSignal,
      measurements,
    });
    try {
      const playlist = parseMediaPlaylist(body.buffer.toString('utf8'), rawUrl);
      measurements.manifest.samples += 1;
      return playlist;
    } catch {
      increment(measurements.requests.errorsByCategory, 'manifest_parse');
      throw new RequestFailure('manifest_parse');
    }
  }

  async function runClient(ordinal) {
    const activationMs = startMs + Math.floor(ordinal / plan.profile.rampPerSecond) * 1000;
    await sleepUntil(activationMs, runSignal);
    measurements.clients.started += 1;
    let nextSequence = null;
    let previousMediaSequence = null;
    let loadedInitializationIdentity = null;

    async function fetchMediaResource({ resource, missPrefix, deadlineMs = null }) {
      recordOpportunity(measurements);
      let missed = false;
      const resourceStarted = performance.now();
      try {
        await fetchBody({
          url: resource.url,
          kind: 'segment',
          allowedOrigins: target.origins,
          timeoutMs: plan.profile.requestTimeoutMs,
          maxBytes: target.limits.maxSegmentBytes,
          attestation: target.attestation,
          range: resource.byteRange,
          fetchImpl,
          limiter,
          rateLimiter,
          signal: runSignal,
          measurements,
        });
        measurements.fetchContinuity.successfulMediaFetches += 1;
        if (deadlineMs !== null && performance.now() - resourceStarted >= deadlineMs) {
          missed = true;
          markOpportunityMiss(measurements, `${missPrefix}_deadline`);
        }
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        missed = true;
        markOpportunityMiss(measurements, `${missPrefix}_${categorize(error)}`);
      }
      evaluateCircuitBreaker();
      return !missed;
    }

    for (
      let scheduledMs = activationMs;
      scheduledMs < endMs;
      scheduledMs += plan.profile.manifestIntervalMs
    ) {
      await sleepUntil(scheduledMs, runSignal);
      if (runSignal.aborted) throw abortError();
      const skippedSlots = Math.floor(
        Math.max(0, Date.now() - scheduledMs) / plan.profile.manifestIntervalMs,
      );
      if (skippedSlots > 0) {
        measurements.clients.generatorScheduleMisses += skippedSlots;
        scheduledMs += skippedSlots * plan.profile.manifestIntervalMs;
        if (scheduledMs >= endMs) break;
      }
      let playlist;
      try {
        playlist = await loadManifest();
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        recordMiss(measurements, `manifest_${categorize(error)}`);
        evaluateCircuitBreaker();
        continue;
      }
      if (previousMediaSequence !== null && playlist.mediaSequence < previousMediaSequence) {
        measurements.manifest.sequenceRegressions += 1;
        recordMiss(measurements, 'sequence_regression');
      }
      previousMediaSequence = playlist.mediaSequence;
      const segments = chooseSegments({
        playlist,
        nextSequence,
        profile: plan.profile,
        measurements,
      });
      evaluateCircuitBreaker();
      for (const segment of segments) {
        if (segment.declaredGap) {
          recordMiss(measurements, 'declared_gap');
          evaluateCircuitBreaker();
          nextSequence = segment.sequence + 1;
          continue;
        }
        if (segment.initialization) {
          const initializationUrl = new URL(segment.initialization.url);
          const initializationIdentity = sha256([
            initializationUrl.origin,
            initializationUrl.pathname,
            segment.initialization.byteRange?.start ?? '',
            segment.initialization.byteRange?.end ?? '',
          ].join('|'));
          if (loadedInitializationIdentity !== initializationIdentity) {
            const loaded = await fetchMediaResource({
              resource: segment.initialization,
              missPrefix: 'initialization',
            });
            if (loaded) loadedInitializationIdentity = initializationIdentity;
          }
        }
        await fetchMediaResource({
          resource: segment,
          missPrefix: 'segment',
          deadlineMs: segment.durationSeconds * 1000,
        });
        nextSequence = segment.sequence + 1;
      }
    }
    measurements.clients.completed += 1;
  }

  const settled = await Promise.allSettled(plan.shard.clientOrdinals.map(runClient));
  clearInterval(progressTimer);
  const unexpected = settled.find((result) => (
    result.status === 'rejected' && result.reason?.name !== 'AbortError'
  ));
  if (unexpected) throw unexpected.reason;
  if (settled.some((result) => result.status === 'rejected')) {
    if (signal?.aborted) terminationReason = 'operator_abort';
    else if (safetyController.signal.aborted) terminationReason = 'circuit_breaker';
    else if (deadlineSignal.aborted) terminationReason = 'deadline_exceeded';
    else terminationReason = 'aborted';
  }
  if (terminationReason === 'completed' && deadlineSignal.aborted) {
    terminationReason = 'deadline_exceeded';
  }

  const summarized = summarizeMeasurements(measurements);
  const passed = terminationReason === 'completed'
    && summarized.requests.total > 0
    && summarized.requests.errorRate <= plan.profile.maxErrorRate
    && summarized.fetchContinuity.fetchMissRate <= plan.profile.maxFetchMissRate
    && summarized.latencyMs.manifest.p95UpperBoundMs !== null
    && summarized.latencyMs.manifest.p95UpperBoundMs <= plan.profile.maxManifestP95Ms
    && summarized.latencyMs.segment.p95UpperBoundMs !== null
    && summarized.latencyMs.segment.p95UpperBoundMs <= plan.profile.maxSegmentP95Ms
    && (summarized.rollingWindows.worstRequestErrorRate === null
      || summarized.rollingWindows.worstRequestErrorRate <= runThresholds.maxRollingErrorRate)
    && (summarized.rollingWindows.worstFetchMissRate === null
      || summarized.rollingWindows.worstFetchMissRate <= runThresholds.maxRollingFetchMissRate)
    && summarized.clients.completed === summarized.clients.planned
    && summarized.clients.generatorScheduleMisses === 0;
  return assertRedactedEvidence({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: EVIDENCE_KIND,
    runId: plan.runId,
    status: terminationReason === 'operator_abort' ? 'ABORTED' : (passed ? 'PASS' : 'FAIL'),
    generatedAt: new Date().toISOString(),
    startedAt,
    finishedAt: new Date().toISOString(),
    target: descriptor ?? targetWithoutManifest(target),
    generator: {
      role: declaredGeneratorRole,
      hostFingerprintSha256: sha256(String(hostname)),
      explicitlyExternal: externalGenerator === true,
      networkRequestsMade: measurements.requests.total > 0,
      measuredClockOffsetMs,
    },
    plan: publicPlan(plan),
    shard: publicShard(plan),
    thresholds: runThresholds,
    termination: {
      reason: terminationReason,
      circuitBreakerReason,
    },
    inputs: {
      targetPolicySha256: policySha256,
      profileDocumentSha256: profileSha256,
      confirmationSha256: sha256(plan.confirmation),
    },
    measurements: summarized,
    redactionChecked: true,
  });
}
