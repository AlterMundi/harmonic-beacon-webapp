// Inert genesis admission contracts only. No observation, execution or host attestation.
import { canonicalize } from './release-manifest.mjs';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const HEX = /^[0-9a-f]{64}$/u;
const GIT = /^[0-9a-f]{40}$/u;
const SERVICES = ['app', 'commerce-reconciler', 'tapestry', 'playlist-bot', 'postgres', 'livekit'];
const DEPENDENCIES = { postgres: 'docker.io/library/postgres', livekit: 'docker.io/livekit/livekit-server' };
const fail = label => { throw Error(`genesis contract: ${label}`); };
const equal = (a, b, label) => { if (canonicalize(a) !== canonicalize(b)) fail(label); };
function closed(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label);
  equal(Object.keys(value).sort(), [...fields].sort(), `${label} fields`);
}
function text(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(label);
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('timestamp');
  return Date.parse(value);
}
function fresh(value, now, age) {
  const time = timestamp(value);
  if (!Number.isSafeInteger(now) || time > now || now - time > age) fail('stale/future observation');
  return time;
}
function decode(bytes) {
  if ((!Buffer.isBuffer(bytes) && typeof bytes !== 'string') || Buffer.byteLength(bytes) > 1048576) fail('byte limit');
  const value = JSON.parse(bytes);
  if (!Buffer.from(bytes).equals(Buffer.from(canonicalize(value)))) fail('noncanonical input');
  return value;
}
function publication(value) {
  closed(value, ['generation', 'id', 'manifestSha256'], 'publication');
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) fail('publication generation');
  text(value.id, HEX, 'publication id');
  text(value.manifestSha256, HEX, 'publication manifest hash');
}

/** Reported public fields + private projection commitment; root MUST recompute before effects. */
export function validateLegacyObservation(bytes, { now = Date.now() } = {}) {
  const o = decode(bytes);
  closed(o, ['schemaVersion', 'host', 'observedAt', 'implementationSha256', 'profileSha256', 'gateState', 'services', 'configCommitment', 'boundary', 'reportedAppGitSha'], 'observation');
  if (o.schemaVersion !== 'harmonic-beacon.legacy-observation.v1' || o.host !== 'mona') fail('observation identity');
  fresh(o.observedAt, now, 900000);
  for (const key of ['implementationSha256', 'profileSha256', 'configCommitment']) text(o[key], DIGEST, key);
  closed(o.gateState, ['genesisId', 'permitSha256', 'ledgerSha256', 'publication'], 'gateState');
  text(o.gateState.genesisId, HEX, 'genesisId');
  text(o.gateState.permitSha256, DIGEST, 'permitSha256');
  if (o.gateState.ledgerSha256 === null || o.gateState.publication === null) {
    if (o.gateState.ledgerSha256 !== null || o.gateState.publication !== null) fail('partial initial gate state');
  } else {
    text(o.gateState.ledgerSha256, DIGEST, 'ledgerSha256');
    publication(o.gateState.publication);
  }
  closed(o.services, SERVICES, 'services');
  for (const [service, s] of Object.entries(o.services)) {
    closed(s, ['containerId', 'configuredImage', 'imageId', 'platform', 'composeProject', 'effectiveConfigSha256', 'sourceIdentity', 'dependencyResolution'], 'service');
    text(s.containerId, HEX, 'containerId');
    // Inert Docker image spelling, never a command, pathname or execution recipe.
    text(s.configuredImage, /^(?:sha256:[0-9a-f]{64}|[a-z0-9][a-z0-9._/-]{0,190}(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}|@sha256:[0-9a-f]{64})?)$/u, 'configuredImage');
    text(s.imageId, DIGEST, 'imageId');
    text(s.effectiveConfigSha256, DIGEST, 'effectiveConfigSha256');
    text(s.composeProject, /^[a-z0-9][a-z0-9_-]{0,62}$/u, 'composeProject');
    if (s.platform !== 'linux/amd64') fail('platform');
    equal(s.sourceIdentity, { kind: 'unknown' }, 'legacy source is unknown');
    if (Object.hasOwn(DEPENDENCIES, service)) {
      const d = s.dependencyResolution;
      closed(d, ['indexRef', 'platformManifestDigest', 'imageId'], 'dependencyResolution');
      if (typeof d.indexRef !== 'string' || !d.indexRef.startsWith(`${DEPENDENCIES[service]}@`)) fail('dependency repository');
      text(d.indexRef.slice(DEPENDENCIES[service].length + 1), DIGEST, 'dependency index');
      text(d.platformManifestDigest, DIGEST, 'dependency platform manifest');
      if (d.imageId !== s.imageId) fail('dependency image ID mismatch');
    } else if (s.dependencyResolution !== null) fail('first-party dependency resolution');
  }
  equal(o.boundary, { readiness: 'passed', privateBoundary: 'passed', liveDatabaseSessions: 0, realLivekitParticipants: 0, publishedUserAudioTracks: 0 }, 'reported readiness/boundary');
  if (o.reportedAppGitSha !== null) text(o.reportedAppGitSha, GIT, 'reported app SHA');
  return o;
}

