import { createHash } from 'node:crypto';

export const EVIDENCE_KIND = 'harmonic-beacon-early-birds-hls-origin-media-load';
export const EVIDENCE_SCHEMA_VERSION = 1;
export const GENERATOR_ROLE = 'external-load-generator';

export const LATENCY_BUCKETS_MS = Object.freeze([
  25,
  50,
  100,
  250,
  500,
  1_000,
  2_000,
  5_000,
  10_000,
  30_000,
]);

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,63}$/;
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const HARD_LIMITS = Object.freeze({
  clients: 5_000,
  rampPerSecond: 200,
  soakSeconds: 3_600,
  shardCount: 64,
  clientsPerShard: 1_000,
  manifestIntervalMs: 30_000,
  requestTimeoutMs: 30_000,
  maxSegmentsPerPoll: 12,
  maxRequestsPerSecond: 100_000,
  maxManifestBytes: 1024 * 1024,
  maxSegmentBytes: 64 * 1024 * 1024,
  qualityFailureRate: 0.1,
});
const BLOCKED_TARGET_HOSTS = new Set([
  'harmonicbeacon.com',
  'www.harmonicbeacon.com',
  'live.harmonicbeacon.com',
  'app.harmonicbeacon.com',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function positiveInteger(value, field, maximum) {
  assert(Number.isSafeInteger(value) && value > 0, `${field} must be a positive integer`);
  assert(value <= maximum, `${field} exceeds the hard limit of ${maximum}`);
  return value;
}

function rate(value, field, maximum = 1) {
  assert(typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= maximum,
    `${field} must be between zero and ${maximum}`);
  return value;
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function canonicalOrigin(value) {
  const url = new URL(String(value));
  assert(['http:', 'https:'].includes(url.protocol), 'target origins must use HTTP or HTTPS');
  assert(!url.username && !url.password, 'target origins cannot contain credentials');
  assert(url.pathname === '/' && !url.search && !url.hash,
    'target origins must not contain a path, query, or fragment');
  return url.origin;
}

function validateTarget(target) {
  assert(target && typeof target === 'object', 'target policy entry must be an object');
  assert(typeof target.id === 'string' && ID_PATTERN.test(target.id), 'target id is invalid');
  assert(['staging', 'synthetic'].includes(target.environment),
    'target environment must be staging or synthetic; live/production is forbidden');
  assert(target.production === false, 'target policy must explicitly set production to false');
  let attestation = null;
  if (target.environment === 'staging') {
    assert(target.attestation && typeof target.attestation === 'object',
      'staging target requires an exact response-header attestation');
    const header = String(target.attestation.header ?? '').toLowerCase();
    const value = String(target.attestation.value ?? '');
    assert(header === 'x-harmonic-beacon-environment',
      'staging attestation header must be x-harmonic-beacon-environment');
    assert(/^early-birds-staging(?:-[a-z0-9-]+)?$/.test(value),
      'staging attestation value must identify early-birds-staging');
    attestation = Object.freeze({ header, value });
  }
  assert(Array.isArray(target.origins) && target.origins.length > 0 && target.origins.length <= 8,
    'target must allowlist between one and eight exact origins');
  const origins = target.origins.map(canonicalOrigin);
  assert(new Set(origins).size === origins.length, 'target origins must be unique');
  for (const origin of origins) {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
    const labels = hostname.split('.');
    assert(!BLOCKED_TARGET_HOSTS.has(hostname)
      && !hostname.endsWith('.live.harmonicbeacon.com'),
    `production target hostname ${url.hostname} is forbidden`);
    assert(!labels.some((label) => ['live', 'prod', 'production'].includes(label)),
      `production-like target hostname ${url.hostname} is forbidden`);
    if (target.environment === 'staging') {
      assert(url.protocol === 'https:', 'staging target origins must use HTTPS');
    } else {
      assert(['localhost', '127.0.0.1', '::1'].includes(url.hostname),
        'synthetic targets must be loopback-only');
    }
  }
  const limits = target.limits;
  assert(limits && typeof limits === 'object', 'target limits are required');
  const normalizedLimits = Object.freeze({
    maxClients: positiveInteger(limits.maxClients, 'limits.maxClients', HARD_LIMITS.clients),
    maxRampPerSecond: positiveInteger(
      limits.maxRampPerSecond,
      'limits.maxRampPerSecond',
      HARD_LIMITS.rampPerSecond,
    ),
    maxSoakSeconds: positiveInteger(
      limits.maxSoakSeconds,
      'limits.maxSoakSeconds',
      HARD_LIMITS.soakSeconds,
    ),
    maxShardCount: positiveInteger(
      limits.maxShardCount,
      'limits.maxShardCount',
      HARD_LIMITS.shardCount,
    ),
    minManifestIntervalMs: positiveInteger(
      limits.minManifestIntervalMs,
      'limits.minManifestIntervalMs',
      HARD_LIMITS.manifestIntervalMs,
    ),
    maxInflightPerShard: positiveInteger(
      limits.maxInflightPerShard,
      'limits.maxInflightPerShard',
      512,
    ),
    maxSegmentsPerPoll: positiveInteger(
      limits.maxSegmentsPerPoll,
      'limits.maxSegmentsPerPoll',
      HARD_LIMITS.maxSegmentsPerPoll,
    ),
    maxRequestsPerSecond: positiveInteger(
      limits.maxRequestsPerSecond,
      'limits.maxRequestsPerSecond',
      HARD_LIMITS.maxRequestsPerSecond,
    ),
    maxManifestBytes: positiveInteger(
      limits.maxManifestBytes,
      'limits.maxManifestBytes',
      HARD_LIMITS.maxManifestBytes,
    ),
    maxSegmentBytes: positiveInteger(
      limits.maxSegmentBytes,
      'limits.maxSegmentBytes',
      HARD_LIMITS.maxSegmentBytes,
    ),
    maxClockOffsetMs: positiveInteger(
      limits.maxClockOffsetMs,
      'limits.maxClockOffsetMs',
      1_000,
    ),
  });
  assert(normalizedLimits.maxInflightPerShard * normalizedLimits.maxSegmentBytes
    <= 512 * 1024 * 1024,
  'target maxInflightPerShard × maxSegmentBytes exceeds the 512 MiB safety product');
  return Object.freeze({
    id: target.id,
    environment: target.environment,
    production: false,
    attestation,
    origins: Object.freeze(origins),
    limits: normalizedLimits,
  });
}

export function selectTarget(policy, targetId) {
  assert(policy?.schemaVersion === 1, 'target policy schemaVersion must be 1');
  assert(Array.isArray(policy.targets) && policy.targets.length > 0,
    'target policy must contain targets');
  const matches = policy.targets.filter((target) => target?.id === targetId);
  assert(matches.length === 1, `target policy must contain exactly one ${targetId} entry`);
  return validateTarget(matches[0]);
}

export function validateProfile(profile, profileName = 'profile') {
  assert(profile && typeof profile === 'object', `${profileName} must be an object`);
  const normalized = {
    clients: positiveInteger(profile.clients, 'clients', HARD_LIMITS.clients),
    rampPerSecond: positiveInteger(
      profile.rampPerSecond,
      'rampPerSecond',
      HARD_LIMITS.rampPerSecond,
    ),
    soakSeconds: positiveInteger(profile.soakSeconds, 'soakSeconds', HARD_LIMITS.soakSeconds),
    manifestIntervalMs: positiveInteger(
      profile.manifestIntervalMs,
      'manifestIntervalMs',
      HARD_LIMITS.manifestIntervalMs,
    ),
    requestTimeoutMs: positiveInteger(
      profile.requestTimeoutMs,
      'requestTimeoutMs',
      HARD_LIMITS.requestTimeoutMs,
    ),
    startupSegments: positiveInteger(
      profile.startupSegments,
      'startupSegments',
      HARD_LIMITS.maxSegmentsPerPoll,
    ),
    maxSegmentsPerPoll: positiveInteger(
      profile.maxSegmentsPerPoll,
      'maxSegmentsPerPoll',
      HARD_LIMITS.maxSegmentsPerPoll,
    ),
    maxInflightPerShard: positiveInteger(
      profile.maxInflightPerShard,
      'maxInflightPerShard',
      512,
    ),
    minShards: positiveInteger(profile.minShards, 'minShards', HARD_LIMITS.shardCount),
    maxErrorRate: rate(
      profile.maxErrorRate,
      'maxErrorRate',
      HARD_LIMITS.qualityFailureRate,
    ),
    maxFetchMissRate: rate(
      profile.maxFetchMissRate,
      'maxFetchMissRate',
      HARD_LIMITS.qualityFailureRate,
    ),
    maxManifestP95Ms: positiveInteger(
      profile.maxManifestP95Ms,
      'maxManifestP95Ms',
      HARD_LIMITS.requestTimeoutMs,
    ),
    maxSegmentP95Ms: positiveInteger(
      profile.maxSegmentP95Ms,
      'maxSegmentP95Ms',
      HARD_LIMITS.requestTimeoutMs,
    ),
    syntheticOnly: profile.syntheticOnly === true,
  };
  assert(normalized.startupSegments <= normalized.maxSegmentsPerPoll,
    'startupSegments cannot exceed maxSegmentsPerPoll');
  assert(normalized.requestTimeoutMs <= normalized.manifestIntervalMs * 2,
    'requestTimeoutMs cannot exceed twice manifestIntervalMs');
  return Object.freeze(normalized);
}

export function deriveThresholds(profile) {
  return Object.freeze({
    maxErrorRate: profile.maxErrorRate,
    maxFetchMissRate: profile.maxFetchMissRate,
    maxManifestP95Ms: profile.maxManifestP95Ms,
    maxSegmentP95Ms: profile.maxSegmentP95Ms,
    rollingWindowSeconds: 10,
    rollingMinRequests: 20,
    rollingMinFetchOpportunities: 10,
    maxRollingErrorRate: Math.min(0.2, Math.max(profile.maxErrorRate * 2, 0.02)),
    maxRollingFetchMissRate: Math.min(
      0.2,
      Math.max(profile.maxFetchMissRate * 2, 0.02),
    ),
    circuitBreakerMinRequests: 50,
    circuitBreakerMinFetchOpportunities: 25,
    circuitBreakerErrorRate: Math.min(0.25, Math.max(profile.maxErrorRate * 3, 0.05)),
    circuitBreakerFetchMissRate: Math.min(
      0.25,
      Math.max(profile.maxFetchMissRate * 3, 0.05),
    ),
  });
}

export function parseUtc(value, field = 'startAt') {
  assert(typeof value === 'string' && UTC_PATTERN.test(value),
    `${field} must be an explicit UTC timestamp ending in Z`);
  const milliseconds = Date.parse(value);
  assert(Number.isFinite(milliseconds), `${field} is not a valid timestamp`);
  const [datePart, timePart] = value.split('T');
  const [year, month, day] = datePart.split('-').map(Number);
  const [hour, minute, rawSecond] = timePart.slice(0, -1).split(':');
  const second = Number(rawSecond.split('.')[0]);
  const parsed = new Date(milliseconds);
  assert(parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() + 1 === month
    && parsed.getUTCDate() === day
    && parsed.getUTCHours() === Number(hour)
    && parsed.getUTCMinutes() === Number(minute)
    && parsed.getUTCSeconds() === second,
  `${field} contains an invalid UTC civil date`);
  return parsed.toISOString();
}

export function clientOrdinals(totalClients, shardIndex, shardCount) {
  const ordinals = [];
  for (let ordinal = shardIndex; ordinal < totalClients; ordinal += shardCount) {
    ordinals.push(ordinal);
  }
  return ordinals;
}

export function expectedConfirmation({ targetId, runId, profile, shardCount, startAt }) {
  return [
    'EARLYBIRDS-HLS-LOAD',
    `target=${targetId}`,
    `run=${runId}`,
    `clients=${profile.clients}`,
    `ramp=${profile.rampPerSecond}/s`,
    `soak=${profile.soakSeconds}s`,
    `shards=${shardCount}`,
    `start=${startAt}`,
    'generator=external-not-mona',
  ].join(' ');
}

export function buildPlan({
  runId,
  profileName,
  profile: rawProfile,
  target,
  shardIndex,
  shardCount,
  startAt: rawStartAt,
  networkRun,
  nowMs = Date.now(),
}) {
  assert(typeof runId === 'string' && ID_PATTERN.test(runId), 'run id is invalid');
  assert(typeof profileName === 'string' && ID_PATTERN.test(profileName), 'profile name is invalid');
  const profile = validateProfile(rawProfile, profileName);
  assert(Number.isInteger(shardCount) && shardCount >= 1 && shardCount <= HARD_LIMITS.shardCount,
    `shardCount must be between 1 and ${HARD_LIMITS.shardCount}`);
  assert(Number.isInteger(shardIndex) && shardIndex >= 0 && shardIndex < shardCount,
    'shardIndex must be between zero and shardCount - 1');
  assert(shardCount >= profile.minShards,
    `profile ${profileName} requires at least ${profile.minShards} shards`);
  assert(shardCount <= target.limits.maxShardCount, 'shardCount exceeds the target policy');
  assert(profile.clients <= target.limits.maxClients, 'clients exceed the target policy');
  assert(profile.rampPerSecond <= target.limits.maxRampPerSecond,
    'rampPerSecond exceeds the target policy');
  assert(profile.soakSeconds <= target.limits.maxSoakSeconds,
    'soakSeconds exceeds the target policy');
  assert(!(profile.syntheticOnly && target.environment !== 'synthetic'),
    'synthetic-only profiles cannot target staging');
  const minimumManifestIntervalMs = Math.max(
    target.environment === 'staging' ? 1_000 : 25,
    target.limits.minManifestIntervalMs,
  );
  assert(profile.manifestIntervalMs >= minimumManifestIntervalMs,
    `${target.environment} manifestIntervalMs must be at least ${minimumManifestIntervalMs}`);
  assert(profile.maxInflightPerShard <= target.limits.maxInflightPerShard,
    'maxInflightPerShard exceeds the target policy');
  assert(profile.maxSegmentsPerPoll <= target.limits.maxSegmentsPerPoll,
    'maxSegmentsPerPoll exceeds the target policy');
  const steadyRequestStartsPerSecond = Math.ceil(
    profile.clients * 1000 / profile.manifestIntervalMs,
  ) * (1 + profile.maxSegmentsPerPoll);
  const rampRequestStartsPerSecond = profile.rampPerSecond * (1 + profile.startupSegments);
  const plannedMaxRequestStartsPerSecond = Math.max(
    steadyRequestStartsPerSecond,
    rampRequestStartsPerSecond,
  );
  assert(plannedMaxRequestStartsPerSecond <= target.limits.maxRequestsPerSecond,
    'derived request starts per second exceed the target policy');
  if (profile.clients > 250) assert(shardCount >= 2, 'more than 250 clients require sharding');
  if (profile.clients > 1_000) assert(shardCount >= 4, 'more than 1,000 clients require at least four shards');

  const ordinals = clientOrdinals(profile.clients, shardIndex, shardCount);
  assert(ordinals.length <= HARD_LIMITS.clientsPerShard,
    `each shard is limited to ${HARD_LIMITS.clientsPerShard} clients`);
  const startAt = parseUtc(rawStartAt);
  const startMs = Date.parse(startAt);
  if (networkRun && target.environment === 'staging') {
    assert(startMs >= nowMs + 10_000, 'staging startAt must be at least ten seconds in the future');
    assert(startMs <= nowMs + 6 * 60 * 60 * 1000,
      'staging startAt cannot be more than six hours in the future');
  }
  const rampDurationSeconds = Math.ceil(Math.max(0, profile.clients - 1) / profile.rampPerSecond);
  const endAt = new Date(startMs + (rampDurationSeconds + profile.soakSeconds) * 1000).toISOString();
  const globalPlan = {
    runId,
    profileName,
    profile,
    target: {
      id: target.id,
      environment: target.environment,
      origins: target.origins,
      limits: target.limits,
      attestation: target.attestation,
    },
    startAt,
    endAt,
    rampDurationSeconds,
    shardCount,
    plannedMaxRequestStartsPerSecond,
  };
  const planHash = sha256(canonicalJson(globalPlan));
  const confirmation = expectedConfirmation({
    targetId: target.id,
    runId,
    profile,
    shardCount,
    startAt,
  });
  return Object.freeze({
    ...globalPlan,
    planHash,
    confirmation: `${confirmation} plan=${planHash}`,
    shard: Object.freeze({
      index: shardIndex,
      count: shardCount,
      localClients: ordinals.length,
      clientOrdinals: Object.freeze(ordinals),
      clientOrdinalsSha256: sha256(ordinals.join(',')),
    }),
  });
}

export function assertExternalGenerator({
  hostname,
  declaredRole,
  externalConfirmed,
  targetEnvironment,
  networkRun,
}) {
  if (!networkRun || targetEnvironment === 'synthetic') return;
  const normalizedHostname = String(hostname ?? '').trim().toLowerCase();
  const hostLabels = normalizedHostname.replace(/\.+$/, '').split('.');
  assert(!hostLabels.some((label) => label === 'mona' || label.startsWith('mona-')),
    'network load is forbidden from mona');
  assert(declaredRole === GENERATOR_ROLE,
    `EARLY_BIRDS_GENERATOR_ROLE must equal ${GENERATOR_ROLE}`);
  assert(externalConfirmed === true, '--external-generator is required for staging network runs');
}

export function assertAllowedUrl(value, allowedOrigins) {
  const url = new URL(String(value));
  assert(['http:', 'https:'].includes(url.protocol), 'request URL must use HTTP or HTTPS');
  assert(!url.username && !url.password, 'request URL cannot contain credentials');
  assert(!url.hash, 'request URL cannot contain a fragment');
  assert(allowedOrigins.includes(url.origin), `request URL escaped the exact target allowlist: ${url.origin}`);
  return url;
}

export function parseMediaPlaylist(text, manifestUrl) {
  assert(typeof text === 'string' && text.length > 0, 'manifest body is empty');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert(lines[0] === '#EXTM3U', 'manifest is not HLS');
  assert(!lines.some((line) => line.startsWith('#EXT-X-STREAM-INF')),
    'master playlists are not supported; target one media playlist explicitly');
  assert(!lines.some((line) => line.startsWith('#EXT-X-KEY:') && !line.includes('METHOD=NONE')),
    'encrypted media playlists are not supported by this fetch model');
  assert(!lines.some((line) => line.startsWith('#EXT-X-PART:')
    || line.startsWith('#EXT-X-PRELOAD-HINT:')),
  'low-latency HLS parts are not supported by this fetch model');
  let mediaSequence = 0;
  let durationSeconds = null;
  let byteRange = null;
  let previousByteRangeEnd = null;
  let previousByteRangeUrl = null;
  let initialization = null;
  let declaredGap = false;
  const segments = [];
  for (const line of lines.slice(1)) {
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      mediaSequence = Number(line.slice('#EXT-X-MEDIA-SEQUENCE:'.length));
      assert(Number.isSafeInteger(mediaSequence) && mediaSequence >= 0,
        'manifest media sequence is invalid');
    } else if (line.startsWith('#EXTINF:')) {
      durationSeconds = Number(line.slice('#EXTINF:'.length).split(',')[0]);
      assert(Number.isFinite(durationSeconds) && durationSeconds > 0 && durationSeconds <= 600,
        'manifest segment duration is invalid');
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) {
      const raw = line.slice('#EXT-X-BYTERANGE:'.length);
      assert(/^\d+(?:@\d+)?$/.test(raw), 'manifest byte range is invalid');
      const [length, offset] = raw.split('@').map(Number);
      assert(Number.isSafeInteger(length) && length > 0,
        'manifest byte range length must be a positive safe integer');
      assert(offset === undefined || (Number.isSafeInteger(offset) && offset >= 0),
        'manifest byte range offset must be a non-negative safe integer');
      byteRange = { length, offset: offset ?? null };
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attributes = line.slice('#EXT-X-MAP:'.length);
      const uri = attributes.match(/(?:^|,)\s*URI="([^"]+)"/)?.[1];
      assert(uri, 'manifest initialization map URI is invalid');
      const rawRange = attributes.match(/(?:^|,)\s*BYTERANGE="(\d+)(?:@(\d+))?"/)?.slice(1);
      let mapRange = null;
      if (rawRange) {
        const length = Number(rawRange[0]);
        const start = rawRange[1] === undefined ? 0 : Number(rawRange[1]);
        assert(Number.isSafeInteger(length) && length > 0
          && Number.isSafeInteger(start) && start >= 0
          && Number.isSafeInteger(start + length - 1),
        'manifest initialization byte range is invalid');
        mapRange = { start, end: start + length - 1 };
      }
      initialization = {
        url: new URL(uri, manifestUrl).toString(),
        byteRange: mapRange,
      };
    } else if (line === '#EXT-X-GAP') {
      declaredGap = true;
    } else if (!line.startsWith('#')) {
      assert(durationSeconds !== null, 'segment URI is missing EXTINF duration');
      const url = new URL(line, manifestUrl).toString();
      let normalizedByteRange = null;
      if (byteRange) {
        const start = byteRange.offset ?? (
          previousByteRangeUrl === url && previousByteRangeEnd !== null
            ? previousByteRangeEnd + 1
            : null
        );
        assert(start !== null, 'implicit byte range offset has no preceding range for the same URI');
        normalizedByteRange = { start, end: start + byteRange.length - 1 };
        assert(Number.isSafeInteger(normalizedByteRange.end),
          'manifest byte range end exceeds safe integer precision');
        previousByteRangeEnd = normalizedByteRange.end;
        previousByteRangeUrl = url;
      } else {
        previousByteRangeEnd = null;
        previousByteRangeUrl = null;
      }
      segments.push({
        sequence: mediaSequence + segments.length,
        durationSeconds,
        url,
        byteRange: normalizedByteRange,
        initialization,
        declaredGap,
      });
      durationSeconds = null;
      byteRange = null;
      declaredGap = false;
    }
  }
  assert(segments.length > 0, 'media playlist contains no segments');
  return Object.freeze({ mediaSequence, segments: Object.freeze(segments) });
}

export function createLatencyHistogram() {
  return {
    bucketsMs: [...LATENCY_BUCKETS_MS],
    counts: Array.from({ length: LATENCY_BUCKETS_MS.length + 1 }, () => 0),
    count: 0,
    sumMs: 0,
    minMs: null,
    maxMs: null,
  };
}

export function observeLatency(histogram, durationMs) {
  assert(Number.isFinite(durationMs) && durationMs >= 0, 'durationMs must be non-negative');
  const index = histogram.bucketsMs.findIndex((upperBound) => durationMs <= upperBound);
  histogram.counts[index < 0 ? histogram.counts.length - 1 : index] += 1;
  histogram.count += 1;
  histogram.sumMs += durationMs;
  histogram.minMs = histogram.minMs === null ? durationMs : Math.min(histogram.minMs, durationMs);
  histogram.maxMs = histogram.maxMs === null ? durationMs : Math.max(histogram.maxMs, durationMs);
}

export function mergeLatencyHistograms(histograms) {
  const merged = createLatencyHistogram();
  for (const histogram of histograms) {
    assert(JSON.stringify(histogram.bucketsMs) === JSON.stringify(merged.bucketsMs),
      'latency histogram buckets differ');
    histogram.counts.forEach((count, index) => { merged.counts[index] += count; });
    merged.count += histogram.count;
    merged.sumMs += histogram.sumMs;
    if (histogram.minMs !== null) {
      merged.minMs = merged.minMs === null ? histogram.minMs : Math.min(merged.minMs, histogram.minMs);
      merged.maxMs = merged.maxMs === null ? histogram.maxMs : Math.max(merged.maxMs, histogram.maxMs);
    }
  }
  return merged;
}

function approximatePercentile(histogram, percentile) {
  if (histogram.count === 0) return null;
  const wanted = Math.ceil(histogram.count * percentile);
  let cumulative = 0;
  for (let index = 0; index < histogram.counts.length; index += 1) {
    cumulative += histogram.counts[index];
    if (cumulative >= wanted) return histogram.bucketsMs[index] ?? histogram.maxMs;
  }
  return histogram.maxMs;
}

export function summarizeLatency(histogram) {
  return {
    ...histogram,
    meanMs: histogram.count ? histogram.sumMs / histogram.count : null,
    p50UpperBoundMs: approximatePercentile(histogram, 0.5),
    p95UpperBoundMs: approximatePercentile(histogram, 0.95),
    p99UpperBoundMs: approximatePercentile(histogram, 0.99),
  };
}

export function redactedTarget(manifestUrl, target) {
  const url = assertAllowedUrl(manifestUrl, target.origins);
  return {
    id: target.id,
    environment: target.environment,
    plane: 'origin-media',
    origin: url.origin,
    manifestPathSha256: sha256(url.pathname),
    allowlistedOrigins: [...target.origins],
  };
}

export function assertRedactedEvidence(evidence) {
  const serialized = JSON.stringify(evidence);
  assert(!/https?:\\?\/\\?\/[^"\s]+\?/.test(serialized),
    'evidence cannot contain URLs with query strings');
  assert(!/(?:sig|token|authorization|cookie|password|secret)=/i.test(serialized),
    'evidence contains credential-like material');
  assert(!/manifestUrl/i.test(serialized), 'evidence cannot contain a raw manifest URL field');
  const visit = (value, key = '') => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z]/g, '');
    assert(!['authorization', 'cookie', 'setcookie', 'password', 'secret', 'token', 'signature', 'sig', 'manifesturl']
      .includes(normalizedKey),
    `evidence contains forbidden sensitive field ${key}`);
    if (typeof value === 'string') {
      assert(!/\bbearer\s+\S+/i.test(value), 'evidence contains a bearer value');
      assert(!/[?&](?:sig|token|authorization)=/i.test(value),
        'evidence contains signed or authorized query material');
    } else if (Array.isArray(value)) {
      value.forEach((item) => visit(item));
    } else if (value && typeof value === 'object') {
      Object.entries(value).forEach(([childKey, child]) => visit(child, childKey));
    }
  };
  visit(evidence);
  return evidence;
}

