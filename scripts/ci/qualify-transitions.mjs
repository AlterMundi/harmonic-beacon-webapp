#!/usr/bin/env node
// Hosted measurement producer only. Outputs remain unsigned until the owning workflow seals them.
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize, publicConfigSha256 as digest, validateReleaseManifest, validateQualificationReceipt, validateTransitionEvidence, verifyRuntimePublicConfig } from './release-manifest.mjs';
import { validateEvidenceStatement } from '../../deploy/hb-artifact-verify.mjs';
import { verifyAcceptanceMatrix } from './qualify-oci.mjs';

const IDENTITY = 'https://github.com/AlterMundi/harmonic-beacon-webapp/.github/workflows/oci-candidate.yml@refs/heads/main';
const SERVICES = ['postgres', 'livekit', 'app', 'commerce-reconciler', 'tapestry', 'playlist-bot', 'analytics'];
const APPS = SERVICES.slice(2);
const LIMIT = 16 * 1024 * 1024;
const TIMEOUT = 240000;
const RECOVERY = 900000;
const harness = fileURLToPath(new URL('../../deploy/qualification.compose.yml', import.meta.url));
const fail = message => { throw Error(`transition qualification: ${message}`); };
const equal = (a, b, label) => { if (canonicalize(a) !== canonicalize(b)) fail(label); };
const refsOf = m => Object.fromEntries([...m.artifacts.map(a => [a.artifactId, `${a.repository}@${a.digest}`]), ...m.externalImages.map(a => [a.serviceId, `${a.repository}@${a.digest}`])]);
const refFor = (refs, service) => refs[['commerce-reconciler', 'migrate'].includes(service) ? 'app' : service];

function read(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size < 1 || stat.size > LIMIT) fail('unsafe input');
    const buffer = Buffer.alloc(stat.size + 1);
    const count = readSync(fd, buffer, 0, buffer.length, 0);
    const bytes = buffer.subarray(0, count);
    const after = fstatSync(fd);
    if (bytes.length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) fail('input changed');
    return bytes;
  } finally { closeSync(fd); }
}
function json(bytes) {
  const value = JSON.parse(bytes);
  if (!Buffer.from(canonicalize(value)).equals(bytes)) fail('noncanonical input');
  return value;
}
export function commandRunner(file, args, options) {
  const result = spawnSync(file, args, { ...options, shell: false, encoding: null, stdio: ['pipe', 'pipe', 'pipe'], timeout: options.timeout, killSignal: 'SIGKILL', maxBuffer: LIMIT });
  return { exitCode: result.status, timedOut: !!result.error, stdout: result.stdout ?? Buffer.alloc(0), stderr: result.stderr ?? Buffer.alloc(0) };
}

