#!/usr/bin/env node

import { constants } from 'node:fs';
import { access, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildPlan, selectTarget, sha256 } from './src/contracts.mjs';
import { plannedEvidence, runShard } from './src/runner.mjs';

const toolRoot = dirname(fileURLToPath(import.meta.url));

function option(args, name, fallback = null) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return args[index + 1];
}

function integerOption(args, name, fallback) {
  const value = Number(option(args, name, String(fallback)));
  if (!Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function numberOption(args, name, fallback = null) {
  const raw = option(args, name, fallback === null ? null : String(fallback));
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
}

function printHelp() {
  process.stdout.write(`Usage:
  node tools/early-birds-hls-load/run.mjs \\
    --policy /secure/target-policy.json --target TARGET_ID \\
    --profile PROFILE --run-id RUN_ID --start-at UTC \\
    --shard-index N --shard-count N --evidence PATH --dry-run

For a network run, remove --dry-run and also provide:
  --manifest-url-file /secure/current-manifest-url
  --confirm "<exact phrase printed by dry-run>"
  --external-generator
  --clock-offset-ms NUMBER  Measured system-clock offset from trusted UTC

The staging generator must set:
  EARLY_BIRDS_GENERATOR_ROLE=external-load-generator

Options:
  --profiles PATH           Profile document (default: bundled profiles.json)
  --policy PATH             Explicit non-production target allowlist and limits
  --target ID               Target entry in the policy
  --profile NAME            Bounded load profile
  --run-id ID               Safe, shared run identifier
  --start-at UTC            Shared deterministic UTC start, ending in Z
  --shard-index N           Zero-based shard index (default: 0)
  --shard-count N           Total distributed shards (default: 1)
  --evidence PATH           New redacted evidence file; overwrite is refused
  --manifest-url-file PATH  0600 file; refreshed from disk at least once/second
  --confirm TEXT            Exact target/profile/start confirmation
  --external-generator      Assert execution is external and not mona
  --dry-run                 Validate and write PLANNED evidence; zero HTTP requests
`);
}

async function readJson(path, label) {
  let bytes;
  try {
    bytes = await readFile(path);
  } catch {
    throw new Error(`cannot read ${label}`);
  }
  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) };
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
}

async function assertNewFile(path) {
  try {
    await access(path, constants.F_OK);
    throw new Error('refusing to overwrite an existing evidence file');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

async function readManifestUrl(path) {
  const details = await stat(path);
  if (!details.isFile()) throw new Error('manifest URL source must be a regular file');
  if ((details.mode & 0o077) !== 0) throw new Error('manifest URL source must not be group/world accessible');
  const value = (await readFile(path, 'utf8')).trim();
  if (!value || value.includes('\n') || value.includes('\r')) {
    throw new Error('manifest URL source must contain exactly one URL');
  }
  return value;
}

function createManifestUrlProvider(path) {
  let cached = null;
  let loadedAtMs = 0;
  let pending = null;
  return async () => {
    if (cached !== null && Date.now() - loadedAtMs < 1_000) return cached;
    if (!pending) {
      pending = readManifestUrl(path).then((value) => {
        cached = value;
        loadedAtMs = Date.now();
        return value;
      }).finally(() => { pending = null; });
    }
    return pending;
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  const known = new Set([
    '--profiles', '--policy', '--target', '--profile', '--run-id', '--start-at',
    '--shard-index', '--shard-count', '--evidence', '--manifest-url-file', '--confirm',
    '--external-generator', '--clock-offset-ms', '--dry-run',
  ]);
  for (const argument of args.filter((value) => value.startsWith('--'))) {
    if (!known.has(argument)) throw new Error(`unknown option ${argument}`);
  }
  const dryRun = args.includes('--dry-run');
  const profilesPath = resolve(option(args, '--profiles', resolve(toolRoot, 'profiles.json')));
  const policyOption = option(args, '--policy');
  if (!policyOption) throw new Error('--policy is required');
  const policyPath = resolve(policyOption);
  const profileName = option(args, '--profile');
  const targetId = option(args, '--target');
  const runId = option(args, '--run-id');
  const startAt = option(args, '--start-at');
  const evidenceOption = option(args, '--evidence');
  if (!profileName || !targetId || !runId || !startAt || !evidenceOption) {
    throw new Error('--target, --profile, --run-id, --start-at and --evidence are required');
  }
  const evidencePath = resolve(evidenceOption);
  await assertNewFile(evidencePath);
  const [profilesDocument, policyDocument] = await Promise.all([
    readJson(profilesPath, 'profile document'),
    readJson(policyPath, 'target policy'),
  ]);
  if (profilesDocument.value?.schemaVersion !== 1) {
    throw new Error('profile document schemaVersion must be 1');
  }
  const profile = profilesDocument.value.profiles?.[profileName];
  if (!profile) throw new Error(`unknown profile ${profileName}`);
  const target = selectTarget(policyDocument.value, targetId);
  const plan = buildPlan({
    runId,
    profileName,
    profile,
    target,
    shardIndex: integerOption(args, '--shard-index', 0),
    shardCount: integerOption(args, '--shard-count', 1),
    startAt,
    networkRun: !dryRun,
  });
  const shared = {
    plan,
    target,
    policySha256: sha256(policyDocument.bytes),
    profileSha256: sha256(profilesDocument.bytes),
  };
  let evidence;
  if (dryRun) {
    evidence = plannedEvidence(shared);
    process.stdout.write(`Network requests: 0\nExact confirmation for this plan:\n${plan.confirmation}\n`);
  } else {
    const manifestPathOption = option(args, '--manifest-url-file');
    if (!manifestPathOption) throw new Error('--manifest-url-file is required for a network run');
    const manifestPath = resolve(manifestPathOption);
    const provideManifestUrl = createManifestUrlProvider(manifestPath);
    const clockOffsetMs = numberOption(args, '--clock-offset-ms');
    if (clockOffsetMs === null) throw new Error('--clock-offset-ms is required for a network run');
    const controller = new AbortController();
    const abort = () => controller.abort();
    process.once('SIGINT', abort);
    process.once('SIGTERM', abort);
    evidence = await runShard({
      ...shared,
      confirmation: option(args, '--confirm'),
      manifestUrlProvider: provideManifestUrl,
      externalGenerator: args.includes('--external-generator'),
      declaredGeneratorRole: process.env.EARLY_BIRDS_GENERATOR_ROLE,
      clockOffsetMs,
      onProgress: (progress) => {
        process.stdout.write(
          `Progress requests=${progress.requests} failed=${progress.failed} `
          + `bytes=${progress.bytes} fetch_misses=${progress.fetchMisses} `
          + `clients=${progress.clientsCompleted}/${progress.clientsStarted}\n`,
        );
      },
      signal: controller.signal,
    });
  }
  await mkdir(dirname(evidencePath), { recursive: true });
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  process.stdout.write(`Evidence: ${evidencePath}\nStatus: ${evidence.status}\n`);
  if (evidence.status === 'FAIL') process.exitCode = 1;
  if (evidence.status === 'ABORTED') process.exitCode = 130;
}

main().catch((error) => {
  process.stderr.write(
    `EarlyBird HLS load harness refused or failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