function runBinding(value) {
  for (const key of ['candidateRunId', 'deliveryRunId']) text(value[key], /^[1-9][0-9]{0,19}$/u, key);
  for (const key of ['candidateRunAttempt', 'deliveryRunAttempt']) {
    if (!Number.isSafeInteger(value[key]) || value[key] < 1 || value[key] > 9999999999) fail(key);
  }
  for (const key of ['sourceSha', 'sourceTree', 'authorizerSourceSha', 'authorizerSourceTree']) text(value[key], GIT, key);
  text(value.manifestSha256, HEX, 'manifestSha256');
  if (value.workflowPath !== '.github/workflows/oci-promote.yml' || value.workflowRef !== 'refs/heads/main') fail('workflow identity');
}
function expectations(value, expected) {
  for (const [key, item] of Object.entries(expected)) {
    if (!Object.hasOwn(value, key)) fail('unknown expectation');
    equal(value[key], item, `${key} mismatch`);
  }
}

/** Admission only: no allowExpired switch. Durable continuation belongs to the future root ledger. */
export function validateGenesisAuthorization(bytes, expected = {}, { now = Date.now() } = {}) {
  const a = decode(bytes);
  closed(a, ['schemaVersion', 'host', 'genesisId', 'operation', 'target', 'workflowPath', 'workflowRef', 'environment',
    'deliveryRunId', 'deliveryRunAttempt', 'candidateRunId', 'candidateRunAttempt', 'sourceSha', 'sourceTree',
    'authorizerSourceSha', 'authorizerSourceTree', 'manifestSha256', 'configSha256',
    'legacyObservationSha256', 'legacyRuntimeSha256', 'profileSha256', 'implementationSha256', 'hostedRehearsalSha256',
    'expectedPublication', 'expectedLedgerSha256', 'permitSha256', 'verbs', 'authorizedAt', 'expiresAt'], 'authorization');
  if (a.schemaVersion !== 'harmonic-beacon.genesis-authorization.v1' || a.host !== 'mona' || a.target !== 'production' || a.environment !== 'production') fail('authorization identity');
  if (!['genesis', 'genesis-recover', 'genesis-forward-repair'].includes(a.operation)) fail('operation');
  runBinding(a);
  text(a.genesisId, HEX, 'genesisId');
  for (const key of ['configSha256', 'legacyObservationSha256', 'legacyRuntimeSha256', 'profileSha256', 'implementationSha256', 'hostedRehearsalSha256', 'permitSha256']) text(a[key], DIGEST, key);
  if (a.operation === 'genesis') {
    if (a.sourceSha !== a.authorizerSourceSha || a.sourceTree !== a.authorizerSourceTree) fail('genesis authorizer source');
    if (a.expectedPublication !== null || a.expectedLedgerSha256 !== null) fail('genesis requires absent publication AND ledger');
  } else {
    publication(a.expectedPublication);
    if (a.expectedPublication.manifestSha256 !== a.manifestSha256) fail('recovery cannot overwrite a successor');
    text(a.expectedLedgerSha256, DIGEST, 'expectedLedgerSha256');
  }
  equal(a.verbs, a.operation === 'genesis-recover' ? ['prepare', 'recover', 'status'] : ['prepare', 'apply', 'status', 'recover'], 'verbs');
  const start = timestamp(a.authorizedAt), end = timestamp(a.expiresAt);
  if (!Number.isSafeInteger(now) || start > now || end <= start || end - start > 900000 || end <= now) fail('stale/future authorization');
  expectations(a, expected);
  return a;
}