// Runner and time are injectable, never selectable by the hosted CLI.
export function qualifyTransitions(options, { runner = commandRunner, clock = Date.now, random = randomBytes, projectId } = {}) {
  const project = projectId ?? `hbt-${random(16).toString('hex')}`;
  if (!/^hbt-[a-z0-9]{16,32}$/u.test(project)) fail('invalid isolated project');
  if (resolve(options.candidateDir) === resolve(options.baseDir)) fail('candidate and base must be separate');
  const scratch = mkdtempSync(join(tmpdir(), `${project}-`));
  const compose = join(scratch, 'runtime.yml');
  const prefix = ['compose', '--file', compose, '--project-name', project, '--profile', 'analytics'];
  // Do not inherit Compose overrides, application secrets, or alternate Docker contexts.
  const env = Object.fromEntries(['PATH', 'HOME', 'DOCKER_CONFIG'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  let commands = [];
  let logical = 'check-compatibility';
  let lastTime = -1;
  let active = false;
  let cleaning = false;
  let deadline = Infinity;
  const now = () => {
    const value = cleaning ? Math.max(lastTime, Date.now()) : clock();
    if (!Number.isSafeInteger(value) || value < lastTime) fail('out-of-order timestamps');
    lastTime = value;
    return value;
  };
  const iso = () => new Date(now()).toISOString();
  const execute = (file, args, opts = {}) => {
    if (!Array.isArray(args) || !args.length || args.some(a => typeof a !== 'string')) fail('missing command');
    if (file === 'npx') args = ['--no-install', ...args];
    const start = now();
    const timeout = Math.min(TIMEOUT, deadline - start);
    if (timeout <= 0) fail('recovery timeout');
    let result;
    try { result = runner(file, args, { env: opts.env ?? env, input: opts.input, timeout, maxBuffer: LIMIT }); }
    catch { fail('command failed'); }
    const end = now();
    const stdout = Buffer.from(result?.stdout ?? '');
    const stderr = Buffer.from(result?.stderr ?? '');
    const invocation = {
      file,
      args,
      environment: opts.env ?? env,
      stdinSha256: opts.input === undefined ? null : digest(Buffer.from(opts.input)),
    };
    commands.push({ name: logical, argvSha256: digest(canonicalize(invocation)), startedAt: new Date(start).toISOString(), completedAt: new Date(end).toISOString(), exitCode: result?.exitCode ?? -1, stdoutSha256: digest(stdout), stderrSha256: digest(stderr) });
    if (!result || result.timedOut || result.exitCode !== 0 || end - start > timeout || stdout.length > LIMIT || stderr.length > LIMIT) fail('command nonzero/timeout/capture failure');
    return opts.encoding === 'utf8' ? stdout.toString('utf8') : stdout;
  };
  const docker = args => execute('docker', args, { encoding: 'utf8' });
  const dc = args => docker([...prefix, ...args]);
  const snapshot = (root, relative, name) => {
    const bytes = read(join(root, relative));
    const path = join(scratch, name);
    writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
    return { bytes, path };
  };
  const verifyBlob = (blob, bundle) => execute('cosign', ['verify-blob', '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com', '--certificate-identity', IDENTITY, '--bundle', bundle.path, blob.path]);
  function authenticate(root, label) {
    const manifest = snapshot(root, 'release-manifest.json', `${label}-manifest.json`);
    const receipt = snapshot(root, 'qualification-receipt.json', `${label}-qualification.json`);
    verifyBlob(manifest, snapshot(root, 'release-manifest.signature.bundle.json', `${label}-manifest.bundle.json`));
    verifyBlob(receipt, snapshot(root, 'qualification-receipt.signature.bundle.json', `${label}-qualification.bundle.json`));
    return { bytes: manifest.bytes, qualificationBytes: receipt.bytes, root, label };
  }
  function validate(input, expected) {
    const m = validateReleaseManifest(json(input.bytes));
    equal({ manifestSha256: digest(input.bytes).slice(7), sourceSha: m.source.gitSha, sourceTree: m.source.gitTree, runId: m.build.workflowRunId, runAttempt: m.build.workflowRunAttempt }, expected, 'source/run/attempt/manifest contradiction');
    if (digest(input.qualificationBytes) !== m.qualification.receiptSha256) fail('qualification hash mismatch');
    validateQualificationReceipt(json(input.qualificationBytes), m);
    const configs = {};
    for (const [relative, hash] of [['docker-compose.yml', m.deploymentInputs.composeSha256], ['deploy/oci-images.compose.yml', m.deploymentInputs.overlaySha256], ...Object.entries(m.configProfiles).map(([key, value]) => [`deploy/runtime-public-config/${key}.json`, value.sha256])]) {
      const bytes = read(join(input.root, relative));
      if (digest(bytes) !== hash) fail('config/Compose/overlay contradiction');
      if (relative.startsWith('deploy/runtime-public-config/')) configs[relative] = JSON.parse(bytes);
      else if (digest(read(fileURLToPath(new URL(`../../${relative}`, import.meta.url)))) !== hash) fail('Compose/overlay transition unsupported by reviewed harness');
    }
    for (const a of m.artifacts) {
      const dir = join(input.root, 'evidence', `oci-evidence-${a.artifactId}`);
      const recordBytes = read(join(dir, 'evidence.json'));
      if (digest(recordBytes) !== a.evidenceRecordDigest) fail('evidence record hash mismatch');
      const record = JSON.parse(recordBytes);
      equal(record, { artifactId: a.artifactId, repository: a.repository, digest: a.digest, dockerfile: a.dockerfile, sourceSha: m.source.gitSha, sourceTree: m.source.gitTree, workflowRunId: m.build.workflowRunId, workflowRunAttempt: m.build.workflowRunAttempt, sbomDigest: a.sbom.digest, sbomSignatureBundleDigest: a.sbom.signatureBundleDigest, provenanceDigest: a.provenance.digest, provenanceSignatureBundleDigest: a.provenance.signatureBundleDigest, signatureBundleDigest: a.signature.bundleDigest }, 'artifact provenance contradiction');
      const files = {};
      for (const [name, hash] of [['signature.bundle.json', a.signature.bundleDigest], ['sbom.bundle.json', a.sbom.digest], ['sbom.signature.bundle.json', a.sbom.signatureBundleDigest], ['provenance.bundle.json', a.provenance.digest], ['provenance.signature.bundle.json', a.provenance.signatureBundleDigest]]) {
        files[name] = snapshot(dir, name, `${input.label}-${a.artifactId}-${name}`);
        if (digest(files[name].bytes) !== hash) fail('artifact signature/evidence digest mismatch');
      }
      execute('cosign', ['verify', '--certificate-oidc-issuer', 'https://token.actions.githubusercontent.com', '--certificate-identity', IDENTITY, '--bundle', files['signature.bundle.json'].path, `${a.repository}@${a.digest}`]);
      for (const kind of ['sbom', 'provenance']) {
        verifyBlob(files[`${kind}.bundle.json`], files[`${kind}.signature.bundle.json`]);
        validateEvidenceStatement(JSON.parse(files[`${kind}.bundle.json`].bytes), record, kind === 'sbom' ? 'SBOM' : kind);
      }
    }
    return { ...input, configs, manifest: m, refs: refsOf(m), hash: digest(input.bytes).slice(7) };
  }
  let spec;
  let target;
  let candidate;
  const profiles = {};
  const apply = runtime => {
    for (const [service, value] of Object.entries(spec.services)) value.image = refFor(runtime.refs, service);
    const profile = profiles[target];
    const publicEnv = {
      PUBLIC_ORIGIN: profile.publicOrigin, BEACON_PUBLIC_ORIGIN: profile.publicOrigin,
      LIVEKIT_PUBLIC_URL: profile.livekitPublicUrl, LIVEKIT_PUBLIC_URL_ALLOWLIST: profile.livekitPublicUrl,
      TAPESTRY_PUBLIC_ENABLED: String(profile.featureFlags.tapestryPublic), PROMO_INVITATIONS_ENABLED: String(profile.featureFlags.promoInvitations),
    };
    for (const service of ['migrate', 'app', 'commerce-reconciler']) Object.assign(spec.services[service].environment, publicEnv);
    Object.assign(spec.services.app.environment, { BEACON_ARTIFACT_DIGEST: runtime.refs.app, BEACON_CONFIG_PROFILE_SHA256: candidate.manifest.configProfiles[target].sha256 });
    verifyRuntimePublicConfig(profile, Buffer.from(Object.entries(publicEnv).map(([k, v]) => `${k}=${v}`).join('\n')));
    writeFileSync(compose, canonicalize(spec), { mode: 0o600 });
    // Confirm the actual Compose interpretation before every mutation.
    const actual = JSON.parse(dc(['config', '--format', 'json']));
    for (const [service, value] of Object.entries(actual.services)) {
      if (value.image !== refFor(runtime.refs, service) || value.build || value.volumes?.length || value.network_mode || value.privileged) fail('wrong images/unsafe Compose');
      equal(value.environment ?? {}, spec.services[service].environment ?? {}, 'wrong config');
    }
    equal(Object.keys(actual.services).sort(), Object.keys(spec.services).sort(), 'Compose service contradiction');
  };
  const up = () => dc(['up', '--detach', '--no-deps', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '180', ...APPS]);
  const migrate = () => {
    dc(['run', '--rm', '--no-deps', '--no-build', '--pull', 'never', 'migrate', 'npx', '--no-install', 'prisma', 'migrate', 'deploy']);
    dc(['run', '--rm', '--no-deps', '--no-build', '--pull', 'never', 'analytics', 'node', 'src/migrate.mjs']);
  };
  const urls = () => Object.fromEntries([['app', 3000], ['livekit', 7880], ['tapestry', 3100], ['analytics', 3300]].map(([service, port]) => {
    const address = dc(['port', service, String(port)]).trim();
    if (!/^127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(address) || Number(address.split(':')[1]) > 65535) fail('unsafe published port');
    return [service, `http://${address}`];
  }));
  const seen = new Set();
  function measure(runtime) {
    logical = 'measure-runtime';
    const offset = commands.length;
    const privateCommands = [];
    const rowsText = dc(['ps', '--format', 'json']).trim();
    const rows = rowsText.startsWith('[') ? JSON.parse(rowsText) : rowsText.split('\n').map(JSON.parse);
    equal(rows.map(r => r.Service).sort(), [...SERVICES].sort(), 'runtime services mismatch');
    for (const service of SERVICES) {
      const row = rows.find(r => r.Service === service);
      if (row.State !== 'running' || (row.Health && row.Health !== 'healthy')) fail('runtime unhealthy');
      const details = JSON.parse(docker(['inspect', row.ID]));
      privateCommands.push(commands.at(-1));
      if (details.length !== 1) fail('container inspect mismatch');
      const d = details[0];
      if (d.Config.Labels['com.docker.compose.project'] !== project || d.Config.Labels['com.docker.compose.service'] !== service) fail('foreign container');
      if (d.Image !== docker(['image', 'inspect', refFor(runtime.refs, service), '--format', '{{.Id}}']).trim() || !/^sha256:[a-f0-9]{64}$/u.test(d.Image)) fail('wrong images');
      const environment = Object.fromEntries(d.Config.Env.map(v => { const at = v.indexOf('='); return [v.slice(0, at), v.slice(at + 1)]; }));
      for (const [key, value] of Object.entries(spec.services[service].environment ?? {})) if (environment[key] !== String(value)) fail('wrong runtime config');
      if (service === 'app') {
        verifyRuntimePublicConfig(profiles[target], Buffer.from(d.Config.Env.join('\n')));
        if (environment.BEACON_ARTIFACT_DIGEST !== runtime.refs.app || environment.BEACON_CONFIG_PROFILE_SHA256 !== candidate.manifest.configProfiles[target].sha256) fail('wrong config');
      }
      if (d.HostConfig.Privileged || d.HostConfig.NetworkMode === 'host' || d.Mounts.some(m => m.Type === 'bind')) fail('private boundary violation');
      for (const ports of Object.values(d.NetworkSettings.Ports)) for (const p of ports ?? []) if (p.HostIp !== '127.0.0.1') fail('private port exposed');
    }
    const endpoints = urls();
    const get = (url, raw = false) => {
      const body = execute('curl', ['--fail', '--silent', '--show-error', '--max-time', '10', url], { encoding: 'utf8' });
      return raw ? body : JSON.parse(body);
    };
    const health = get(`${endpoints.app}/api/health`);
    if (!Number.isFinite(health.uptime) || health.uptime <= 0 || seen.has(digest(canonicalize(health)))) fail('static/reused health measurement');
    seen.add(digest(canonicalize(health)));
    if (health.status !== 'ok' || health.gitSha !== runtime.manifest.source.gitSha || health.artifactDigest !== runtime.refs.app || health.configProfileSha256 !== candidate.manifest.configProfiles[target].sha256) fail('health provenance/config mismatch');
    if (get(`${endpoints.app}/api/health/ready`).status !== 'ok' || get(`${endpoints.tapestry}/health`).status !== 'ok' || get(`${endpoints.analytics}/ready`).status !== 'ready') fail('behavior unhealthy');
    get(endpoints.livekit, true);
    const healthCommands = commands.slice(offset);
    const privateOffset = commands.length;
    for (const network of ['database', 'media']) if (docker(['network', 'inspect', `${project}_${network}`, '--format', '{{.Internal}}']).trim() !== 'true') fail('private network not internal');
    // Hash independently timestamped measurement transcripts, never a constant success flag.
    const result = { manifestSha256: runtime.hash, configSha256: candidate.manifest.configProfiles[target].sha256, healthSha256: digest(canonicalize(healthCommands)), privateBoundarySha256: digest(canonicalize([...privateCommands, ...commands.slice(privateOffset)])) };
    for (const hash of [result.healthSha256, result.privateBoundarySha256]) { if (seen.has(hash)) fail('static/reused measurements'); seen.add(hash); }
    return { result, endpoints };
  }
  function acceptance(runtime, endpoints, schema) {
    logical = 'check-compatibility';
    verifyAcceptanceMatrix({ compose, project, refs: runtime.refs, env, execute, baseUrl: endpoints.app,
      manifest: { ...runtime.manifest, migrationSet: schema, configProfiles: { 'live-staging': candidate.manifest.configProfiles[target] } } });
  }
  try {
    // Authenticate BOTH final blobs for BOTH releases before interpreting either release.
    const authenticatedCandidate = authenticate(options.candidateDir, 'candidate');
    const authenticatedBase = authenticate(options.baseDir, 'base');
    candidate = validate(authenticatedCandidate, options.candidate);
    const base = validate(authenticatedBase, options.base);
    if (candidate.manifest.promotion.baseManifestSha256 !== base.hash) fail('base hash mismatch');
    equal(candidate.manifest.externalImages, base.manifest.externalImages, 'shared dependency contradiction');
    equal(candidate.manifest.deploymentInputs, base.manifest.deploymentInputs, 'Compose/overlay transition unsupported');
    const time = now();
    if (Date.parse(candidate.manifest.qualification.qualifiedAt) > time || time >= Date.parse(candidate.manifest.qualification.expiresAt)) fail('candidate qualification stale');
    for (const profile of ['live-staging', 'production']) profiles[profile] = candidate.configs[`deploy/runtime-public-config/${profile}.json`];
    const refsEnv = { ...env, HB_APP_IMAGE_REF: base.refs.app, HB_TAPESTRY_IMAGE_REF: base.refs.tapestry, HB_PLAYLIST_IMAGE_REF: base.refs['playlist-bot'], HB_ANALYTICS_IMAGE_REF: base.refs.analytics, HB_POSTGRES_IMAGE_REF: base.refs.postgres, HB_LIVEKIT_IMAGE_REF: base.refs.livekit, HB_CONFIG_PROFILE_SHA256: candidate.manifest.configProfiles['live-staging'].sha256 };
    spec = JSON.parse(execute('docker', ['compose', '--file', harness, '--project-name', project, '--profile', 'analytics', 'config', '--format', 'json'], { env: refsEnv, encoding: 'utf8' }));
    delete spec.name;
    for (const value of Object.values(spec.services)) {
      if (value.build || value.volumes?.length || value.container_name || value.network_mode || value.privileged || !/^[a-z0-9./-]+@sha256:[a-f0-9]{64}$/u.test(value.image)) fail('unsafe qualification harness');
      for (const port of value.ports ?? []) { port.host_ip = '127.0.0.1'; port.published = '0'; }
      delete value.depends_on;
    }
    for (const key of ['ANALYTICS_DATABASE_URL', 'ANALYTICS_DATABASE_ADMIN_URL', 'ANALYTICS_DASHBOARD_DATABASE_URL']) spec.services.analytics.environment[key] = 'postgresql://beacon_qualification:qualification-only@postgres:5432/beacon_qualification';
    for (const [name, value] of Object.entries(spec.networks)) value.name = `${project}_${name}`;
    target = 'live-staging';
    apply(base);
    for (const ref of new Set([...Object.values(base.refs), ...Object.values(candidate.refs)])) docker(['pull', ref]);
    active = true;
    dc(['up', '--detach', '--no-build', '--pull', 'never', '--wait', '--wait-timeout', '120', 'postgres', 'livekit']);
    migrate();
    dc(['run', '--rm', '--no-deps', '--no-build', '--pull', 'never', 'migrate', 'npx', '--no-install', 'tsx', 'prisma/seed-test-fixtures.ts']);
    up();
    const initial = measure(base);
    acceptance(base, initial.endpoints, base.manifest.migrationSet);
    const stages = {};
    const binding = { candidateManifestSha256: candidate.hash, baseManifestSha256: base.hash, qualificationReceiptSha256: candidate.manifest.qualification.receiptSha256, workflowRunId: candidate.manifest.build.workflowRunId, workflowRunAttempt: candidate.manifest.build.workflowRunAttempt };
    for (const stage of ['shadow', 'rollback', 'forward-repair']) {
      commands = [];
      const startedAt = iso();
      deadline = Date.parse(startedAt) + RECOVERY;
      // Production-config normalization is part of the measured rollback
      // rehearsal rather than an unrecorded setup mutation before the stage.
      if (stage === 'rollback') {
        target = 'production';
        logical = 'replace-runtime';
        apply(candidate);
        up();
      }
      const before = stage === 'rollback' ? candidate : base;
      const after = stage === 'rollback' ? base : candidate;
      const runtimeBefore = measure(before).result;
      logical = stage === 'shadow' ? 'migrate-candidate' : 'replace-runtime';
      apply(after);
      if (stage === 'shadow') migrate();
      logical = 'replace-runtime';
      up();
      const measured = measure(after);
      acceptance(after, measured.endpoints, candidate.manifest.migrationSet);
      const completedAt = iso();
      if (Date.parse(completedAt) > deadline) fail('recovery timeout');
      deadline = Infinity;
      const execution = { schemaVersion: `harmonic-beacon.${stage}-execution.v3`, stage, ...binding, startedAt, completedAt, commands, runtimeBefore, runtimeAfter: measured.result,
        ...(stage === 'shadow' ? {} : { observedRecoveryMs: Date.parse(completedAt) - Date.parse(startedAt), maxRecoveryMs: RECOVERY }) };
      const executionBytes = Buffer.from(canonicalize(execution));
      const receiptBytes = Buffer.from(canonicalize({ schemaVersion: `harmonic-beacon.${stage}-receipt.v3`, stage, ...binding, executionEvidenceSha256: digest(executionBytes), issuedAt: iso() }));
      stages[stage] = { executionBytes, receiptBytes };
    }
    // Successful teardown is part of issuance. Failed teardown never produces authorization.
    dc(['down', '--remove-orphans', '--volumes']);
    active = false;
    const authorizedAt = iso();
    const authorizationBytes = Buffer.from(canonicalize({ schemaVersion: 'harmonic-beacon.oci-transition.v3', laneState: 'oci-production', ...binding, authorizedAt,
      expiresAt: new Date(Math.min(Date.parse(authorizedAt) + 900000, Date.parse(candidate.manifest.qualification.expiresAt))).toISOString(),
      stages: Object.fromEntries(Object.entries(stages).map(([stage, value]) => [stage, { executionEvidenceSha256: digest(value.executionBytes), receiptSha256: digest(value.receiptBytes) }])) }));
    const result = { manifest: candidate.manifest, manifestBytes: candidate.bytes, qualificationBytes: candidate.qualificationBytes, authorizationBytes, stages, now: now() };
    validateTransitionEvidence(result);
    mkdirSync(options.output, { recursive: false, mode: 0o700 });
    for (const [stage, value] of Object.entries(stages)) {
      writeFileSync(join(options.output, `${stage}.execution.json`), value.executionBytes, { flag: 'wx', mode: 0o600 });
      writeFileSync(join(options.output, `${stage}.json`), value.receiptBytes, { flag: 'wx', mode: 0o600 });
    }
    writeFileSync(join(options.output, 'qualification.json'), candidate.qualificationBytes, { flag: 'wx', mode: 0o600 });
    writeFileSync(join(options.output, 'authorization.json'), authorizationBytes, { flag: 'wx', mode: 0o600 });
    return result;
  } finally {
    deadline = Infinity;
    cleaning = true;
    try { if (active) dc(['down', '--remove-orphans', '--volumes']); }
    finally { rmSync(scratch, { recursive: true, force: true }); }
  }
}

// CLI: --candidate-dir DIR --base-dir DIR --output NEW_DIRECTORY, plus for EACH
// of candidate/base: --PREFIX-manifest-sha256 HEX --PREFIX-source-sha SHA
// --PREFIX-source-tree TREE --PREFIX-run-id ID --PREFIX-run-attempt NUMBER.
// These expectations come from independently resolved hosted artifact identities.
// Local checkout code is used only as the reviewed qualification client; application
// execution, migrations, and synthetic fixture seeding come exclusively from images.
export function parseTransitionArgs(argv) {
  const parsed = {};
  const keys = ['candidate-dir', 'base-dir', 'output', ...['candidate', 'base'].flatMap(p => ['manifest-sha256', 'source-sha', 'source-tree', 'run-id', 'run-attempt'].map(k => `${p}-${k}`))];
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]?.slice(2);
    if (!argv[i]?.startsWith('--') || !keys.includes(key) || parsed[key] !== undefined || !argv[i + 1]) fail('invalid CLI arguments');
    parsed[key] = argv[i + 1];
  }
  if (keys.some(k => !parsed[k])) fail('missing CLI arguments');
  return { candidateDir: parsed['candidate-dir'], baseDir: parsed['base-dir'], output: parsed.output, ...Object.fromEntries(['candidate', 'base'].map(p => [p, {
    manifestSha256: parsed[`${p}-manifest-sha256`], sourceSha: parsed[`${p}-source-sha`], sourceTree: parsed[`${p}-source-tree`], runId: parsed[`${p}-run-id`], runAttempt: Number(parsed[`${p}-run-attempt`]),
  }])) };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.env.RUNNER_OS !== 'Linux') fail('GitHub-hosted Linux runner required');
    qualifyTransitions(parseTransitionArgs(process.argv.slice(2)));
  } catch { console.error('Transition qualification failed; no authorization is usable. Docker/cosign/hosted proof remains mandatory.'); process.exitCode = 1; }
}