function addObjects(target, source) {
  for (const [key, value] of Object.entries(source)) {
    target[key] = (target[key] ?? 0) + value;
  }
}

function sameValue(left, right) {
  return sha256(canonicalJson(left)) === sha256(canonicalJson(right));
}

function nonNegativeInteger(value, field) {
  assert(Number.isSafeInteger(value) && value >= 0, `${field} must be a non-negative integer`);
}

function validateHistogram(histogram, expectedCount, field) {
  assert(histogram && Array.isArray(histogram.bucketsMs) && Array.isArray(histogram.counts),
    `${field} histogram is missing`);
  assert(sameValue(histogram.bucketsMs, LATENCY_BUCKETS_MS), `${field} buckets differ`);
  assert(histogram.counts.length === LATENCY_BUCKETS_MS.length + 1,
    `${field} bucket count differs`);
  histogram.counts.forEach((count) => nonNegativeInteger(count, `${field} bucket count`));
  assert(histogram.counts.reduce((sum, count) => sum + count, 0) === histogram.count,
    `${field} histogram counts do not sum to count`);
  assert(histogram.count === expectedCount, `${field} histogram count differs from requests`);
  const recomputed = summarizeLatency({
    bucketsMs: histogram.bucketsMs,
    counts: histogram.counts,
    count: histogram.count,
    sumMs: histogram.sumMs,
    minMs: histogram.minMs,
    maxMs: histogram.maxMs,
  });
  assert(histogram.p50UpperBoundMs === recomputed.p50UpperBoundMs
    && histogram.p95UpperBoundMs === recomputed.p95UpperBoundMs
    && histogram.p99UpperBoundMs === recomputed.p99UpperBoundMs,
  `${field} percentile summary is inconsistent`);
}

