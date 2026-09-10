#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { candidateIdentitySha256 } from './release-manifest.mjs';

const REF = /^[a-z0-9./-]+@sha256:[0-9a-f]{64}$/u;
const PROJECT = /^[a-z0-9][a-z0-9_-]{0,40}$/u;

function fail(message) {
  throw new Error(`OCI qualification: ${message}`);
}

export function parseQualificationArgs(argv) {
  const options = { noBuild: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--no-build') options.noBuild = true;
    else if (arg.startsWith('--')) {
      const value = argv[++index];
      if (!value) fail(`${arg} requires a value`);
      options[arg.slice(2)] = value;
    } else fail(`unexpected argument: ${arg}`);
  }
  if (!options.noBuild) fail('--no-build is mandatory');
  if (!options.manifest || !options.compose) fail('--manifest and --compose are required');
  return options;
}

function validateRefs(refs) {
  for (const id of ['app', 'tapestry', 'playlist-bot', 'analytics', 'postgres', 'livekit']) {
    if (!REF.test(refs[id] ?? '')) fail(`missing exact ${id} registry reference`);
  }
}

export function qualificationCommands({ compose, project, refs }) {
  if (typeof compose !== 'string' || !compose.endsWith('.yml')) fail('invalid compose path');
  if (!PROJECT.test(project)) fail('invalid project name');
  validateRefs(refs);
  const prefix = ['compose', '--file', compose, '--project-name', project];
  return [
    { file: 'docker', args: [...prefix, 'up', '--no-start', '--no-build', '--pull', 'never'] },
    { file: 'docker', args: [...prefix, 'run', '--rm', '--no-deps', '--no-build', '--pull', 'never', 'migrate', 'npx', 'prisma', 'migrate', 'deploy'] },
    { file: 'docker', args: [...prefix, 'up', '--detach', '--no-build', '--pull', 'never', 'app', 'commerce-reconciler', 'livekit', 'tapestry', 'playlist-bot'] },
  ];
}

function refsFromManifest(manifest) {
  const refs = Object.fromEntries(manifest.artifacts.map((entry) => [entry.artifactId, `${entry.repository}@${entry.digest}`]));
  for (const entry of manifest.externalImages) refs[entry.serviceId] = `${entry.repository}@${entry.digest}`;
  return refs;
}

export function main(argv = process.argv.slice(2)) {
  const options = parseQualificationArgs(argv);
  const manifest = JSON.parse(readFileSync(resolve(options.manifest), 'utf8'));
  const refs = refsFromManifest(manifest);
  const project = options.project ?? `hbq-${manifest.source?.gitSha?.slice(0, 12) ?? ''}`;
  const commands = qualificationCommands({ compose: options.compose, project, refs });
  const env = {
    ...process.env,
    HB_APP_IMAGE_REF: refs.app,
    HB_TAPESTRY_IMAGE_REF: refs.tapestry,
    HB_PLAYLIST_IMAGE_REF: refs['playlist-bot'],
    HB_ANALYTICS_IMAGE_REF: refs.analytics,
    HB_POSTGRES_IMAGE_REF: refs.postgres,
    HB_LIVEKIT_IMAGE_REF: refs.livekit,
  };
  try {
    for (const command of commands) execFileSync(command.file, command.args, { stdio: 'inherit', env });
    if (options.receipt) {
      const receipt = {
        schemaVersion: 'harmonic-beacon.qualification.v1',
        candidateIdentitySha256: candidateIdentitySha256(manifest),
        imageRefs: refs,
        result: 'success',
      };
      writeFileSync(resolve(options.receipt), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    }
    return 0;
  } finally {
    execFileSync('docker', [
      'compose', '--file', options.compose, '--project-name', project,
      'down', '--remove-orphans', '--volumes',
    ], { stdio: 'inherit', env });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'OCI qualification failed');
    process.exitCode = 1;
  }
}
