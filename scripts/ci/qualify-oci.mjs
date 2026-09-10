#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { candidateIdentitySha256, validateCandidateManifest } from './release-manifest.mjs';

const REF = /^[a-z0-9./-]+@sha256:[0-9a-f]{64}$/u;
const PROJECT = /^[a-z0-9][a-z0-9_-]{0,40}$/u;
const SERVICES = ['postgres', 'livekit', 'app', 'commerce-reconciler', 'tapestry', 'playlist-bot', 'analytics'];

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
      if (options[arg.slice(2)] !== undefined) fail(`duplicate option: ${arg}`);
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
  const prefix = ['compose', '--file', compose, '--project-name', project, '--profile', 'analytics'];
  return [
    ...Object.values(refs).map((ref) => ({ file: 'docker', args: ['pull', ref] })),
    { file: 'docker', args: [...prefix, 'up', '--detach', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120', 'postgres', 'livekit'] },
    { file: 'docker', args: [...prefix, 'run', '--rm', '--no-deps', '--no-build', '--pull', 'never', 'migrate', 'npx', 'prisma', 'migrate', 'deploy'] },
    { file: 'docker', args: [...prefix, 'run', '--rm', '--no-deps', '--no-build', '--pull', 'never', 'analytics', 'node', 'src/migrate.mjs'] },
    { file: 'docker', args: [...prefix, 'up', '--detach', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180', ...SERVICES.filter((service) => service !== 'migrate')] },
  ];
}

function refsFromManifest(manifest) {
  const refs = Object.fromEntries(manifest.artifacts.map((entry) => [entry.artifactId, `${entry.repository}@${entry.digest}`]));
  for (const entry of manifest.externalImages) refs[entry.serviceId] = `${entry.repository}@${entry.digest}`;
  validateRefs(refs);
  return refs;
}

function composeOutput(args, env) {
  return execFileSync('docker', args, { encoding: 'utf8', env });
}

function parseComposePs(output) {
  const trimmed = output.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) return JSON.parse(trimmed);
  return trimmed.split('\n').map((line) => JSON.parse(line));
}

export function verifyRunningImages({ compose, project, refs, env }) {
  const prefix = ['compose', '--file', compose, '--project-name', project, '--profile', 'analytics'];
  const rows = parseComposePs(composeOutput([...prefix, 'ps', '--format', 'json'], env));
  const expectedByService = {
    postgres: refs.postgres,
    livekit: refs.livekit,
    app: refs.app,
    'commerce-reconciler': refs.app,
    tapestry: refs.tapestry,
    'playlist-bot': refs['playlist-bot'],
    analytics: refs.analytics,
  };
  for (const service of SERVICES) {
    const row = rows.find((entry) => entry.Service === service);
    if (!row || row.State !== 'running' || (row.Health && row.Health !== 'healthy')) {
      fail(`${service} is not running and healthy`);
    }
    const container = row.Name;
    const actualId = composeOutput(['inspect', container, '--format', '{{.Image}}'], env).trim();
    const expectedId = composeOutput(['image', 'inspect', expectedByService[service], '--format', '{{.Id}}'], env).trim();
    if (!actualId || actualId !== expectedId) fail(`${service} is not running the pulled exact digest`);
  }
}

function curlJson(url) {
  const body = execFileSync('curl', [
    '--fail', '--silent', '--show-error', '--max-time', '10', url,
  ], { encoding: 'utf8' });
  return JSON.parse(body);
}

export function verifyBehavior({ manifest }) {
  execFileSync('curl', [
    '--fail', '--silent', '--show-error', '--max-time', '10', '--output', '/dev/null',
    'http://127.0.0.1:7880',
  ]);
  const health = curlJson('http://127.0.0.1:3210/api/health');
  if (health.status !== 'ok' || health.gitSha !== manifest.source.gitSha ||
      health.configProfileSha256 !== manifest.configProfiles['live-staging'].sha256 ||
      health.artifactDigest !== `${manifest.artifacts.find((entry) => entry.artifactId === 'app').repository}@${manifest.artifacts.find((entry) => entry.artifactId === 'app').digest}`) {
    fail('application health provenance mismatch');
  }
  const ready = curlJson('http://127.0.0.1:3210/api/health/ready');
  if (ready.status !== 'ok') fail('application is not ready');
  if (curlJson('http://127.0.0.1:3211/health').status !== 'ok') fail('tapestry behavior check failed');
  if (curlJson('http://127.0.0.1:3212/ready').status !== 'ready') fail('analytics behavior check failed');
}

export function main(argv = process.argv.slice(2)) {
  const options = parseQualificationArgs(argv);
  const manifest = JSON.parse(readFileSync(resolve(options.manifest), 'utf8'));
  validateCandidateManifest(manifest);
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
    HB_CONFIG_PROFILE_SHA256: manifest.configProfiles['live-staging'].sha256,
  };
  try {
    for (const command of commands) execFileSync(command.file, command.args, { stdio: 'inherit', env });
    verifyRunningImages({ compose: options.compose, project, refs, env });
    verifyBehavior({ manifest });
    if (options.receipt) {
      const receipt = {
        schemaVersion: 'oci-qualification.v2',
        result: 'success',
        workflowRunId: manifest.build.workflowRunId,
        workflowRunAttempt: manifest.build.workflowRunAttempt,
        candidateIdentitySha256: candidateIdentitySha256(manifest),
        imageRefs: refs,
        checkedServices: SERVICES,
      };
      writeFileSync(resolve(options.receipt), `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    }
    return 0;
  } finally {
    execFileSync('docker', [
      'compose', '--file', options.compose, '--project-name', project, '--profile', 'analytics',
      'down', '--remove-orphans', '--volumes',
    ], { stdio: 'inherit', env });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); } catch (error) {
    console.error(error instanceof Error ? error.message : 'OCI qualification failed');
    process.exitCode = 1;
  }
}