function validateShardEvidence(evidence) {
  assert(evidence?.schemaVersion === EVIDENCE_SCHEMA_VERSION && evidence?.kind === EVIDENCE_KIND,
    'unexpected shard evidence schema');
  assertRedactedEvidence(evidence);
  assert(['PASS', 'FAIL', 'ABORTED'].includes(evidence.status),
    'aggregate accepts only terminal shard evidence');
  const { measurements } = evidence;
  assert(measurements && evidence.plan && evidence.shard && evidence.target,
    'shard evidence is incomplete');
  assert(evidence.target.plane === 'origin-media',
    'shard evidence must identify the origin-media plane');
  const { planHash, deterministicSchedule, ...publicGlobalPlan } = evidence.plan;
  assert(deterministicSchedule === 'utc-start-plus-global-client-ramp-ordinal',
    'deterministic schedule identifier differs');
  assert(sha256(canonicalJson({ runId: evidence.runId, ...publicGlobalPlan })) === planHash,
    'planHash does not match the public deterministic plan');
  const normalizedProfile = validateProfile(evidence.plan.profile, 'evidence plan profile');
  assert(sameValue(evidence.plan.profile, normalizedProfile),
    'evidence plan profile is not normalized');
  assert(sameValue(evidence.thresholds, deriveThresholds(normalizedProfile)),
    'evidence thresholds do not match the deterministic plan profile');
  const expectedConfirmationValue = `${expectedConfirmation({
    targetId: evidence.plan.target.id,
    runId: evidence.runId,
    profile: evidence.plan.profile,
    shardCount: evidence.plan.shardCount,
    startAt: evidence.plan.startAt,
  })} plan=${planHash}`;
  assert(evidence.inputs?.confirmationSha256 === sha256(expectedConfirmationValue),
    'confirmation hash does not match the deterministic plan');
  assert(evidence.target.id === evidence.plan.target.id
    && evidence.target.environment === evidence.plan.target.environment
    && evidence.plan.target.origins.includes(evidence.target.origin)
    && /^[a-f0-9]{64}$/.test(evidence.target.manifestPathSha256),
  'actual target descriptor does not match the plan');
  for (const [field, value] of Object.entries({
    requestsTotal: measurements.requests.total,
    requestsSuccessful: measurements.requests.successful,
    requestsFailed: measurements.requests.failed,
    manifestRequests: measurements.requests.byKind.manifest,
    segmentRequests: measurements.requests.byKind.segment,
    bytesTotal: measurements.bytes.total,
    manifestBytes: measurements.bytes.manifest,
    segmentBytes: measurements.bytes.segment,
    clientsPlanned: measurements.clients.planned,
    clientsStarted: measurements.clients.started,
    clientsCompleted: measurements.clients.completed,
    generatorScheduleMisses: measurements.clients.generatorScheduleMisses,
    fetchOpportunities: measurements.fetchContinuity.opportunities,
    successfulMediaFetches: measurements.fetchContinuity.successfulMediaFetches,
    fetchMisses: measurements.fetchContinuity.misses,
  })) nonNegativeInteger(value, field);
  assert(measurements.requests.total
    === measurements.requests.successful + measurements.requests.failed,
  'request success/failure counts do not sum to total');
  assert(measurements.requests.total
    === measurements.requests.byKind.manifest + measurements.requests.byKind.segment,
  'request kinds do not sum to total');
  assert(measurements.bytes.total === measurements.bytes.manifest + measurements.bytes.segment,
    'byte kinds do not sum to total');
  const expectedErrorRate = measurements.requests.total
    ? measurements.requests.failed / measurements.requests.total
    : 1;
  const expectedFetchMissRate = measurements.fetchContinuity.opportunities
    ? measurements.fetchContinuity.misses / measurements.fetchContinuity.opportunities
    : 1;
  assert(measurements.requests.errorRate === expectedErrorRate,
    'request error rate is inconsistent');
  assert(measurements.fetchContinuity.fetchMissRate === expectedFetchMissRate,
    'fetch miss rate is inconsistent');
  assert(measurements.clients.planned === evidence.shard.localClients,
    'planned clients differ from shard plan');
  assert(measurements.clients.started <= measurements.clients.planned
    && measurements.clients.completed <= measurements.clients.started,
  'client lifecycle counts are impossible');
  assert(measurements.fetchContinuity.misses <= measurements.fetchContinuity.opportunities
    && measurements.fetchContinuity.successfulMediaFetches
      <= measurements.fetchContinuity.opportunities,
  'fetch continuity counts are impossible');
  validateHistogram(measurements.latencyMs.all, measurements.requests.total, 'all latency');
  validateHistogram(
    measurements.latencyMs.manifest,
    measurements.requests.byKind.manifest,
    'manifest latency',
  );
  validateHistogram(
    measurements.latencyMs.segment,
    measurements.requests.byKind.segment,
    'segment latency',
  );
  validateHistogram(measurements.latencyMs.queue, measurements.requests.total, 'queue latency');
  if (evidence.target.environment === 'staging') {
    assert(evidence.generator?.role === GENERATOR_ROLE && evidence.generator?.explicitlyExternal === true,
      'staging shard evidence must come from an explicit external generator');
    assert(Number.isFinite(evidence.generator.measuredClockOffsetMs)
      && Math.abs(evidence.generator.measuredClockOffsetMs)
        <= evidence.plan.target.limits.maxClockOffsetMs,
    'staging shard clock offset exceeds its plan');
  }
  if (evidence.status === 'PASS') {
    assert(evidence.termination?.reason === 'completed', 'PASS shard did not complete normally');
    assert(measurements.requests.total > 0
      && measurements.requests.errorRate <= evidence.thresholds.maxErrorRate,
    'PASS shard exceeds request error threshold');
    assert(measurements.fetchContinuity.fetchMissRate <= evidence.thresholds.maxFetchMissRate,
      'PASS shard exceeds fetch miss threshold');
    assert(measurements.latencyMs.manifest.p95UpperBoundMs !== null
      && measurements.latencyMs.segment.p95UpperBoundMs !== null
      && measurements.latencyMs.manifest.p95UpperBoundMs
        <= evidence.thresholds.maxManifestP95Ms
      && measurements.latencyMs.segment.p95UpperBoundMs
        <= evidence.thresholds.maxSegmentP95Ms,
    'PASS shard exceeds latency threshold');
    assert(measurements.clients.completed === measurements.clients.planned
      && measurements.clients.generatorScheduleMisses === 0,
    'PASS shard has incomplete clients or schedule misses');
    assert((measurements.rollingWindows.worstRequestErrorRate === null
      || measurements.rollingWindows.worstRequestErrorRate
        <= evidence.thresholds.maxRollingErrorRate)
      && (measurements.rollingWindows.worstFetchMissRate === null
        || measurements.rollingWindows.worstFetchMissRate
          <= evidence.thresholds.maxRollingFetchMissRate),
    'PASS shard exceeds a rolling-window threshold');
  }
}

