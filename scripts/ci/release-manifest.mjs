#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, readSync, writeFileSync, unlinkSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const SHA256 = /^[0-9a-f]{64}$/u;
const GIT_ID = /^[0-9a-f]{40}$/u;
const RUN_ID = /^[1-9][0-9]{0,19}$/u;
const PLATFORM = 'linux/amd64';
const SOURCE_REPOSITORY = 'AlterMundi/harmonic-beacon-webapp';
const WORKFLOW_PATH = '.github/workflows/oci-candidate.yml';
const WORKFLOW_REF = 'refs/heads/main';
const WORKFLOW_IDENTITY = `https://github.com/${SOURCE_REPOSITORY}/${WORKFLOW_PATH}@${WORKFLOW_REF}`;
const ARTIFACTS = new Map([
  ['app', 'ghcr.io/altermundi/harmonic-beacon-app'],
  ['tapestry', 'ghcr.io/altermundi/harmonic-beacon-tapestry'],
  ['playlist-bot', 'ghcr.io/altermundi/harmonic-beacon-playlist-bot'],
  ['analytics', 'ghcr.io/altermundi/harmonic-beacon-analytics'],
]);
const EXTERNAL_IMAGES = new Map([
  ['postgres', 'docker.io/library/postgres'],
  ['livekit', 'docker.io/livekit/livekit-server'],
]);
const APP_ROLES = ['app', 'commerce-reconciler', 'migrate'];

function fail(message) {
  throw new Error(`release manifest: ${message}`);
}

function fileIdentity(stat) {
  return [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

export function admitRegularFile(source, output, { expectedSha256, maximumBytes, signatureBundle = false }) {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > 64 * 1024 * 1024) {
    fail('invalid admission byte limit');
  }
  if (!signatureBundle) digest(expectedSha256, 'admission source');
  let before;
  try { before = lstatSync(source, { bigint: true }); } catch { fail('unsafe admission source'); }
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n ||
      before.size < 1n || before.size > BigInt(maximumBytes)) fail('unsafe admission source');
  let fd;
  try {
    fd = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.nlink !== 1n || fileIdentity(opened) !== fileIdentity(before)) {
      fail('admission source changed while opening');
    }
    const buffer = Buffer.alloc(Number(opened.size) + 1);
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, count);
    const after = fstatSync(fd, { bigint: true });
    if (fileIdentity(after) !== fileIdentity(opened) || bytes.length !== Number(after.size)) {
      fail('admission source changed while reading');
    }
    const actual = publicConfigSha256(bytes);
    if (!signatureBundle && actual !== expectedSha256) fail('admission source digest mismatch');
    let destination;
    try {
      destination = openSync(output, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      writeFileSync(destination, bytes);
    } catch (error) {
      if (destination !== undefined) unlinkSync(output);
      throw error;
    } finally {
      if (destination !== undefined) closeSync(destination);
    }
    return actual;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function object(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  return value;
}

function exactKeys(value, label, keys) {
  object(value, label);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) if (!allowed.has(key)) fail(`${label} has unknown field: ${key}`);
  for (const key of keys) if (!(key in value)) fail(`${label} is missing ${key}`);
}

function string(value, label, pattern) {
  if (typeof value !== 'string' || !value || (pattern && !pattern.test(value))) fail(`invalid ${label}`);
}

function integer(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`invalid ${label}`);
}

function date(value, label) {
  string(value, label);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) fail(`invalid ${label}`);
  return parsed;
}

function digest(value, label) {
  string(value, `${label} digest`, DIGEST);
}

function sha256(value, label) {
  string(value, `${label} SHA-256`, SHA256);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  fail('canonical JSON contains an unsupported value');
}

export function canonicalize(value) {
  return `${JSON.stringify(stableValue(value))}\n`;
}

export function canonicalSha256(value) {
  return createHash('sha256').update(canonicalize(value)).digest('hex');
}

/** Canonical public-config digest: SHA-256 over the exact checked-in file bytes. */
export function publicConfigSha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

export function candidateIdentitySha256(manifest) {
  const candidate = structuredClone(manifest);
  delete candidate.qualification;
  return canonicalSha256(candidate);
}

export function validateCandidateManifest(candidate) {
  if (candidate?.qualification !== undefined) fail('candidate must not contain qualification');
  const qualifiedAt = date(candidate?.build?.createdAt, 'build.createdAt').toISOString();
  const expiresAt = new Date(new Date(qualifiedAt).valueOf() + 60 * 60 * 1000).toISOString();
  const complete = {
    ...structuredClone(candidate),
    qualification: {
      runId: candidate.build.workflowRunId,
      runAttempt: candidate.build.workflowRunAttempt,
      result: 'success',
      qualifiedAt,
      expiresAt,
      candidateIdentitySha256: candidateIdentitySha256(candidate),
      receiptSha256: `sha256:${'0'.repeat(64)}`,
    },
  };
  validateReleaseManifest(complete, { now: new Date(qualifiedAt) });
  return candidate;
}

export function assembleReleaseManifest(candidate, qualification) {
  if (candidate?.qualification !== undefined) fail('candidate must not contain qualification');
  const manifest = structuredClone(candidate);
  manifest.qualification = structuredClone(qualification);
  const identity = candidateIdentitySha256(manifest);
  if (manifest.qualification.candidateIdentitySha256 && manifest.qualification.candidateIdentitySha256 !== identity) {
    fail('qualification is bound to a different candidate identity');
  }
  manifest.qualification.candidateIdentitySha256 = identity;
  return validateReleaseManifest(manifest);
}

function validateSupplyChain(entry, label) {
  exactKeys(entry.sbom, `${label}.sbom`, ['format', 'digest', 'signatureBundleDigest']);
  if (entry.sbom.format !== 'spdx-json') fail(`${label} SBOM format must be spdx-json`);
  digest(entry.sbom.digest, `${label} SBOM`);
  digest(entry.sbom.signatureBundleDigest, `${label} SBOM signature bundle`);

  exactKeys(entry.provenance, `${label}.provenance`, ['predicateType', 'digest', 'signatureBundleDigest']);
  if (entry.provenance.predicateType !== 'https://slsa.dev/provenance/v1') {
    fail(`${label} provenance predicate is unsupported`);
  }
  digest(entry.provenance.digest, `${label} provenance`);
  digest(entry.provenance.signatureBundleDigest, `${label} provenance signature bundle`);

  exactKeys(entry.signature, `${label}.signature`, ['issuer', 'identity', 'bundleDigest']);
  if (entry.signature.issuer !== 'https://token.actions.githubusercontent.com') fail(`${label} signature issuer is not trusted`);
  if (entry.signature.identity !== WORKFLOW_IDENTITY) fail(`${label} signature identity is not trusted`);
  digest(entry.signature.bundleDigest, `${label} signature bundle`);
}

function validateArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) fail('artifacts must contain the complete first-party release set');
  const seen = new Set();
  for (const entry of artifacts) {
    exactKeys(entry, 'artifact', [
      'artifactId', 'repository', 'digest', 'platform', 'context', 'dockerfile',
      'roles', 'evidenceRecordDigest', 'sbom', 'provenance', 'signature',
    ]);
    const expectedRepository = ARTIFACTS.get(entry.artifactId);
    if (!expectedRepository || seen.has(entry.artifactId)) fail(`invalid or duplicate artifact: ${entry.artifactId}`);
    seen.add(entry.artifactId);
    if (entry.repository !== expectedRepository) fail(`${entry.artifactId} repository is not allowlisted`);
    digest(entry.digest, `${entry.artifactId} image`);
    if (entry.platform !== PLATFORM) fail(`${entry.artifactId} platform must be ${PLATFORM}`);
    const expectedDockerfile = entry.artifactId === 'app' ? 'Dockerfile' : `services/${entry.artifactId}/Dockerfile`;
    if (entry.context !== '.' || entry.dockerfile !== expectedDockerfile) fail(`${entry.artifactId} build inputs do not match the allowlist`);
    if (!Array.isArray(entry.roles) || entry.roles.some((role) => typeof role !== 'string')) fail(`${entry.artifactId} roles are invalid`);
    if (entry.artifactId === 'app' && JSON.stringify([...entry.roles].sort()) !== JSON.stringify(APP_ROLES)) {
      fail('app roles must bind app, migrate, and commerce-reconciler to one digest');
    }
    digest(entry.evidenceRecordDigest, `${entry.artifactId} evidence record`);
    validateSupplyChain(entry, entry.artifactId);
  }
  for (const id of ARTIFACTS.keys()) if (!seen.has(id)) fail(`missing artifact: ${id}`);
}

function validateExternalImages(images) {
  if (!Array.isArray(images) || images.length !== EXTERNAL_IMAGES.size) fail('external images are incomplete');
  const seen = new Set();
  for (const entry of images) {
    exactKeys(entry, 'external image', ['serviceId', 'repository', 'digest', 'platform']);
    const repository = EXTERNAL_IMAGES.get(entry.serviceId);
    if (!repository || seen.has(entry.serviceId)) fail(`invalid or duplicate external image: ${entry.serviceId}`);
    seen.add(entry.serviceId);
    if (entry.repository !== repository) fail(`${entry.serviceId} external repository is not allowlisted`);
    digest(entry.digest, `${entry.serviceId} external image`);
    if (entry.platform !== PLATFORM) fail(`${entry.serviceId} platform must be ${PLATFORM}`);
  }
}

export function validateReleaseManifest(manifest) {
  exactKeys(manifest, 'root', [
    'schemaVersion', 'source', 'build', 'artifacts', 'externalImages', 'migrationSet',
    'publicConfig', 'configProfiles', 'deploymentInputs', 'promotion', 'rollback', 'qualification',
  ]);
  if (manifest.schemaVersion !== 'harmonic-beacon.release.v1') fail('unsupported schemaVersion');

  exactKeys(manifest.source, 'source', ['repository', 'gitSha', 'gitTree']);
  if (manifest.source.repository !== SOURCE_REPOSITORY) fail('source repository is not allowlisted');
  string(manifest.source.gitSha, 'source SHA', GIT_ID);
  string(manifest.source.gitTree, 'source tree', GIT_ID);

  exactKeys(manifest.build, 'build', [
    'workflowRunId', 'workflowRunAttempt', 'workflowPath', 'workflowRef', 'createdAt',
    'dependencyLockSha256', 'buildDefinitionSha256', 'runtimePolicySha256',
  ]);
  string(manifest.build.workflowRunId, 'workflow run id', RUN_ID);
  integer(manifest.build.workflowRunAttempt, 'workflow run attempt');
  if (manifest.build.workflowPath !== WORKFLOW_PATH || manifest.build.workflowRef !== WORKFLOW_REF) {
    fail('build workflow identity is not trusted');
  }
  date(manifest.build.createdAt, 'build creation time');
  digest(manifest.build.dependencyLockSha256, 'dependency lock');
  digest(manifest.build.buildDefinitionSha256, 'build definition');
  digest(manifest.build.runtimePolicySha256, 'runtime policy');

  validateArtifacts(manifest.artifacts);
  validateExternalImages(manifest.externalImages);

  exactKeys(manifest.migrationSet, 'migrationSet', ['head', 'sha256']);
  string(manifest.migrationSet.head, 'migration head', /^[0-9]{14}_[a-z0-9_]+$/u);
  digest(manifest.migrationSet.sha256, 'migration set');

  exactKeys(manifest.publicConfig, 'publicConfig', ['strategy', 'schemaSha256']);
  if (manifest.publicConfig.strategy !== 'server-token-response') fail('public config strategy is unsupported');
  digest(manifest.publicConfig.schemaSha256, 'public config schema');

  exactKeys(manifest.configProfiles, 'configProfiles', ['live-staging', 'production']);
  for (const target of ['live-staging', 'production']) {
    exactKeys(manifest.configProfiles[target], `configProfiles.${target}`, ['sha256']);
    digest(manifest.configProfiles[target].sha256, `${target} config profile`);
  }

  exactKeys(manifest.deploymentInputs, 'deploymentInputs', ['composeSha256', 'overlaySha256']);
  digest(manifest.deploymentInputs.composeSha256, 'Compose input');
  digest(manifest.deploymentInputs.overlaySha256, 'OCI overlay input');

  exactKeys(manifest.promotion, 'promotion', ['baseManifestSha256']);
  sha256(manifest.promotion.baseManifestSha256, 'promotion base manifest');
  exactKeys(manifest.rollback, 'rollback', ['manifestSha256']);
  sha256(manifest.rollback.manifestSha256, 'rollback manifest');
  if (manifest.rollback.manifestSha256 !== manifest.promotion.baseManifestSha256) {
    fail('rollback manifest must equal promotion base manifest');
  }

  exactKeys(manifest.qualification, 'qualification', [
    'runId', 'runAttempt', 'result', 'qualifiedAt', 'expiresAt',
    'candidateIdentitySha256', 'receiptSha256',
  ]);
  string(manifest.qualification.runId, 'qualification run id', RUN_ID);
  integer(manifest.qualification.runAttempt, 'qualification run attempt');
  if (manifest.qualification.result !== 'success') fail('qualification result must be success');
  const qualifiedAt = date(manifest.qualification.qualifiedAt, 'qualification time');
  const expiresAt = date(manifest.qualification.expiresAt, 'qualification expiry');
  if (expiresAt <= qualifiedAt) fail('qualification expiry must follow qualification time');
  // Qualification is a daily admission credential, never a renewable release lease.
  if (expiresAt - qualifiedAt > 86_400_000) fail('qualification lifetime exceeds 24 hours');
  sha256(manifest.qualification.candidateIdentitySha256, 'candidate identity');
  digest(manifest.qualification.receiptSha256, 'qualification receipt');
  if (manifest.qualification.runId !== manifest.build.workflowRunId ||
      manifest.qualification.runAttempt !== manifest.build.workflowRunAttempt) {
    fail('qualification run identity or attempt does not match the build');
  }
  if (manifest.qualification.candidateIdentitySha256 !== candidateIdentitySha256(manifest)) {
    fail('candidate identity does not bind the manifest');
  }
  return manifest;
}