/** Signed summary commitments, not an executor or a claim about Mona's historical binaries. */
export function validateGenesisRehearsal(bytes, expected = {}, { now = Date.now() } = {}) {
  const r = decode(bytes);
  closed(r, ['schemaVersion', 'scope', 'environment', 'workflowPath', 'workflowRef', 'manifestSha256', 'sourceSha', 'sourceTree',
    'authorizerSourceSha', 'authorizerSourceTree',
    'candidateRunId', 'candidateRunAttempt', 'deliveryRunId', 'deliveryRunAttempt', 'implementationSha256', 'profileSha256', 'harnessSha256',
    'fixtureIdentity', 'stages', 'failureRecovery', 'startedAt', 'completedAt', 'issuedAt', 'result'], 'rehearsal');
  if (r.schemaVersion !== 'harmonic-beacon.genesis-rehearsal.v1' || r.scope !== 'hosted-mechanics' || r.environment !== 'shadow' || r.result !== 'success') fail('rehearsal scope/result');
  runBinding(r);
  for (const key of ['implementationSha256', 'profileSha256', 'harnessSha256']) text(r[key], DIGEST, key);
  closed(r.fixtureIdentity, ['kind', 'id'], 'fixtureIdentity');
  if (r.fixtureIdentity.kind !== 'synthetic-six-service') fail('fixture kind');
  text(r.fixtureIdentity.id, HEX, 'fixture id');
  const start = timestamp(r.startedAt), end = timestamp(r.completedAt), issued = fresh(r.issuedAt, now, 86400000);
  if (end <= start || issued < end || issued - start > 3600000) fail('rehearsal time window');
  if (!Array.isArray(r.stages) || r.stages.length !== 3) fail('stage sequence');
  let previousEnd = start;
  const measured = (value, keys) => {
    closed(value, [...keys, 'commandReceiptSha256', 'outputReceiptSha256', 'runtimeReceiptSha256', 'startedAt', 'completedAt', 'result'], 'measurement');
    for (const key of ['commandReceiptSha256', 'outputReceiptSha256', 'runtimeReceiptSha256']) text(value[key], DIGEST, key);
    const began = timestamp(value.startedAt), completed = timestamp(value.completedAt);
    if (value.result !== 'success' || began < previousEnd || completed <= began || completed > end) fail('measurement result/order');
    previousEnd = completed;
  };
  for (const [index, [stage, from, to]] of [
    ['adopt', 'legacy-shaped', 'genesis'], ['recover', 'genesis', 'legacy-shaped'], ['forward-repair', 'legacy-shaped', 'genesis'],
  ].entries()) {
    const s = r.stages[index];
    measured(s, ['stage', 'from', 'to']);
    equal([s.stage, s.from, s.to], [stage, from, to], 'stage sequence');
  }
  measured(r.failureRecovery, ['scenario']);
  if (r.failureRecovery.scenario !== 'interrupted-adoption') fail('failure recovery scenario');
  expectations(r, expected);
  return r;
}
