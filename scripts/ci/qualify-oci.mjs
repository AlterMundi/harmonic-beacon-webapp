#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalize, candidateIdentitySha256, validateCandidateManifest, validateQualificationEvidence, validateQualificationReceipt } from './release-manifest.mjs';

const REF = /^[a-z0-9./-]+@sha256:[0-9a-f]{64}$/u;
const PROJECT = /^[a-z0-9][a-z0-9_-]{0,40}$/u;
const SERVICES = ['postgres', 'livekit', 'app', 'commerce-reconciler', 'tapestry', 'playlist-bot', 'analytics'];
export { validateQualificationEvidence } from './release-manifest.mjs';

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
    { file: 'docker', args: [...prefix, 'exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'beacon_qualification', '-d', 'beacon_qualification'], inputFile: 'db/test-fixture.sql' },
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

function composeOutput(args, env, execute = execFileSync) {
  return execute('docker', args, { encoding: 'utf8', env });
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

function composePrefix(compose, project) {
  return ['compose', '--file', compose, '--project-name', project, '--profile', 'analytics'];
}

function composeExec({ compose, project, env, execute = execFileSync }, service, args, { input, binary = false } = {}) {
  return execute('docker', [...composePrefix(compose, project), 'exec', '-T', service, ...args], {
    ...(binary ? {} : { encoding: 'utf8' }), env, input,
  });
}

export function verifyAcceptanceMatrix({ compose, project, refs, env, manifest, execute = execFileSync, baseUrl = 'http://127.0.0.1:3210' }) {
  const context = { compose, project, env, execute };
  const expectedHead = manifest.migrationSet.head;
  const observedHead = composeExec(context, 'postgres', [
    'psql', '-At', '-U', 'beacon_qualification', '-d', 'beacon_qualification', '-c',
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name DESC LIMIT 1',
  ]).trim();
  if (observedHead !== expectedHead) fail('schema head mismatch');

  const browserReport = JSON.parse(execute('npx', [
    'playwright', 'test', 'e2e/tests/oci-qualification.spec.ts', '--project=chromium',
    '--retries=0', '--workers=1', '--reporter=json',
  ], {
    encoding: 'utf8',
    env: {
      ...env, CI: '1', E2E_BASE_URL: baseUrl,
      HB_QUALIFICATION_SOURCE_SHA: manifest.source.gitSha,
      HB_QUALIFICATION_APP_REF: refs.app,
      HB_QUALIFICATION_CONFIG_SHA256: manifest.configProfiles['live-staging'].sha256,
    },
  }));
  const browser = {
    engine: 'chromium',
    passed: browserReport.stats?.expected ?? 0,
    failed: browserReport.stats?.unexpected ?? 0,
    skipped: browserReport.stats?.skipped ?? 0,
  };

  const sessionCount = Number(composeExec(context, 'postgres', [
    'psql', '-At', '-U', 'beacon_qualification', '-d', 'beacon_qualification', '-c',
    "SELECT count(*) FROM web_sessions WHERE display_name='OCI Qualification Admin'",
  ]).trim());
  const heartbeatAge = Number(composeExec(context, 'commerce-reconciler', [
    'node', '-e', "const fs=require('fs');const n=Number(fs.readFileSync('/tmp/commerce-reconciler-heartbeat','utf8'));process.stdout.write(String(Date.now()-n))",
  ]).trim());
  const [pending, processing] = composeExec(context, 'postgres', [
    'psql', '-At', '-F', ',', '-U', 'beacon_qualification', '-d', 'beacon_qualification', '-c',
    "SELECT count(*) FILTER (WHERE status='PENDING'), count(*) FILTER (WHERE status='PROCESSING') FROM (SELECT status::text FROM commerce_media_outbox UNION ALL SELECT status::text FROM stage_grant_effect_outbox) backlog",
  ]).trim().split(',').map(Number);

  const internalNetworks = ['database', 'media'];
  for (const network of internalNetworks) {
    if (composeOutput(['network', 'inspect', `${project}_${network}`, '--format', '{{.Internal}}'], env, execute).trim() !== 'true') {
      fail(`${network} qualification network is not internal`);
    }
  }
  const forbidden = ['HB_REGISTRY_TOKEN', 'HB_REGISTRY_USERNAME', 'GITHUB_TOKEN', 'GH_TOKEN', 'BEACON_ACCOUNT_CLIENT_SECRET', 'BEACON_COMMERCE_SERVICE_KEY_CURRENT'];
  const forbiddenSecretNamesFound = [];
  for (const row of parseComposePs(composeOutput([...composePrefix(compose, project), 'ps', '--format', 'json'], env, execute))) {
    const names = composeOutput(['inspect', row.Name, '--format', '{{range .Config.Env}}{{println .}}{{end}}'], env, execute)
      .split('\n').map((line) => line.split('=')[0]);
    for (const name of forbidden) if (names.includes(name)) forbiddenSecretNamesFound.push(`${row.Service}:${name}`);
  }

  const dump = composeExec(context, 'postgres', [
    'pg_dump', '--no-owner', '--no-privileges', '-U', 'beacon_qualification', 'beacon_qualification',
  ], { binary: true });
  const restoreDb = 'beacon_qualification_restore';
  composeExec(context, 'postgres', ['dropdb', '--if-exists', '--force', '-U', 'beacon_qualification', restoreDb]);
  composeExec(context, 'postgres', ['createdb', '-U', 'beacon_qualification', restoreDb]);
  try {
    composeExec(context, 'postgres', [
      'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'beacon_qualification', '-d', restoreDb,
    ], { input: dump });
    const restoredSessionCount = Number(composeExec(context, 'postgres', [
      'psql', '-At', '-U', 'beacon_qualification', '-d', restoreDb, '-c', 'SELECT count(*) FROM web_sessions',
    ]).trim());
    return validateQualificationEvidence({
      browser,
      syntheticSession: { created: sessionCount, authenticatedRole: 'ADMIN' },
      commerce: { workerHeartbeatAgeMs: heartbeatAge, pending, processing },
      schema: { expectedHead, observedHead },
      isolation: { internalNetworks, forbiddenSecretNamesFound },
      restore: {
        backupSha256: `sha256:${createHash('sha256').update(dump).digest('hex')}`,
        backupBytes: dump.length,
        restoredSessionCount,
      },
    });
  } finally {
    composeExec(context, 'postgres', ['dropdb', '--if-exists', '--force', '-U', 'beacon_qualification', restoreDb]);
  }
}

export function main(argv = process.argv.slice(2)) {
  const measurementStartedAt = new Date().toISOString();
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
    for (const command of commands) {
      execFileSync(command.file, command.args, {
        stdio: command.inputFile ? ['pipe', 'inherit', 'inherit'] : 'inherit',
        env,
        input: command.inputFile ? readFileSync(resolve(command.inputFile)) : undefined,
      });
    }
    verifyRunningImages({ compose: options.compose, project, refs, env });
    verifyBehavior({ manifest });
    const acceptance = verifyAcceptanceMatrix({ compose: options.compose, project, refs, env, manifest });
    if (options.receipt) {
      const receipt = {
        schemaVersion: 'oci-qualification.v3',
        qualificationJob: 'qualify', measurementStartedAt,
        measurementCompletedAt: new Date().toISOString(), issuedAt: new Date().toISOString(),
        result: 'success',
        workflowRunId: manifest.build.workflowRunId,
        workflowRunAttempt: manifest.build.workflowRunAttempt,
        candidateIdentitySha256: candidateIdentitySha256(manifest),
        imageRefs: refs,
        checkedServices: SERVICES,
        acceptance,
      };
      validateQualificationReceipt(receipt, manifest);
      writeFileSync(resolve(options.receipt), canonicalize(receipt), { flag: 'wx', mode: 0o600 });
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