export function validatePublication(value) {
  exactKeys(value, 'publication', ['generation', 'id', 'manifestSha256']);
  if (!Number.isSafeInteger(value.generation) || value.generation < 1) fail('invalid publication generation');
  sha256(value.id, 'publication identity');
  sha256(value.manifestSha256, 'publication manifest');
  return value;
}
export function nextPublication(current, manifestSha256) {
  validatePublication(current);
  return validatePublication({ generation: current.generation + 1, id: randomBytes(32).toString('hex'), manifestSha256 });
}
function samePublication(a, b) {
  validatePublication(a); validatePublication(b);
  return a.generation === b.generation && a.id === b.id && a.manifestSha256 === b.manifestSha256;
}

// Historical live state must remain valid after qualification expires. Admission
// freshness is checked separately; the full qualified manifest is still closed.
export function validateCurrentState(state) {
  exactKeys(state, 'current state', ['schemaVersion', 'laneState', 'manifestSha256',
    'manifestBase64', 'composeBase64', 'overlayBase64', 'publicConfigBase64', 'publication']);
  if (state.schemaVersion !== 'harmonic-beacon.current-state.v4') fail('unsupported current release state');
  if (state.laneState !== 'oci-production') fail('invalid live high-water lane');
  sha256(state.manifestSha256, 'current manifest');
  validatePublication(state.publication);
  if (state.publication.manifestSha256 !== state.manifestSha256) fail('publication manifest mismatch');
  const decoded = {};
  for (const field of ['manifestBase64', 'composeBase64', 'overlayBase64', 'publicConfigBase64']) {
    const encoded = state[field];
    string(encoded, field, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u);
    const bytes = Buffer.from(encoded, 'base64');
    if (bytes.toString('base64') !== encoded) fail(`invalid canonical base64: ${field}`);
    decoded[field] = bytes;
  }
  if (publicConfigSha256(decoded.manifestBase64) !== `sha256:${state.manifestSha256}`) fail('current manifest and high-water are contradictory');
  const manifest = validateReleaseManifest(JSON.parse(decoded.manifestBase64.toString('utf8')));
  for (const [field, expected] of [
    ['composeBase64', manifest.deploymentInputs.composeSha256],
    ['overlayBase64', manifest.deploymentInputs.overlaySha256],
    ['publicConfigBase64', manifest.configProfiles.production.sha256],
  ]) {
    if (publicConfigSha256(decoded[field]) !== expected) fail(`current state input mismatch: ${field}`);
  }
  validateRuntimePublicConfig(JSON.parse(decoded.publicConfigBase64.toString('utf8')));
  return decoded;
}

export function verifyReleaseManifest(manifest, expected) {
  validateReleaseManifest(manifest);
  if (!expected || typeof expected !== 'object') fail('verification expectations are required');
  if (manifest.source.repository !== expected.sourceRepository) fail('source repository mismatch');
  if (manifest.source.gitSha !== expected.sourceSha) fail('source SHA mismatch');
  if (manifest.source.gitTree !== expected.sourceTree) fail('source tree mismatch');
  if (manifest.build.workflowRunId !== expected.workflowRunId ||
      manifest.build.workflowRunAttempt !== expected.workflowRunAttempt ||
      manifest.qualification.runId !== expected.workflowRunId ||
      manifest.qualification.runAttempt !== expected.workflowRunAttempt) {
    fail('workflow run identity or attempt mismatch');
  }

  const target = expected.target === 'shadow' ? 'live-staging' : expected.target;
  if (!['live-staging', 'production'].includes(target)) fail('invalid promotion target');
  if (manifest.configProfiles[target].sha256 !== expected.targetConfigSha256) fail('config profile mismatch');
  if (manifest.promotion.baseManifestSha256 !== expected.currentBaseManifestSha256) fail('stale candidate base manifest');
  const now = new Date(expected.now ?? Date.now()).getTime();
  const qualifiedAt = Date.parse(manifest.qualification.qualifiedAt);
  if (!Number.isFinite(now)) fail('invalid verification time');
  if (qualifiedAt > now) fail('qualification is in the future');
  if (now - qualifiedAt > 86_400_000 || now >= Date.parse(manifest.qualification.expiresAt)) fail('qualification has expired');

  const evidence = object(expected.registryEvidence, 'registry evidence');
  const imageRefs = {};
  for (const entry of manifest.artifacts) {
    const actual = evidence[entry.artifactId];
    if (!actual) fail(`missing registry evidence for ${entry.artifactId}`);
    exactKeys(actual, `${entry.artifactId} registry evidence`, [
      'repository', 'imageDigest', 'sbomDigest', 'sbomSignatureBundleDigest',
      'provenanceDigest', 'provenanceSignatureBundleDigest', 'signatureBundleDigest',
    ]);
    if (actual.repository !== entry.repository || actual.imageDigest !== entry.digest) fail(`${entry.artifactId} image digest mismatch`);
    if (actual.sbomDigest !== entry.sbom.digest || actual.sbomSignatureBundleDigest !== entry.sbom.signatureBundleDigest) {
      fail(`${entry.artifactId} SBOM mismatch`);
    }
    if (actual.provenanceDigest !== entry.provenance.digest ||
        actual.provenanceSignatureBundleDigest !== entry.provenance.signatureBundleDigest) {
      fail(`${entry.artifactId} provenance mismatch`);
    }
    if (actual.signatureBundleDigest !== entry.signature.bundleDigest) fail(`${entry.artifactId} signature mismatch`);
    imageRefs[entry.artifactId] = `${entry.repository}@${entry.digest}`;
  }
  if (Object.keys(evidence).length !== manifest.artifacts.length) fail('unexpected registry evidence');

  const actualManifestSha256 = canonicalSha256(manifest);
  if (actualManifestSha256 !== expected.manifestSha256) fail('manifest SHA-256 mismatch');
  return { manifestSha256: actualManifestSha256, imageRefs };
}

