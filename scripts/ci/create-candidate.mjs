#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize } from './release-manifest.mjs';

const EXACT_REF = /^([a-z0-9./-]+)@(sha256:[0-9a-f]{64})$/u;
const IDS = ['app', 'tapestry', 'playlist-bot', 'analytics'];

function fail(message) {
  throw new Error(`release candidate: ${message}`);
}

function exactRef(value, label) {
  const match = EXACT_REF.exec(value ?? '');
  if (!match) fail(`exact ${label} image reference is required`);
  return { repository: match[1], digest: match[2] };
}

export function createCandidate(options) {
  const artifacts = options.evidence.map((entry) => {
    if (!IDS.includes(entry.artifactId)) fail(`unexpected artifact evidence: ${entry.artifactId}`);
    const context = '.';
    return {
      artifactId: entry.artifactId,
      repository: entry.repository,
      digest: entry.digest,
      platform: 'linux/amd64',
      context,
      dockerfile: entry.artifactId === 'app' ? 'Dockerfile' : `services/${entry.artifactId}/Dockerfile`,
      roles: entry.artifactId === 'app' ? ['app', 'migrate', 'commerce-reconciler'] : [entry.artifactId],
      sbom: { format: 'spdx-json', digest: entry.sbomDigest },
      provenance: { predicateType: 'https://slsa.dev/provenance/v1', digest: entry.provenanceDigest },
      signature: {
        issuer: 'https://token.actions.githubusercontent.com',
        identity: 'https://github.com/AlterMundi/harmonic-beacon-webapp/.github/workflows/oci-candidate.yml@refs/heads/main',
        bundleDigest: entry.signatureBundleDigest,
      },
    };
  }).sort((left, right) => IDS.indexOf(left.artifactId) - IDS.indexOf(right.artifactId));
  if (artifacts.length !== IDS.length || new Set(artifacts.map((entry) => entry.artifactId)).size !== IDS.length) {
    fail('complete, unique first-party evidence is required');
  }
  const postgres = exactRef(options.externalRefs.postgres, 'postgres');
  const livekit = exactRef(options.externalRefs.livekit, 'livekit');
  return {
    schemaVersion: 'harmonic-beacon.release.v1',
    source: { repository: 'AlterMundi/harmonic-beacon-webapp', gitSha: options.sourceSha, gitTree: options.sourceTree },
    build: {
      workflowRunId: options.runId,
      workflowRunAttempt: options.runAttempt,
      createdAt: options.createdAt,
      dependencyLockSha256: options.hashes.dependencyLock,
      buildDefinitionSha256: options.hashes.buildDefinition,
      runtimePolicySha256: options.hashes.runtimePolicy,
    },
    artifacts,
    externalImages: [
      { serviceId: 'postgres', ...postgres, platform: 'linux/amd64' },
      { serviceId: 'livekit', ...livekit, platform: 'linux/amd64' },
    ],
    migrationSet: { head: options.migrationHead, sha256: options.hashes.migrationSet },
    publicConfig: { strategy: 'server-token-response', schemaSha256: options.hashes.configSchema },
    configProfiles: {
      'live-staging': { sha256: options.hashes.liveStagingConfig },
      production: { sha256: options.hashes.productionConfig },
    },
    promotion: { baseManifestSha256: options.baseManifestSha256 },
    rollback: options.rollback,
  };
}

function hashFiles(paths) {
  const hash = createHash('sha256');
  for (const path of [...paths].sort()) {
    hash.update(path); hash.update('\0'); hash.update(readFileSync(path)); hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

function filesUnder(path) {
  return readdirSync(path, { recursive: true }).map((entry) => join(path, entry.toString()))
    .filter((entry) => statSync(entry).isFile());
}

function argument(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0 || !argv[index + 1]) fail(`${name} is required`);
  return argv[index + 1];
}

export function main(argv = process.argv.slice(2), env = process.env) {
  const evidenceRoot = resolve(argument(argv, '--evidence'));
  const output = resolve(argument(argv, '--output'));
  const evidenceFiles = filesUnder(evidenceRoot).filter((path) => path.endsWith('/evidence.json'));
  const evidence = evidenceFiles.map((path) => JSON.parse(readFileSync(path, 'utf8')));
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceTree = execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim();
  const createdAt = new Date(execFileSync('git', ['show', '-s', '--format=%cI', 'HEAD'], { encoding: 'utf8' }).trim()).toISOString();
  const migrationDirectories = readdirSync('prisma/migrations').sort();
  const migrationHead = migrationDirectories.at(-1);
  const candidate = createCandidate({
    sourceSha, sourceTree, createdAt,
    runId: env.GITHUB_RUN_ID,
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    evidence,
    externalRefs: { postgres: env.HB_POSTGRES_IMAGE_REF, livekit: env.HB_LIVEKIT_IMAGE_REF },
    baseManifestSha256: env.HB_RELEASE_BASE_MANIFEST_SHA256,
    rollback: JSON.parse(env.HB_RELEASE_ROLLBACK_JSON ?? 'null'),
    migrationHead,
    hashes: {
      dependencyLock: hashFiles(['package-lock.json']),
      buildDefinition: hashFiles(['.github/workflows/oci-candidate.yml', 'Dockerfile', 'docker-bake.hcl', ...filesUnder('services').filter((path) => path.endsWith('Dockerfile'))]),
      runtimePolicy: hashFiles([
        'deploy/oci-images.compose.yml', 'deploy/qualification.compose.yml',
        'deploy/schemas/runtime-public-config.schema.json',
        'deploy/runtime-public-config/live-staging.json', 'deploy/runtime-public-config/production.json',
        'src/lib/livekit-public-url.ts', 'src/lib/livekit-token-response.ts',
        'src/app/api/livekit/token/route.ts', 'src/app/api/scheduled-sessions/[id]/token/route.ts',
      ]),
      migrationSet: hashFiles(filesUnder('prisma/migrations')),
      configSchema: hashFiles(['deploy/schemas/runtime-public-config.schema.json']),
      liveStagingConfig: hashFiles(['deploy/runtime-public-config/live-staging.json']),
      productionConfig: hashFiles(['deploy/runtime-public-config/production.json']),
    },
  });
  writeFileSync(output, canonicalize(candidate), { flag: 'wx', mode: 0o600 });
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'release candidate failed');
    process.exitCode = 1;
  }
}
