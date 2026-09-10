#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
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
      'roles', 'sbom', 'provenance', 'signature',
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
  if (new Date(expected.now ?? Date.now()) >= new Date(manifest.qualification.expiresAt)) fail('qualification has expired');

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

export function verifyRuntimePublicConfig(profile, environmentBytes) {
  exactKeys(profile, 'runtime public config', ['schemaVersion', 'publicOrigin', 'livekitPublicUrl', 'featureFlags']);
  if (profile.schemaVersion !== 'harmonic-beacon.runtime-public-config.v1') fail('unsupported runtime public config');
  exactKeys(profile.featureFlags, 'runtime public config featureFlags', ['tapestryPublic', 'promoInvitations']);
  if (typeof profile.featureFlags.tapestryPublic !== 'boolean' || typeof profile.featureFlags.promoInvitations !== 'boolean') {
    fail('runtime public config flags must be boolean');
  }
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
  fail('usage: release-manifest.mjs {canonicalize|candidate-hash|public-config-digest|verify-runtime-public-config|assemble} [options]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'release manifest: failed');
    process.exitCode = 1;
  }
}