const ACCEPTANCE_FIELDS = ['browser', 'syntheticSession', 'commerce', 'schema', 'isolation', 'restore'];
export function validateQualificationEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) ||
      JSON.stringify(Object.keys(evidence).sort()) !== JSON.stringify([...ACCEPTANCE_FIELDS].sort())) {
    fail('acceptance evidence fields are not closed');
  }
  for (const [key, fields] of Object.entries({
    browser: ['engine', 'passed', 'failed', 'skipped'],
    syntheticSession: ['created', 'authenticatedRole'],
    commerce: ['workerHeartbeatAgeMs', 'pending', 'processing'],
    schema: ['expectedHead', 'observedHead'],
    isolation: ['internalNetworks', 'forbiddenSecretNamesFound'],
    restore: ['backupSha256', 'backupBytes', 'restoredSessionCount'],
  })) exactKeys(evidence[key], key === 'syntheticSession' ? 'synthetic session' : key, fields);
  string(evidence.schema.expectedHead, 'schema head', /^[0-9]{14}_[a-z0-9_]+$/u);
  if (!Array.isArray(evidence.isolation.forbiddenSecretNamesFound)) fail('invalid secret isolation');
  // Isolated qualification has at most 10,000 tests/sessions/queue rows and
  // a 1 GiB logical backup; exceeding these budgets invalidates the drill.
  if (evidence.browser?.engine !== 'chromium' || !Number.isSafeInteger(evidence.browser.passed) || evidence.browser.passed > 10000 || evidence.browser.passed < 1 ||
      !Number.isSafeInteger(evidence.browser.failed) || evidence.browser.failed !== 0 ||
      !Number.isSafeInteger(evidence.browser.skipped) || evidence.browser.skipped !== 0) fail('browser acceptance did not pass without skips');
  if (!Number.isSafeInteger(evidence.syntheticSession?.created) || evidence.syntheticSession.created > 10000 || evidence.syntheticSession.created < 1 ||
      evidence.syntheticSession.authenticatedRole !== 'ADMIN') {
    fail('synthetic session acceptance is incomplete');
  }
  if (!Number.isSafeInteger(evidence.commerce?.workerHeartbeatAgeMs) || evidence.commerce.workerHeartbeatAgeMs < 0 ||
      evidence.commerce.workerHeartbeatAgeMs > 10_000 || !Number.isSafeInteger(evidence.commerce.pending) ||
      evidence.commerce.pending > 10000 || evidence.commerce.pending < 0 || !Number.isSafeInteger(evidence.commerce.processing) || evidence.commerce.processing > 10000 || evidence.commerce.processing < 0) {
    fail('commerce worker/backlog evidence is invalid');
  }
  if (!evidence.schema?.expectedHead || evidence.schema.observedHead !== evidence.schema.expectedHead) fail('schema head mismatch');
  if (JSON.stringify(evidence.isolation?.internalNetworks) !== JSON.stringify(['database', 'media']) ||
      evidence.isolation?.forbiddenSecretNamesFound?.length !== 0) fail('network or secret isolation failed');
  if (!/^sha256:[0-9a-f]{64}$/u.test(evidence.restore?.backupSha256 ?? '') ||
      !Number.isSafeInteger(evidence.restore.backupBytes) || evidence.restore.backupBytes > 1073741824 || evidence.restore.backupBytes < 1 ||
      !Number.isSafeInteger(evidence.restore.restoredSessionCount) || evidence.restore.restoredSessionCount > 10000 || evidence.restore.restoredSessionCount < 1) {
    fail('isolated backup restore evidence is invalid');
  }
  return evidence;
}

export function validateQualificationReceipt(receipt, manifest) {
  if (manifest?.qualification === undefined) validateCandidateManifest(manifest);
  else validateReleaseManifest(manifest);
  exactKeys(receipt, 'qualification receipt', ['schemaVersion', 'result', 'workflowRunId',
    'workflowRunAttempt', 'candidateIdentitySha256', 'imageRefs', 'checkedServices', 'acceptance',
    'qualificationJob', 'measurementStartedAt', 'measurementCompletedAt', 'issuedAt']);
  if (receipt.schemaVersion !== 'oci-qualification.v3' || receipt.result !== 'success' ||
      receipt.workflowRunId !== manifest.build.workflowRunId ||
      receipt.workflowRunAttempt !== manifest.build.workflowRunAttempt ||
      receipt.candidateIdentitySha256 !== candidateIdentitySha256(manifest)) fail('qualification candidate/run mismatch');
  if (receipt.qualificationJob !== 'qualify') fail('qualification job mismatch');
  const started = date(receipt.measurementStartedAt, 'measurement start');
  const completed = date(receipt.measurementCompletedAt, 'measurement completion');
  const issued = date(receipt.issuedAt, 'receipt issuance');
  if (started < Date.parse(manifest.build.createdAt) || completed <= started || issued < completed ||
      issued - started > 3_600_000) fail('qualification measurement time mismatch');
  if (manifest.qualification && (Date.parse(manifest.qualification.qualifiedAt) !== issued.getTime())) fail('qualification issuance mismatch');
  const entries = [...manifest.artifacts, ...manifest.externalImages];
  exactKeys(receipt.imageRefs, 'qualification image refs', entries.map(e => e.artifactId ?? e.serviceId));
  for (const entry of entries) {
    if (receipt.imageRefs[entry.artifactId ?? entry.serviceId] !== `${entry.repository}@${entry.digest}`) fail('qualification image mismatch');
  }
  const services = ['postgres', 'livekit', 'app', 'commerce-reconciler', 'tapestry', 'playlist-bot', 'analytics'];
  if (JSON.stringify(receipt.checkedServices) !== JSON.stringify(services)) fail('qualification services mismatch');
  validateQualificationEvidence(receipt.acceptance);
  if (receipt.acceptance.schema.expectedHead !== manifest.migrationSet.head) fail('qualification manifest schema mismatch');
  return receipt;
}

// These bytes are authenticated by the privileged caller before this parser runs.
export function validateDeliveryAuthorization(bytes, expected = {}, { now = Date.now(), allowExpired = false } = {}) {
  const a = JSON.parse(bytes);
  if (!Buffer.from(bytes).equals(Buffer.from(canonicalize(a)))) fail('noncanonical delivery authorization');
  exactKeys(a, 'delivery authorization', ['schemaVersion', 'sourceSha', 'sourceTree',
    'candidateManifestSha256', 'baseManifestSha256', 'candidateRunId', 'candidateRunAttempt',
    'deliveryRunId', 'deliveryRunAttempt', 'workflowPath', 'workflowRef', 'laneState',
    'environment', 'target', 'operation', 'configSha256', 'transitionAuthorizationSha256',
    'verbs', 'authorizedAt', 'expiresAt']);
  if (a.schemaVersion !== 'harmonic-beacon.delivery-authorization.v1' ||
      a.workflowPath !== '.github/workflows/oci-promote.yml' || a.workflowRef !== 'refs/heads/main') fail('invalid delivery workflow');
  for (const k of ['sourceSha', 'sourceTree']) string(a[k], k, /^[0-9a-f]{40}$/u);
  for (const k of ['candidateManifestSha256', 'baseManifestSha256']) string(a[k], k, /^[0-9a-f]{64}$/u);
  for (const k of ['candidateRunId', 'deliveryRunId']) string(a[k], k, /^[1-9][0-9]{0,19}$/u);
  for (const k of ['candidateRunAttempt', 'deliveryRunAttempt']) bounded(a[k], k, 9999999999, 1);
  digest(a.configSha256, 'delivery config');
  if (!['legacy-shadow:shadow:promote', 'oci-production:production:promote', 'oci-production:production:rollback']
    .includes(`${a.laneState}:${a.target}:${a.operation}`) || a.environment !== a.target) fail('invalid delivery target/operation');
  const verbs = a.operation === 'rollback' ? ['rollback'] : a.target === 'shadow' ? ['prepare', 'preflight', 'status'] : ['prepare', 'preflight', 'migrate', 'replace', 'status', 'rollback'];
  if (JSON.stringify(a.verbs) !== JSON.stringify(verbs)) fail('invalid delivery verbs');
  if (a.target === 'production' && a.operation === 'promote') digest(a.transitionAuthorizationSha256, 'delivery transition');
  else if (a.transitionAuthorizationSha256 !== null) fail('unexpected delivery transition');
  const start = +date(a.authorizedAt, 'delivery authorization time');
  const end = +date(a.expiresAt, 'delivery authorization expiry');
  if (!Number.isSafeInteger(now) || start > now || end <= start || end - start > 900000 || (!allowExpired && end <= now)) fail('stale delivery authorization');
  for (const [key, value] of Object.entries(expected)) {
    if (!(key in a) || canonicalize(a[key]) !== canonicalize(value)) fail(`delivery ${key} mismatch`);
  }
  return a;
}

