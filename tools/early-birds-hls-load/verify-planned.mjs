#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  EVIDENCE_KIND,
  EVIDENCE_SCHEMA_VERSION,
  assertRedactedEvidence,
  sha256,
  validateProfile,
} from './src/contracts.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
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

function sameValue(left, right) {
  return sha256(canonicalJson(left)) === sha256(canonicalJson(right));
}

function emptyMeasurements(measurements) {
  return measurements?.clients?.started === 0
    && measurements.clients.completed === 0
    && measurements.clients.generatorScheduleMisses === 0
    && measurements.requests?.total === 0
    && measurements.requests.successful === 0
    && measurements.requests.failed === 0
    && measurements.bytes?.total === 0
    && measurements.fetchContinuity?.opportunities === 0
    && measurements.fetchContinuity.successfulMediaFetches === 0
    && measurements.fetchContinuity.misses === 0
    && measurements.manifest?.samples === 0;
}

function validatePlannedEvidence(evidence) {
  assert(evidence?.schemaVersion === EVIDENCE_SCHEMA_VERSION, 'unexpected evidence schema');
  assert(evidence.kind === EVIDENCE_KIND, 'unexpected evidence kind');
  assert(evidence.status === 'PLANNED', 'planned verification accepts only PLANNED evidence');
  assertRedactedEvidence(evidence);
  assert(evidence.generator?.role === 'dry-run', 'planned evidence generator role must be dry-run');
  assert(evidence.generator.networkRequestsMade === false,
    'planned evidence must attest zero network requests');
  assert(/^[a-f0-9]{64}$/.test(evidence.generator.hostFingerprintSha256 ?? ''),
    'generator fingerprint is invalid');
  assert(evidence.target?.origin === null && evidence.target?.manifestPathSha256 === null,
    'planned evidence cannot identify a manifest target');

  const { planHash, deterministicSchedule, ...publicGlobalPlan } = evidence.plan ?? {};
  assert(deterministicSchedule === 'utc-start-plus-global-client-ramp-ordinal',
    'deterministic schedule identifier differs');
  assert(/^[a-f0-9]{64}$/.test(planHash ?? ''), 'planHash is invalid');
  assert(sha256(canonicalJson({ runId: evidence.runId, ...publicGlobalPlan })) === planHash,
    'planHash does not match the public deterministic plan');
  const normalizedProfile = validateProfile(evidence.plan.profile, 'evidence plan profile');
  assert(sameValue(evidence.plan.profile, normalizedProfile),
    'evidence plan profile is not normalized');

  assert(Number.isSafeInteger(evidence.shard?.index) && evidence.shard.index >= 0,
    'shard index is invalid');
  assert(evidence.shard.count === evidence.plan.shardCount,
    'shard count differs from the global plan');
  assert(Number.isSafeInteger(evidence.shard.localClients) && evidence.shard.localClients > 0,
    'local client count is invalid');
  assert(/^[a-f0-9]{64}$/.test(evidence.shard.clientOrdinalsSha256 ?? ''),
    'client ordinal hash is invalid');
  assert(evidence.measurements?.clients?.planned === evidence.shard.localClients,
    'planned clients differ from the shard');
  assert(emptyMeasurements(evidence.measurements),
    'PLANNED evidence contains runtime measurements or network activity');
  assert(evidence.redactionChecked === true, 'redaction check is not attested');
  return evidence;
}

async function readEvidence(path) {
  const resolved = resolve(path);
  const details = await stat(resolved);
  assert(details.isFile(), 'evidence source must be a regular file');
  assert((details.mode & 0o777) === 0o600, 'evidence source mode must be exactly 0600');
  const bytes = await readFile(resolved);
  let evidence;
  try {
    evidence = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('evidence source is not valid JSON');
  }
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    evidence: validatePlannedEvidence(evidence),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(
      'Usage: node verify-planned.mjs [--min-generators N] SHARD_EVIDENCE...\n',
    );
    return;
  }
  const minimumIndex = args.indexOf('--min-generators');
  let minimumGenerators = 1;
  if (minimumIndex >= 0) {
    minimumGenerators = Number(args[minimumIndex + 1]);
    assert(Number.isSafeInteger(minimumGenerators) && minimumGenerators > 0,
      '--min-generators must be a positive integer');
  }
  const sources = args.filter((_, index) => (
    index !== minimumIndex && index !== minimumIndex + 1
  ));
  assert(sources.length > 0 && sources.every((source) => !source.startsWith('--')),
    'one exact PLANNED evidence path per shard is required');

  const entries = await Promise.all(sources.map(readEvidence));
  const first = entries[0].evidence;
  const shardCount = first.plan.shardCount;
  assert(entries.length === shardCount, 'evidence count must equal shardCount');
  const indices = new Set();
  const ordinalHashes = new Set();
  const generatorFingerprints = new Set();
  let plannedClients = 0;
  for (const { evidence } of entries) {
    assert(evidence.runId === first.runId && evidence.plan.planHash === first.plan.planHash,
      'shard evidence does not share one deterministic plan');
    assert(sameValue(evidence.plan, first.plan), 'public plan differs between shards');
    assert(sameValue(evidence.target, first.target), 'planned target differs between shards');
    assert(sameValue(evidence.thresholds, first.thresholds), 'thresholds differ between shards');
    assert(sameValue(evidence.inputs, first.inputs), 'input hashes differ between shards');
    assert(!indices.has(evidence.shard.index), 'shard indices must be unique');
    assert(!ordinalHashes.has(evidence.shard.clientOrdinalsSha256),
      'client ordinal hashes must be unique');
    indices.add(evidence.shard.index);
    ordinalHashes.add(evidence.shard.clientOrdinalsSha256);
    generatorFingerprints.add(evidence.generator.hostFingerprintSha256);
    plannedClients += evidence.shard.localClients;
  }
  assert([...indices].sort((a, b) => a - b).every((index, offset) => index === offset),
    'shard indices must be complete from zero');
  assert(plannedClients === first.plan.profile.clients,
    'shard clients do not sum to the global client count');
  assert(generatorFingerprints.size >= minimumGenerators,
    `planned evidence requires at least ${minimumGenerators} distinct generators`);

  const summary = assertRedactedEvidence({
    schemaVersion: 1,
    kind: `${EVIDENCE_KIND}-planned-verification`,
    status: 'PLANNED',
    runId: first.runId,
    profileName: first.plan.profileName,
    planHash: first.plan.planHash,
    clients: plannedClients,
    shardCount,
    distinctGenerators: generatorFingerprints.size,
    networkRequestsMade: false,
    modeChecked: '0600',
    redactionChecked: true,
    sourceShards: entries
      .map(({ sha256: digest, evidence }) => ({
        index: evidence.shard.index,
        localClients: evidence.shard.localClients,
        sha256: digest,
      }))
      .sort((left, right) => left.index - right.index),
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `Planned evidence verification refused: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