export function aggregateEvidence(entries) {
  assert(Array.isArray(entries) && entries.length > 0, 'at least one shard evidence file is required');
  const first = entries[0].evidence;
  validateShardEvidence(first);
  const shardCount = first.plan?.shardCount;
  assert(Number.isInteger(shardCount) && entries.length === shardCount,
    'evidence count must equal shardCount');
  const seen = new Set();
  for (const { evidence, sha256: sourceDigest } of entries) {
    assert(/^[a-f0-9]{64}$/.test(sourceDigest), 'source evidence SHA-256 is invalid');
    validateShardEvidence(evidence);
    assert(evidence.runId === first.runId && evidence.plan?.planHash === first.plan?.planHash,
      'shard evidence does not share one deterministic plan');
    assert(evidence.plan.shardCount === shardCount, 'shardCount differs between evidence files');
    assert(sameValue(evidence.plan, first.plan), 'public plan differs between shards');
    assert(sameValue(evidence.target, first.target), 'actual target differs between shards');
    assert(sameValue(evidence.thresholds, first.thresholds), 'thresholds differ between shards');
    assert(sameValue(evidence.inputs, first.inputs), 'input/confirmation hashes differ between shards');
    const index = evidence.shard?.index;
    assert(Number.isInteger(index) && index >= 0 && index < shardCount && !seen.has(index),
      'shard indices must be unique and complete');
    seen.add(index);
  }
  const measurements = {
    clients: { planned: 0, started: 0, completed: 0, generatorScheduleMisses: 0 },
    requests: { total: 0, successful: 0, failed: 0, byKind: {}, errorsByCategory: {}, httpStatus: {} },
    bytes: { total: 0, manifest: 0, segment: 0 },
    fetchContinuity: { opportunities: 0, successfulMediaFetches: 0, misses: 0, missesByCategory: {} },
    manifest: { samples: 0, sequenceRegressions: 0, windowMisses: 0 },
    latencyMs: {},
    rollingWindows: {
      seconds: first.measurements.rollingWindows.seconds,
      sampled: 0,
      eligibleRequestWindows: 0,
      eligibleFetchWindows: 0,
      worstRequestErrorRate: null,
      worstFetchMissRate: null,
    },
  };
  for (const { evidence } of entries) {
    const current = evidence.measurements;
    measurements.clients.planned += current.clients.planned;
    measurements.clients.started += current.clients.started;
    measurements.clients.completed += current.clients.completed;
    measurements.clients.generatorScheduleMisses += current.clients.generatorScheduleMisses;
    measurements.requests.total += current.requests.total;
    measurements.requests.successful += current.requests.successful;
    measurements.requests.failed += current.requests.failed;
    addObjects(measurements.requests.byKind, current.requests.byKind);
    addObjects(measurements.requests.errorsByCategory, current.requests.errorsByCategory);
    addObjects(measurements.requests.httpStatus, current.requests.httpStatus);
    measurements.bytes.total += current.bytes.total;
    measurements.bytes.manifest += current.bytes.manifest;
    measurements.bytes.segment += current.bytes.segment;
    measurements.fetchContinuity.opportunities += current.fetchContinuity.opportunities;
    measurements.fetchContinuity.successfulMediaFetches += current.fetchContinuity.successfulMediaFetches;
    measurements.fetchContinuity.misses += current.fetchContinuity.misses;
    addObjects(
      measurements.fetchContinuity.missesByCategory,
      current.fetchContinuity.missesByCategory,
    );
    measurements.manifest.samples += current.manifest.samples;
    measurements.manifest.sequenceRegressions += current.manifest.sequenceRegressions;
    measurements.manifest.windowMisses += current.manifest.windowMisses;
    measurements.rollingWindows.sampled += current.rollingWindows.sampled;
    measurements.rollingWindows.eligibleRequestWindows += current.rollingWindows.eligibleRequestWindows;
    measurements.rollingWindows.eligibleFetchWindows += current.rollingWindows.eligibleFetchWindows;
    for (const field of ['worstRequestErrorRate', 'worstFetchMissRate']) {
      if (current.rollingWindows[field] !== null) {
        measurements.rollingWindows[field] = measurements.rollingWindows[field] === null
          ? current.rollingWindows[field]
          : Math.max(measurements.rollingWindows[field], current.rollingWindows[field]);
      }
    }
  }
  for (const kind of ['all', 'manifest', 'segment', 'queue']) {
    measurements.latencyMs[kind] = summarizeLatency(mergeLatencyHistograms(
      entries.map(({ evidence }) => evidence.measurements.latencyMs[kind]),
    ));
  }
  const errorRate = measurements.requests.total
    ? measurements.requests.failed / measurements.requests.total
    : 1;
  const fetchMissRate = measurements.fetchContinuity.opportunities
    ? measurements.fetchContinuity.misses / measurements.fetchContinuity.opportunities
    : 1;
  const passed = entries.every(({ evidence }) => evidence.status === 'PASS')
    && measurements.requests.total > 0
    && errorRate <= first.thresholds.maxErrorRate
    && fetchMissRate <= first.thresholds.maxFetchMissRate
    && measurements.clients.completed === measurements.clients.planned
    && measurements.clients.generatorScheduleMisses === 0
    && measurements.latencyMs.manifest.p95UpperBoundMs !== null
    && measurements.latencyMs.segment.p95UpperBoundMs !== null
    && measurements.latencyMs.manifest.p95UpperBoundMs <= first.thresholds.maxManifestP95Ms
    && measurements.latencyMs.segment.p95UpperBoundMs <= first.thresholds.maxSegmentP95Ms
    && (measurements.rollingWindows.worstRequestErrorRate === null
      || measurements.rollingWindows.worstRequestErrorRate <= first.thresholds.maxRollingErrorRate)
    && (measurements.rollingWindows.worstFetchMissRate === null
      || measurements.rollingWindows.worstFetchMissRate <= first.thresholds.maxRollingFetchMissRate);
  return assertRedactedEvidence({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: `${EVIDENCE_KIND}-aggregate`,
    runId: first.runId,
    status: passed ? 'PASS' : 'FAIL',
    generatedAt: new Date().toISOString(),
    target: first.target,
    plan: first.plan,
    thresholds: first.thresholds,
    sourceShards: entries
      .map(({ sha256: digest, evidence }) => ({ index: evidence.shard.index, sha256: digest }))
      .sort((a, b) => a.index - b.index),
    measurements: {
      ...measurements,
      requests: { ...measurements.requests, errorRate },
      fetchContinuity: { ...measurements.fetchContinuity, fetchMissRate },
    },
    redactionChecked: true,
  });
}