function deliveryReceiptBinding(receipt) {
  return { sourceSha: receipt.sourceSha, sourceTree: receipt.sourceTree,
    candidateManifestSha256: receipt.manifestSha256, baseManifestSha256: receipt.baseManifestSha256,
    candidateRunId: receipt.workflowRunId, candidateRunAttempt: receipt.workflowRunAttempt,
    target: receipt.target, environment: receipt.target, configSha256: receipt.targetConfigSha256 };
}

export function validateDeliveryInvocation(receipt, { deliveryRunId, deliveryRunAttempt, target, verb, activeRunId = null, durableResume = 'none' }, now = Date.now()) {
  const rollback = receipt.rollbackDeliveryAuthorization;
  const a = rollback ?? receipt.deliveryAuthorization;
  if (!a) fail('missing persisted delivery authorization');
  const bytes = Buffer.from(canonicalize(a));
  if (publicConfigSha256(bytes) !== (rollback ? receipt.rollbackDeliveryAuthorizationSha256 : receipt.deliveryAuthorizationSha256)) fail('persisted delivery digest mismatch');
  const active = activeRunId === receipt.workflowRunId;
  const markerlessPrepared = durableResume === 'production-markerless-prepared' && activeRunId === null &&
    target === 'production' && verb === 'prepare' && receipt.target === 'production' && receipt.phase === 'prepared';
  const shadowedSourceCleanup = durableResume === 'shadowed-cleanup' && activeRunId === null &&
    target === 'shadow' && verb === 'status' && receipt.target === 'shadow' && receipt.phase === 'shadowed';
  const shadowedArchiveCleanup = durableResume === 'shadowed-archive-cleanup' && activeRunId === null &&
    target === 'shadow' && verb === 'status' && receipt.target === 'shadow' && receipt.phase === 'shadowed';
  const shadowedTerminalCleanup = durableResume === 'shadowed-terminal-cleanup' && activeRunId === null &&
    target === 'shadow' && verb === 'status' && receipt.target === 'shadow' && receipt.phase === 'shadowed';
  const shadowedCleanup = shadowedSourceCleanup || shadowedArchiveCleanup || shadowedTerminalCleanup;
  if (durableResume !== 'none' && !markerlessPrepared && !shadowedCleanup) fail('invalid durable resume state');
  const resume = (active && target === 'production') || (rollback && receipt.rollbackIntent === true) ||
    (verb === 'status' && receipt.phase === 'committed') || (verb === 'rollback' && receipt.phase === 'rolled-back') ||
    markerlessPrepared || shadowedCleanup;
  validateDeliveryAuthorization(bytes, { ...deliveryReceiptBinding(receipt), deliveryRunId, deliveryRunAttempt, target }, { now, allowExpired: Boolean(resume) });
  if (!a.verbs.includes(verb) || (a.operation === 'rollback' && verb !== 'rollback')) fail('delivery verb is not authorized');
  if (verb === 'rollback' && a.operation === 'promote' && !active && receipt.phase !== 'rolled-back') fail('fresh rollback authorization required');
  if (a.operation === 'rollback' && receipt.rollbackIntent !== true) fail('missing durable rollback intent');
  return a;
}

const TRANSITION_STAGES = ['shadow', 'rollback', 'forward-repair'];
const TRANSITION_BINDING = ['candidateManifestSha256', 'baseManifestSha256', 'qualificationReceiptSha256', 'workflowRunId', 'workflowRunAttempt'];
const TRANSITION_SERVICES = ['postgres', 'livekit', 'app', 'commerce-reconciler', 'tapestry', 'playlist-bot', 'analytics'];
const RUNTIME_MEASUREMENT_OPERATIONS = [
  'measure-runtime-inventory',
  ...TRANSITION_SERVICES.flatMap(service => [`measure-runtime-container-${service}`, `measure-runtime-image-${service}`]),
  ...['app', 'livekit', 'tapestry', 'analytics'].map(service => `measure-runtime-address-${service}`),
  ...['app-health', 'app-ready', 'tapestry-health', 'analytics-ready', 'livekit'].map(endpoint => `measure-runtime-endpoint-${endpoint}`),
  ...['database', 'media'].map(network => `measure-private-network-${network}`),
];
const COMPATIBILITY_OPERATIONS = [
  'check-schema-head', 'check-browser-endpoints', 'check-synthetic-session', 'check-commerce-heartbeat', 'check-commerce-backlog',
  ...['database', 'media'].map(network => `check-private-network-${network}`),
  'check-runtime-inventory',
  ...TRANSITION_SERVICES.map(service => `check-runtime-environment-${service}`),
  'check-backup', 'check-restore-drop', 'check-restore-create', 'check-restore-apply', 'check-restore-count', 'check-restore-cleanup',
];
const TRANSITION_OPERATIONS = {
  shadow: ['configure-candidate-live-staging', 'migrate-candidate-app', 'migrate-candidate-analytics', 'replace-candidate-live-staging'],
  rollback: ['configure-candidate-production', 'replace-candidate-production', 'configure-base-production', 'replace-base-production'],
  'forward-repair': ['configure-candidate-production', 'replace-candidate-production'],
};
export function transitionStageContract(stage) {
  if (!TRANSITION_STAGES.includes(stage)) fail('invalid transition stage contract');
  const preparation = stage === 'rollback' ? TRANSITION_OPERATIONS.rollback.slice(0, 2) : [];
  const transition = stage === 'rollback' ? TRANSITION_OPERATIONS.rollback.slice(2) : TRANSITION_OPERATIONS[stage];
  const operations = [...preparation, ...RUNTIME_MEASUREMENT_OPERATIONS, ...transition, ...RUNTIME_MEASUREMENT_OPERATIONS, ...COMPATIBILITY_OPERATIONS];
  const beforeStart = preparation.length;
  const beforeEnd = beforeStart + RUNTIME_MEASUREMENT_OPERATIONS.length;
  const afterStart = beforeEnd + transition.length;
  return { operations, before: [beforeStart, beforeEnd], after: [afterStart, afterStart + RUNTIME_MEASUREMENT_OPERATIONS.length] };
}
function operationExecutable(operation) {
  if (operation === 'check-browser-endpoints') return 'npx';
  if (operation.startsWith('measure-runtime-endpoint-')) return 'curl';
  return 'docker';
}
export const transitionCommandTranscriptSha256 = commands => publicConfigSha256(Buffer.from(canonicalize(commands.map(command => ({
  operation: command.operation,
  executableIdentity: command.executableIdentity,
  executableSha256: command.executableSha256,
  argvSha256: command.argvSha256,
  environmentSha256: command.environmentSha256,
  stdinSha256: command.stdinSha256,
  exitCode: command.exitCode,
  stdoutSha256: command.stdoutSha256,
  stderrSha256: command.stderrSha256,
})))));
export const transitionOutputTranscriptSha256 = commands => publicConfigSha256(Buffer.from(canonicalize(commands.map(({ operation, exitCode, stdoutSha256, stderrSha256 }) => ({ operation, exitCode, stdoutSha256, stderrSha256 })))));

function bounded(value, label, maximum, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) fail(`invalid ${label}`);
}

