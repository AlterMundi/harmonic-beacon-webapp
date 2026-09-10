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
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(`${label} has unknown field: ${key}`);
  }
  for (const key of keys) {
    if (!(key in value)) fail(`${label} is missing ${key}`);
  }
}

function string(value, label, pattern) {
  if (typeof value !== 'string' || !value || (pattern && !pattern.test(value))) fail(`invalid ${label}`);
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

export function candidateIdentitySha256(manifest) {
  const candidate = structuredClone(manifest);
  delete candidate.qualification;
  return canonicalSha256(candidate);
}

export function assembleReleaseManifest(candidate, qualification) {
  if (candidate?.qualification !== undefined) fail('candidate must not contain qualification');
  const manifest = structuredClone(candidate);
  manifest.qualification = structuredClone(qualification);
  const identity = candidateIdentitySha256(manifest);
  if (manifest.qualification.candidateIdentitySha256 &&
      manifest.qualification.candidateIdentitySha256 !== identity) {
    fail('qualification is bound to a different candidate identity');
  }
  manifest.qualification.candidateIdentitySha256 = identity;
  return validateReleaseManifest(manifest);
}

function validateSupplyChain(entry, label) {
  exactKeys(entry.sbom, `${label}.sbom`, ['format', 'digest']);
  if (entry.sbom.format !== 'spdx-json') fail(`${label} SBOM format must be spdx-json`);
  digest(entry.sbom.digest, `${label} SBOM`);

  exactKeys(entry.provenance, `${label}.provenance`, ['predicateType', 'digest']);
  if (entry.provenance.predicateType !== 'https://slsa.dev/provenance/v1') {
    fail(`${label} provenance predicate is unsupported`);
  }
  digest(entry.provenance.digest, `${label} provenance`);

  exactKeys(entry.signature, `${label}.signature`, ['issuer', 'identity', 'bundleDigest']);
  if (entry.signature.issuer !== 'https://token.actions.githubusercontent.com') {
    fail(`${label} signature issuer is not trusted`);
  }
  if (entry.signature.identity !==
      'https://github.com/AlterMundi/harmonic-beacon-webapp/.github/workflows/oci-candidate.yml@refs/heads/main') {
    fail(`${label} signature identity is not trusted`);
  }
  digest(entry.signature.bundleDigest, `${label} signature bundle`);
}

function validateArtifacts(artifacts) {
  if (!Array.isArray(artifacts)) {
    fail('artifacts must contain the complete first-party release set');
  }
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
    const expectedContext = '.';
    const expectedDockerfile = entry.artifactId === 'app' ? 'Dockerfile' : `services/${entry.artifactId}/Dockerfile`;
    if (entry.context !== expectedContext || entry.dockerfile !== expectedDockerfile) {
      fail(`${entry.artifactId} build inputs do not match the allowlist`);
    }
    if (!Array.isArray(entry.roles) || entry.roles.some((role) => typeof role !== 'string')) {
      fail(`${entry.artifactId} roles are invalid`);
    }
    if (entry.artifactId === 'app' &&
        JSON.stringify([...entry.roles].sort()) !== JSON.stringify(APP_ROLES)) {
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

function validateRollback(rollback) {
  exactKeys(rollback, 'rollback', ['manifestSha256', 'artifacts']);
  sha256(rollback.manifestSha256, 'rollback manifest');
  if (!Array.isArray(rollback.artifacts) || rollback.artifacts.length !== ARTIFACTS.size) {
    fail('complete rollback artifact digest set is required');
  }
  const seen = new Set();
  for (const entry of rollback.artifacts) {
    exactKeys(entry, 'rollback artifact', ['artifactId', 'repository', 'digest']);
    if (!ARTIFACTS.has(entry.artifactId) || seen.has(entry.artifactId)) {
      fail(`invalid or duplicate rollback artifact: ${entry.artifactId}`);
    }
    seen.add(entry.artifactId);
    if (entry.repository !== ARTIFACTS.get(entry.artifactId)) fail(`${entry.artifactId} rollback repository is not allowlisted`);
    digest(entry.digest, `${entry.artifactId} rollback`);
  }
}

export function validateReleaseManifest(manifest) {
  exactKeys(manifest, 'root', [
    'schemaVersion', 'source', 'build', 'artifacts', 'externalImages',
    'migrationSet', 'publicConfig', 'configProfiles', 'promotion', 'rollback', 'qualification',
  ]);
  if (manifest.schemaVersion !== 'harmonic-beacon.release.v1') fail('unsupported schemaVersion');

  exactKeys(manifest.source, 'source', ['repository', 'gitSha', 'gitTree']);
  if (manifest.source.repository !== SOURCE_REPOSITORY) fail('source repository is not allowlisted');
  string(manifest.source.gitSha, 'source SHA', GIT_ID);
  string(manifest.source.gitTree, 'source tree', GIT_ID);

  exactKeys(manifest.build, 'build', [
    'workflowRunId', 'workflowRunAttempt', 'createdAt', 'dependencyLockSha256',
    'buildDefinitionSha256', 'runtimePolicySha256',
  ]);
  string(manifest.build.workflowRunId, 'workflow run id', RUN_ID);
  if (!Number.isSafeInteger(manifest.build.workflowRunAttempt) || manifest.build.workflowRunAttempt < 1) {
    fail('invalid workflow run attempt');
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

  exactKeys(manifest.promotion, 'promotion', ['baseManifestSha256']);
  sha256(manifest.promotion.baseManifestSha256, 'promotion base manifest');
  validateRollback(manifest.rollback);

  exactKeys(manifest.qualification, 'qualification', [
    'runId', 'result', 'qualifiedAt', 'expiresAt', 'candidateIdentitySha256', 'receiptSha256',
  ]);
  string(manifest.qualification.runId, 'qualification run id', RUN_ID);
  if (manifest.qualification.result !== 'success') fail('qualification result must be success');
  const qualifiedAt = date(manifest.qualification.qualifiedAt, 'qualification time');
  const expiresAt = date(manifest.qualification.expiresAt, 'qualification expiry');
  if (expiresAt <= qualifiedAt) fail('qualification expiry must follow qualification time');
  sha256(manifest.qualification.candidateIdentitySha256, 'candidate identity');
  digest(manifest.qualification.receiptSha256, 'qualification receipt');
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
      'repository', 'imageDigest', 'sbomDigest', 'provenanceDigest', 'signatureBundleDigest',
    ]);
    if (actual.repository !== entry.repository || actual.imageDigest !== entry.digest) fail(`${entry.artifactId} image digest mismatch`);
    if (actual.sbomDigest !== entry.sbom.digest) fail(`${entry.artifactId} SBOM mismatch`);
    if (actual.provenanceDigest !== entry.provenance.digest) fail(`${entry.artifactId} provenance mismatch`);
    if (actual.signatureBundleDigest !== entry.signature.bundleDigest) fail(`${entry.artifactId} signature mismatch`);
    imageRefs[entry.artifactId] = `${entry.repository}@${entry.digest}`;
  }
  if (Object.keys(evidence).length !== manifest.artifacts.length) fail('unexpected registry evidence');

  const actualManifestSha256 = canonicalSha256(manifest);
  if (actualManifestSha256 !== expected.manifestSha256) fail('manifest SHA-256 mismatch');
  return {
    manifestSha256: actualManifestSha256,
    imageRefs,
    rollbackRefs: Object.fromEntries(manifest.rollback.artifacts.map((entry) => [
      entry.artifactId, `${entry.repository}@${entry.digest}`,
    ])),
  };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {};
  for (let index = 0; index < rest.length; index += 2) {
    const key = rest[index];
    const value = rest[index + 1];
    if (!key?.startsWith('--') || value === undefined) fail('arguments must be --name value pairs');
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
  if (command === 'assemble') {
    const candidate = JSON.parse(readFileSync(resolve(options.candidate), 'utf8'));
    const qualification = JSON.parse(readFileSync(resolve(options.qualification), 'utf8'));
    const manifest = assembleReleaseManifest(candidate, qualification);
    writeFileSync(resolve(options.output), canonicalize(manifest), { flag: 'wx', mode: 0o600 });
    return 0;
  }
  fail('usage: release-manifest.mjs {canonicalize|candidate-hash|assemble} [options]');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'release manifest: failed');
    process.exitCode = 1;
  }
}