// Inputs are exact file bytes. Authentication is mandatory at the root caller before semantics.
export function validateTransitionEvidence({ manifest, manifestBytes, authorizationBytes, qualificationBytes, stages, now = Date.now() }) {
  validateReleaseManifest(manifest);
  if (canonicalize(JSON.parse(manifestBytes)) !== canonicalize(manifest)) fail('transition manifest bytes mismatch');
  const candidate = createHash('sha256').update(manifestBytes).digest('hex');
  const binding = {
    candidateManifestSha256: candidate,
    baseManifestSha256: manifest.promotion.baseManifestSha256,
    qualificationReceiptSha256: manifest.qualification.receiptSha256,
    workflowRunId: manifest.build.workflowRunId,
    workflowRunAttempt: manifest.build.workflowRunAttempt,
  };
  const checkBinding = (value) => {
    for (const key of TRANSITION_BINDING) if (value[key] !== binding[key]) fail(`transition ${key} mismatch`);
  };
  if (publicConfigSha256(qualificationBytes) !== binding.qualificationReceiptSha256) fail('transition qualification digest mismatch');
  validateQualificationReceipt(JSON.parse(qualificationBytes), manifest);
  const authorization = JSON.parse(authorizationBytes);
  if (!Buffer.from(authorizationBytes).equals(Buffer.from(canonicalize(authorization)))) fail('noncanonical transition authorization');
  exactKeys(authorization, 'transition authorization', ['schemaVersion', 'laneState', ...TRANSITION_BINDING, 'authorizedAt', 'expiresAt', 'stages']);
  checkBinding(authorization);
  if (authorization.schemaVersion !== 'harmonic-beacon.oci-transition.v4' || authorization.laneState !== 'oci-production') fail('invalid transition authorization');
  const authorizedAt = +date(authorization.authorizedAt, 'authorization time');
  const expiresAt = +date(authorization.expiresAt, 'authorization expiry');
  if (!Number.isSafeInteger(now) || authorizedAt > now || expiresAt <= now || expiresAt <= authorizedAt || expiresAt - authorizedAt > 86400000 ||
      now >= +date(manifest.qualification.expiresAt, 'qualification expiry')) fail('stale transition authorization');
  exactKeys(authorization.stages, 'authorized stages', TRANSITION_STAGES);
  exactKeys(stages, 'transition stages', TRANSITION_STAGES);
  const executionDigests = new Set();
  const measurementDigests = new Set();
  const executableDigests = new Map();
  let previousEnd = 0;
  for (const stage of TRANSITION_STAGES) {
    const { receiptBytes, executionBytes } = stages[stage];
    const hashes = authorization.stages[stage];
    exactKeys(hashes, 'stage digests', ['receiptSha256', 'executionEvidenceSha256']);
    digest(hashes.receiptSha256, 'receipt');
    digest(hashes.executionEvidenceSha256, 'execution evidence');
    if (publicConfigSha256(receiptBytes) !== hashes.receiptSha256 || publicConfigSha256(executionBytes) !== hashes.executionEvidenceSha256 ||
        executionDigests.has(hashes.executionEvidenceSha256)) fail('transition evidence digest mismatch or reuse');
    executionDigests.add(hashes.executionEvidenceSha256);
    const receipt = JSON.parse(receiptBytes);
    if (!Buffer.from(receiptBytes).equals(Buffer.from(canonicalize(receipt)))) fail('noncanonical transition receipt');
    exactKeys(receipt, 'transition receipt', ['schemaVersion', 'stage', ...TRANSITION_BINDING, 'executionEvidenceSha256', 'issuedAt']);
    checkBinding(receipt);
    if (receipt.schemaVersion !== `harmonic-beacon.${stage}-receipt.v4` || receipt.stage !== stage ||
        receipt.executionEvidenceSha256 !== hashes.executionEvidenceSha256) fail('invalid transition receipt');
    const issuedAt = +date(receipt.issuedAt, 'receipt time');
    const execution = JSON.parse(executionBytes);
    if (!Buffer.from(executionBytes).equals(Buffer.from(canonicalize(execution)))) fail('noncanonical transition execution');
    exactKeys(execution, 'execution evidence', ['schemaVersion', 'stage', ...TRANSITION_BINDING, 'startedAt', 'completedAt', 'commands', 'runtimeBefore', 'runtimeAfter',
      ...(stage === 'shadow' ? [] : ['observedRecoveryMs', 'maxRecoveryMs'])]);
    checkBinding(execution);
    if (execution.schemaVersion !== `harmonic-beacon.${stage}-execution.v4` || execution.stage !== stage) fail('invalid execution stage');
    const start = +date(execution.startedAt, 'execution start');
    const end = +date(execution.completedAt, 'execution end');
    if ((previousEnd && start <= previousEnd) || start < authorizedAt - 86400000 || end <= start || end > issuedAt || issuedAt > authorizedAt) fail('invalid execution freshness/order');
    previousEnd = end;
    const contract = transitionStageContract(stage);
    if (!Array.isArray(execution.commands) || execution.commands.length !== contract.operations.length || execution.commands.length > 128) fail('invalid stage command inventory');
    let commandEnd = start;
    for (let index = 0; index < execution.commands.length; index += 1) {
      const command = execution.commands[index];
      exactKeys(command, 'command result', ['operation', 'executableIdentity', 'executableSha256', 'argvSha256', 'environmentSha256', 'stdinSha256', 'startedAt', 'completedAt', 'exitCode', 'stdoutSha256', 'stderrSha256']);
      if (command.operation !== contract.operations[index]) fail('invalid stage command order');
      const expectedExecutable = operationExecutable(command.operation);
      const expectedBasenames = expectedExecutable === 'npx' ? ['npx', 'npx-cli.js'] : [expectedExecutable];
      if (typeof command.executableIdentity !== 'string' || !isAbsolute(command.executableIdentity) || resolve(command.executableIdentity) !== command.executableIdentity || !expectedBasenames.includes(basename(command.executableIdentity))) fail('invalid command executable identity');
      for (const key of ['executableSha256', 'argvSha256', 'environmentSha256', 'stdinSha256', 'stdoutSha256', 'stderrSha256']) digest(command[key], key);
      const executableBinding = `${command.executableIdentity}:${command.executableSha256}`;
      const priorExecutableDigest = executableDigests.get(expectedExecutable);
      if (priorExecutableDigest && priorExecutableDigest !== executableBinding) fail('executable identity or bytes changed during transition');
      executableDigests.set(expectedExecutable, executableBinding);
      const cs = +date(command.startedAt, 'command start');
      const ce = +date(command.completedAt, 'command end');
      if (command.exitCode !== 0 || cs < commandEnd || ce <= cs || ce > end) fail('invalid command result');
      commandEnd = ce;
    }
    const beforeManifest = stage === 'rollback' ? candidate : binding.baseManifestSha256;
    const afterManifest = stage === 'rollback' ? binding.baseManifestSha256 : candidate;
    const stageRuntimeDigests = [];
    const stageHealthDigests = [];
    const stagePrivateBoundaryDigests = [];
    for (const [key, expected, range] of [['runtimeBefore', beforeManifest, contract.before], ['runtimeAfter', afterManifest, contract.after]]) {
      const runtime = execution[key];
      exactKeys(runtime, key, ['manifestSha256', 'configSha256', 'commandStart', 'commandEnd', 'runtimeCommandTranscriptSha256', 'healthCommandTranscriptSha256', 'privateBoundaryCommandTranscriptSha256']);
      if (runtime.manifestSha256 !== expected) fail('runtime stage transition mismatch');
      for (const field of ['configSha256', 'runtimeCommandTranscriptSha256', 'healthCommandTranscriptSha256', 'privateBoundaryCommandTranscriptSha256']) digest(runtime[field], field);
      const target = stage === 'shadow' ? 'live-staging' : 'production';
      if (runtime.configSha256 !== manifest.configProfiles[target].sha256) fail('runtime config mismatch');
      if (runtime.commandStart !== range[0] || runtime.commandEnd !== range[1]) fail('runtime command range mismatch');
      const transcript = execution.commands.slice(...range);
      const health = transcript.filter(command => command.operation.startsWith('measure-runtime-endpoint-'));
      const privateBoundary = transcript.filter(command => command.operation.startsWith('measure-runtime-container-') || command.operation.startsWith('measure-private-network-'));
      const measured = [transitionCommandTranscriptSha256(transcript), transitionOutputTranscriptSha256(health), transitionOutputTranscriptSha256(privateBoundary)];
      if (runtime.runtimeCommandTranscriptSha256 !== measured[0] || runtime.healthCommandTranscriptSha256 !== measured[1] || runtime.privateBoundaryCommandTranscriptSha256 !== measured[2]) fail('runtime measurement transcript mismatch');
      for (const value of measured.slice(0, 2)) {
        if (measurementDigests.has(value)) fail('reused runtime measurement');
        measurementDigests.add(value);
      }
      stageRuntimeDigests.push(runtime.runtimeCommandTranscriptSha256);
      stageHealthDigests.push(runtime.healthCommandTranscriptSha256);
      stagePrivateBoundaryDigests.push(runtime.privateBoundaryCommandTranscriptSha256);
    }
    if (stageRuntimeDigests[0] === stageRuntimeDigests[1] || stageHealthDigests[0] === stageHealthDigests[1] ||
        stagePrivateBoundaryDigests[0] === stagePrivateBoundaryDigests[1]) fail('reused before/after runtime measurement');
    if (stage !== 'shadow') {
      bounded(execution.maxRecoveryMs, 'maximum recovery', 3600000, 1);
      bounded(execution.observedRecoveryMs, 'observed recovery', execution.maxRecoveryMs, 1);
      if (execution.observedRecoveryMs !== end - start) fail('recovery timing mismatch');
    }
  }
  return authorization;
}

function strictBoolean(value, label) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  fail(`${label} must be true or false`);
}

function parseEnvironment(bytes) {
  const values = new Map();
  for (const raw of bytes.toString('utf8').split(/\r?\n/u)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) fail('runtime environment contains an invalid line');
    if (values.has(match[1])) fail(`runtime environment duplicates ${match[1]}`);
    values.set(match[1], match[2]);
  }
  return values;
}

function exactPublicOrigin(value) {
  let url;
  try { url = new URL(value); } catch { fail('invalid PUBLIC_ORIGIN'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    fail('PUBLIC_ORIGIN must be an origin-only https URL');
  }
  return url.origin;
}

function exactWebsocketUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('invalid LIVEKIT_PUBLIC_URL'); }
  if (url.protocol !== 'wss:' || url.username || url.password || url.search || url.hash) {
    fail('LIVEKIT_PUBLIC_URL must be a credential-free wss URL');
  }
  return url.href;
}

function validateRuntimePublicConfig(profile) {
  exactKeys(profile, 'runtime public config', ['schemaVersion', 'publicOrigin', 'livekitPublicUrl', 'featureFlags']);
  if (profile.schemaVersion !== 'harmonic-beacon.runtime-public-config.v1') fail('unsupported runtime public config');
  exactKeys(profile.featureFlags, 'runtime public config featureFlags', ['tapestryPublic', 'promoInvitations']);
  if (typeof profile.featureFlags.tapestryPublic !== 'boolean' || typeof profile.featureFlags.promoInvitations !== 'boolean') {
    fail('runtime public config flags must be boolean');
  }
  exactPublicOrigin(profile.publicOrigin);
  exactWebsocketUrl(profile.livekitPublicUrl);
  return profile;
}

export function verifyRuntimePublicConfig(profile, environmentBytes) {
  validateRuntimePublicConfig(profile);
  const env = parseEnvironment(environmentBytes);
  const publicOrigin = exactPublicOrigin(env.get('PUBLIC_ORIGIN') ?? '');
  const livekitPublicUrl = exactWebsocketUrl(env.get('LIVEKIT_PUBLIC_URL') ?? '');
  const allowlist = (env.get('LIVEKIT_PUBLIC_URL_ALLOWLIST') ?? '').split(',').map((value) => value.trim()).filter(Boolean);
  if (allowlist.length !== 1 || exactWebsocketUrl(allowlist[0]) !== livekitPublicUrl) {
    fail('LIVEKIT_PUBLIC_URL_ALLOWLIST must contain only the reviewed exact URL');
  }
  if (publicOrigin !== exactPublicOrigin(profile.publicOrigin) || livekitPublicUrl !== exactWebsocketUrl(profile.livekitPublicUrl) ||
      strictBoolean(env.get('TAPESTRY_PUBLIC_ENABLED'), 'TAPESTRY_PUBLIC_ENABLED') !== profile.featureFlags.tapestryPublic ||
      strictBoolean(env.get('PROMO_INVITATIONS_ENABLED'), 'PROMO_INVITATIONS_ENABLED') !== profile.featureFlags.promoInvitations) {
    fail('runtime environment does not match the reviewed public config');
  }
  return true;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--') || value === undefined) fail('arguments must be --name value pairs');
    if (options[key.slice(2)] !== undefined) fail(`duplicate option: ${key}`);
    options[key.slice(2)] = value;
  }
  return { command, options };
}

export function main(argv = process.argv.slice(2)) {
  const { command, options } = parseArgs(argv);
  if (command === 'validate-delivery') {
    const manifest = JSON.parse(readFileSync(options.manifest));
    validateReleaseManifest(manifest);
    const a = validateDeliveryAuthorization(readFileSync(options.authorization), {
      sourceSha: options['source-sha'], sourceTree: options['source-tree'],
      candidateManifestSha256: options['manifest-sha256'], baseManifestSha256: manifest.promotion.baseManifestSha256,
      candidateRunId: options['candidate-run-id'], candidateRunAttempt: Number(options['candidate-run-attempt']),
      deliveryRunId: options['delivery-run-id'], deliveryRunAttempt: Number(options['delivery-run-attempt']),
      target: options.target, environment: options.target, operation: 'promote', configSha256: options['config-sha256'],
      transitionAuthorizationSha256: options.target === 'production' ? publicConfigSha256(readFileSync(resolve(dirname(options.authorization), '../transition/authorization.json'))) : null,
    });
    writeFileSync(options.output, canonicalize({ deliveryAuthorization: a,
      deliveryAuthorizationSha256: publicConfigSha256(readFileSync(options.authorization)) }), { flag: 'wx', mode: 0o600 });
    return 0;
  }
  if (command === 'check-delivery') {
    validateDeliveryInvocation(JSON.parse(readFileSync(options.receipt)), {
      deliveryRunId: options['delivery-run-id'], deliveryRunAttempt: Number(options['delivery-run-attempt']),
      target: options.target, verb: options.verb,
      activeRunId: options['active-run-id'] === 'none' ? null : (options['active-run-id'] ?? null),
      durableResume: options['durable-resume'] ?? 'none',
    });
    return 0;
  }
  if (command === 'bind-rollback-delivery') {
    const receipt = JSON.parse(readFileSync(options.receipt));
    const state = JSON.parse(readFileSync(options.state));
    validateCurrentState(state);
    if (receipt.phase !== 'committed' || receipt.rollbackIntent || receipt.rollbackPublication ||
        !samePublication(state.publication, receipt.candidatePublication)) fail('obsolete or replayed rollback');
    const bytes = readFileSync(options.authorization);
    const a = validateDeliveryAuthorization(bytes, { ...deliveryReceiptBinding(receipt),
      operation: 'rollback', target: 'production', deliveryRunId: options['delivery-run-id'],
      deliveryRunAttempt: Number(options['delivery-run-attempt']) });
    if (a.deliveryRunId === receipt.deliveryAuthorization?.deliveryRunId) fail('rollback requires a new protected delivery run');
    receipt.rollbackDeliveryAuthorization = a;
    receipt.rollbackDeliveryAuthorizationSha256 = publicConfigSha256(bytes);
    receipt.rollbackIntent = true;
    writeFileSync(options.output, JSON.stringify(receipt), { flag: 'wx', mode: 0o600 });
    return 0;
  }
  if (['bind-publications', 'match-publication', 'rollback-publication', 'publication-for-write'].includes(command)) {
    const state = JSON.parse(readFileSync(options.state, 'utf8'));
    validateCurrentState(state);
    const receipt = JSON.parse(readFileSync(options.receipt, 'utf8'));
    if (command === 'bind-publications') {
      if (receipt.baseManifestSha256 !== state.manifestSha256) fail('base publication high-water mismatch');
      receipt.basePublication = state.publication;
      receipt.candidatePublication = nextPublication(state.publication, receipt.manifestSha256);
    } else {
      validatePublication(receipt.basePublication);
      validatePublication(receipt.candidatePublication);
      if (receipt.basePublication.manifestSha256 !== receipt.baseManifestSha256 ||
          receipt.candidatePublication.manifestSha256 !== receipt.manifestSha256 ||
          receipt.candidatePublication.generation !== receipt.basePublication.generation + 1 ||
          receipt.candidatePublication.id === receipt.basePublication.id) fail('invalid transaction publications');
      if (receipt.rollbackPublication) {
        validatePublication(receipt.rollbackPublication);
        const r = receipt.rollbackPublication;
        if (r.manifestSha256 !== receipt.baseManifestSha256 ||
            ![receipt.basePublication.generation + 1, receipt.candidatePublication.generation + 1].includes(r.generation) ||
            [receipt.basePublication.id, receipt.candidatePublication.id].includes(r.id)) fail('invalid rollback publication');
      }
      if (command === 'match-publication') {
        if (!receipt[options.kind + 'Publication'] || !samePublication(state.publication, receipt[options.kind + 'Publication'])) fail('publication high-water mismatch');
        return 0;
      }
      if (command === 'rollback-publication') {
        if (!samePublication(state.publication, receipt.basePublication) && !samePublication(state.publication, receipt.candidatePublication)) fail('rollback high-water mismatch');
        receipt.rollbackPublication ??= nextPublication(state.publication, receipt.baseManifestSha256);
      } else {
        const publication = receipt[options.kind + 'Publication'];
        validatePublication(publication);
        if (!samePublication(state.publication, publication)) {
          if (publication.generation !== state.publication.generation + 1 || publication.id === state.publication.id ||
              !(samePublication(state.publication, receipt.basePublication) ||
                (options.kind === 'rollback' && samePublication(state.publication, receipt.candidatePublication)))) fail('publication high-water mismatch');
        }
        process.stdout.write(JSON.stringify(publication));
        return 0;
      }
    }
    writeFileSync(options.output, JSON.stringify(receipt), { mode: 0o600 });
    return 0;
  }
  if (command === 'validate-current-state' || command === 'unpack-current-state') {
    const decoded = validateCurrentState(JSON.parse(readFileSync(resolve(options.state), 'utf8')));
    if (command === 'unpack-current-state') {
      for (const [field, file] of Object.entries({ manifestBase64: 'prior-manifest.json',
        composeBase64: 'docker-compose.yml', overlayBase64: 'oci-images.compose.yml',
        publicConfigBase64: 'target-public-config.json' })) {
        writeFileSync(resolve(options.destination, file), decoded[field], { flag: 'wx', mode: 0o600 });
      }
    }
    return 0;
  }
  if (command === 'validate-transition') {
    const root = resolve(options.evidence);
    const manifestBytes = readFileSync(resolve(options.manifest));
    const stages = Object.fromEntries(TRANSITION_STAGES.map(stage => [stage, {
      receiptBytes: readFileSync(resolve(root, `${stage}.json`)),
      executionBytes: readFileSync(resolve(root, `${stage}.execution.json`)),
    }]));
    validateTransitionEvidence({ manifest: JSON.parse(manifestBytes), manifestBytes,
      authorizationBytes: readFileSync(resolve(root, 'authorization.json')),
      qualificationBytes: readFileSync(resolve(root, 'qualification.json')), stages });
    return 0;
  }
  if (command === 'canonicalize') {
    const manifest = JSON.parse(readFileSync(resolve(options.manifest), 'utf8'));
    validateReleaseManifest(manifest);
    writeFileSync(resolve(options.output), canonicalize(manifest), { flag: 'wx', mode: 0o600 });
    return 0;
  }
  if (command === 'candidate-hash') {
    const manifest = JSON.parse(readFileSync(resolve(options.manifest), 'utf8'));
    console.log(candidateIdentitySha256(manifest));
    return 0;
  }
  if (command === 'public-config-digest') {
    console.log(publicConfigSha256(readFileSync(resolve(options.profile))));
    return 0;
  }
  if (command === 'verify-runtime-public-config') {
    const profileBytes = readFileSync(resolve(options.profile));
    const profile = JSON.parse(profileBytes);
    verifyRuntimePublicConfig(profile, readFileSync(resolve(options.env)));
    const expected = options['expected-sha256'];
    const actual = publicConfigSha256(profileBytes);
    if (expected && actual !== expected) fail('runtime public config byte digest mismatch');
    console.log(actual);
    return 0;
  }
  if (command === 'assemble') {
    const candidate = JSON.parse(readFileSync(resolve(options.candidate), 'utf8'));
    const qualification = JSON.parse(readFileSync(resolve(options.qualification), 'utf8'));
    const manifest = assembleReleaseManifest(candidate, qualification);
    writeFileSync(resolve(options.output), canonicalize(manifest), { flag: 'wx', mode: 0o600 });
    return 0;
  }
  if (command === 'admit-file' || command === 'admit-signature') {
    const maximumBytes = Number(options['maximum-bytes']);
    const actual = admitRegularFile(
      resolve(options.source), resolve(options.output),
      { expectedSha256: options['expected-sha256'], maximumBytes, signatureBundle: command === 'admit-signature' },
    );
    console.log(actual);
    return 0;
  }
  fail('usage: release-manifest.mjs {validate-current-state|unpack-current-state|validate-transition|canonicalize|candidate-hash|public-config-digest|verify-runtime-public-config|assemble|admit-file} [options]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'release manifest: failed');
    process.exitCode = 1;
  }
}
