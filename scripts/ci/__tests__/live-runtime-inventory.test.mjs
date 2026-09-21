import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { stateFixture, hash } from './b3-fixture.mjs';
import { candidateIdentitySha256, impactStateFromCurrent, validateCurrentState } from '../release-manifest.mjs';

// Load the real functions, not the privileged CLI dispatcher. No host invocation.
const helper = readFileSync('deploy/hb-deploy-root', 'utf8').split('\nrequire_root\n')[0];
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;
const services = ['app', 'commerce-reconciler', 'tapestry', 'playlist-bot'];
const containers = [...services, 'postgres', 'livekit'].map(service => `beacon-${service}`);

function liveState(source) {
  const state = stateFixture(source);
  state.serviceReleases = impactStateFromCurrent(state).serviceReleases;
  // Mixed per-service history: checking the aggregate manifest instead is wrong.
  for (const [index, release] of Object.values(state.serviceReleases).entries()) {
    release.sourceSha = hash(`${source}-${index}-source`).slice(0, 40);
    release.imageRef = release.imageRef.split('@')[0] + `@sha256:${hash(`${source}-${index}-image`)}`;
  }
  validateCurrentState(state);
  return state;
}

function runtimeHarness(source, { container = '', fault = '', mutateState = () => {} } = {}) {
  const root = mkdtempSync(join(process.cwd(), '.hb-runtime-inventory-'));
  try {
    const state = liveState(source === 'prior' ? 'a' : 'b');
    const manifest = JSON.parse(Buffer.from(state.manifestBase64, 'base64'));
    const profile = JSON.parse(Buffer.from(state.publicConfigBase64, 'base64'));
    const refs = Object.fromEntries(Object.entries(state.serviceReleases).map(([service, release]) =>
      [`beacon-${service}`, release.imageRef]));
    for (const image of manifest.externalImages) refs[`beacon-${image.serviceId}`] = `${image.repository}@${image.digest}`;
    const imageIds = Object.fromEntries(Object.values(refs).map(ref => [ref, `sha256:${hash(ref)}`]));
    writeFileSync(join(root, 'refs.json'), JSON.stringify(refs));
    writeFileSync(join(root, 'ids.json'), JSON.stringify(imageIds));
    writeFileSync(join(root, 'health.json'), JSON.stringify({ status: 'ok', gitSha: state.serviceReleases.app.sourceSha,
      artifactDigest: state.serviceReleases.app.imageRef, configProfileSha256: `sha256:${hash(Buffer.from(state.publicConfigBase64, 'base64'))}`,
      publicOrigin: profile.publicOrigin }));
    writeFileSync(join(root, 'production.env'), [
      `PUBLIC_ORIGIN=${profile.publicOrigin}`, `LIVEKIT_PUBLIC_URL=${profile.livekitPublicUrl}`,
      `LIVEKIT_PUBLIC_URL_ALLOWLIST=${profile.livekitPublicUrl}`,
      `TAPESTRY_PUBLIC_ENABLED=${fault === 'profile' ? !profile.featureFlags.tapestryPublic : profile.featureFlags.tapestryPublic}`,
      `PROMO_INVITATIONS_ENABLED=${profile.featureFlags.promoInvitations}`,
    ].join('\n') + '\n');
    mutateState(state);
    writeFileSync(join(root, 'state.json'), JSON.stringify(state));
    let script = helper;
    for (const [key, value] of Object.entries({
      ARTIFACT_STATE: root, RELEASE_MANIFEST: resolve('scripts/ci/release-manifest.mjs'),
      PRODUCTION_ENV: join(root, 'production.env'),
    })) script = script.replace(new RegExp(`^readonly ${key}=.*$`, 'm'), `readonly ${key}=${quote(value)}`);
    script += `
# Only privileged filesystem metadata and external host boundaries are replaced.
# State schema, unpacking, reference validation, image/health/provenance checks stay real.
node() { ${quote(process.execPath)} "$@"; }
require_secure_root_file() { :; }
chown() { :; }
install() { mkdir -p "\${@: -1}"; }
TEST_ROOT=${quote(root)}
TEST_CONTAINER=${quote(container)}
TEST_FAULT=${quote(fault)}
docker() {
  printf 'docker %s\\n' "$*" >> "$TEST_ROOT/events"
  local ref
  case "$1" in
    inspect)
      [ "$#" = 4 ] && [ "$3" = --format ] || return 90
      ref="$(jq -er --arg container "$2" '.[$container]' "$TEST_ROOT/refs.json")" || return 91
      case "$4" in
        '{{.State.Running}}')
          if [ "$2:$TEST_FAULT" = "$TEST_CONTAINER:stopped" ]; then printf 'false\\n'; else printf 'true\\n'; fi ;;
        '{{.Config.Image}}')
          if [ "$2:$TEST_FAULT" = "$TEST_CONTAINER:configured" ]; then printf 'wrong:latest\\n'; else printf '%s\\n' "$ref"; fi ;;
        '{{.Image}}')
          if [ "$2:$TEST_FAULT" = "$TEST_CONTAINER:actual" ]; then printf 'sha256:${'0'.repeat(64)}\\n'; else jq -er --arg ref "$ref" '.[$ref]' "$TEST_ROOT/ids.json"; fi ;;
        '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}')
          if [ "$2:$TEST_FAULT" = "$TEST_CONTAINER:unhealthy" ]; then printf 'unhealthy\\n'; else printf 'healthy\\n'; fi ;;
        *) return 92 ;;
      esac ;;
    image)
      [ "$#" = 5 ] && [ "$2" = inspect ] && [ "$4" = --format ] && [ "$5" = '{{.Id}}' ] || return 93
      jq -er --arg ref "$3" '.[$ref]' "$TEST_ROOT/ids.json" ;;
    *) return 94 ;;
  esac
}
curl() {
  printf 'curl %s\\n' "$*" >> "$TEST_ROOT/events"
  case "\${!#}" in
    http://127.0.0.1:7880) [ "$TEST_FAULT" != livekit-endpoint ] ;;
    http://127.0.0.1:3000/api/health/ready) [ "$TEST_FAULT" != readiness ] ;;
    http://127.0.0.1:3000/api/health|${profile.publicOrigin}/api/health)
      if [ "$TEST_FAULT" = provenance ]; then printf '{}\\n'; else jq . "$TEST_ROOT/health.json"; fi ;;
    *) return 95 ;;
  esac
}
boundary() {
  printf 'boundary\\n' >> "$TEST_ROOT/events"
  [ "$TEST_FAULT" != boundary ] || die 'synthetic private boundary rejected'
}
state_unpack "$TEST_ROOT/state.json" "$TRANSACTION_ROOT/123/${source}"
${source === 'candidate' ? `mv "$TRANSACTION_ROOT/123/candidate/prior-manifest.json" "$TRANSACTION_ROOT/123/candidate/candidate-manifest.json"
mv "$TRANSACTION_ROOT/123/candidate/service-releases.json" "$TRANSACTION_ROOT/123/next-service-releases.json"` : ''}
verify_release_runtime_state 123 ${source}
printf 'verified\\n'
`;
    // Use a file rather than growing Bash's single -c argv; all bytes stay local.
    writeFileSync(join(root, 'probe.sh'), script);
    const result = spawnSync('bash', [join(root, 'probe.sh')], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    return { ...result, events: existsSync(join(root, 'events')) ? readFileSync(join(root, 'events'), 'utf8') : '' };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

for (const source of ['prior', 'candidate']) {
  test(`Live runtime accepts valid ${source} v4 inventory without locally installed analytics`, () => {
    const result = runtimeHarness(source);
    assert.doesNotMatch(result.events, /analytics/);
    for (const container of containers) {
      for (const field of ['State.Running', 'Config.Image', 'Image']) {
        assert.ok(result.events.includes(`docker inspect ${container} --format {{.${field}}}\n`), `${container}: ${field}`);
      }
    }
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'verified\n');
    assert.ok(result.events.endsWith('boundary\n'));
  });

  for (const container of containers) {
    for (const [fault, message] of [
      ['configured', `${container} configured image does not match the manifest`],
      ['actual', `${container} actual image ID does not match the exact digest`],
      ['stopped', `${container} is not running`],
      ...(container === 'beacon-livekit' ? [] : [['unhealthy', `${container} is not healthy`]]),
    ]) test(`Live ${source} rejects ${container} ${fault}`, () => {
      const result = runtimeHarness(source, { container, fault });
      assert.notEqual(result.status, 0);
      assert.ok(result.stderr.includes(message), result.stderr);
      assert.doesNotMatch(result.stdout, /verified/);
    });
  }

  for (const [fault, message] of [
    ['profile', 'runtime public config verification failed'],
    ['livekit-endpoint', 'beacon-livekit health endpoint failed'],
    ['readiness', 'application readiness endpoint failed'],
    ['provenance', 'public health provenance mismatch'],
    ['boundary', 'synthetic private boundary rejected'],
  ]) test(`Live ${source} still enforces ${fault}`, () => {
    const result = runtimeHarness(source, { fault });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(message), result.stderr);
    assert.doesNotMatch(result.stdout, /verified/);
  });
}

function rewriteManifest(state, mutate) {
  const manifest = JSON.parse(Buffer.from(state.manifestBase64, 'base64'));
  mutate(manifest);
  manifest.qualification.candidateIdentitySha256 = candidateIdentitySha256(manifest);
  const bytes = Buffer.from(JSON.stringify(manifest));
  state.manifestBase64 = bytes.toString('base64');
  state.manifestSha256 = hash(bytes);
  state.publication.manifestSha256 = state.manifestSha256;
}

for (const [name, mutateState, message] of [
  ...services.map(service => [`missing ${service}`, state => { delete state.serviceReleases[service]; }, `service releases is missing ${service}`]),
  ['analytics in Live inventory', state => { state.serviceReleases.analytics = state.serviceReleases.app; }, 'service releases has unknown field: analytics'],
  ['analytics missing from qualified manifest', state => rewriteManifest(state, manifest => {
    manifest.artifacts = manifest.artifacts.filter(artifact => artifact.artifactId !== 'analytics');
  }), 'missing artifact: analytics'],
  ['analytics missing supply-chain evidence', state => rewriteManifest(state, manifest => {
    delete manifest.artifacts.find(artifact => artifact.artifactId === 'analytics').signature;
  }), 'artifact is missing signature'],
  ['failed qualification', state => rewriteManifest(state, manifest => { manifest.qualification.result = 'failure'; }), 'qualification result must be success'],
]) test(`Live state admission rejects ${name} before runtime access`, () => {
  const result = runtimeHarness('prior', { mutateState });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.includes(message), result.stderr);
  assert.equal(result.events, '');
  assert.doesNotMatch(result.stdout, /verified/);
});

// Exercise the actual Compose builders, including the nested bash subprocess.
// Only the docker executable boundary and privileged metadata are substituted.
function composeHarness({ source = 'candidate', service, reuse = false, args = ['config', '--quiet'],
  mutateState = () => {}, afterUnpack = '' } = {}) {
  const root = mkdtempSync(join(process.cwd(), '.hb-compose-inventory-'));
  try {
    const states = { prior: liveState('a'), candidate: liveState('b') };
    for (const [name, state] of Object.entries(states)) {
      // Distinct aggregate digests catch cross-manifest/fallback interpolation.
      rewriteManifest(state, manifest => {
        for (const artifact of manifest.artifacts) artifact.digest = `sha256:${hash(`${name}-${artifact.artifactId}`)}`;
      });
      validateCurrentState(state);
      assert.deepEqual(Object.keys(state.serviceReleases).sort(), [...services].sort());
      if (name === source) mutateState(state);
      writeFileSync(join(root, `${name}.json`), JSON.stringify(state));
    }
    writeFileSync(join(root, 'production.env'), '# synthetic only\n');
    mkdirSync(join(root, 'bin'));
    const envKeys = ['HB_APP_IMAGE_REF', 'HB_TAPESTRY_IMAGE_REF', 'HB_PLAYLIST_IMAGE_REF',
      'HB_ANALYTICS_IMAGE_REF', 'HB_POSTGRES_IMAGE_REF', 'HB_LIVEKIT_IMAGE_REF', 'HB_CONFIG_PROFILE_SHA256'];
    writeFileSync(join(root, 'bin/docker'), `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
if (argv[0] !== 'compose') process.exit(94);
fs.appendFileSync(${JSON.stringify(join(root, 'compose.jsonl'))}, JSON.stringify({argv, cwd: process.cwd(),
  env: Object.fromEntries(${JSON.stringify(envKeys)}.map(key => [key, process.env[key]]))}) + '\\n');
`);
    chmodSync(join(root, 'bin/docker'), 0o700);
    let script = helper;
    for (const [key, value] of Object.entries({
      PATH: `${join(root, 'bin')}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
      ARTIFACT_STATE: root, RELEASE_MANIFEST: resolve('scripts/ci/release-manifest.mjs'),
      PRODUCTION_ENV: join(root, 'production.env'),
    })) script = script.replace(new RegExp(`^readonly ${key}=.*$`, 'm'), `readonly ${key}=${quote(value)}`);
    const invocation = service
      ? ['artifact_compose_service_from', '123', source, service, ...args]
      : ['artifact_compose_from', '123', source, ...args];
    script += `
node() { ${quote(process.execPath)} "$@"; }
require_secure_root_file() { :; }
chown() { :; }
install() { mkdir -p "\${@: -1}"; }
TEST_ROOT=${quote(root)}
state_unpack "$TEST_ROOT/prior.json" "$TRANSACTION_ROOT/123/prior"
state_unpack "$TEST_ROOT/candidate.json" "$TRANSACTION_ROOT/123/candidate"
mv "$TRANSACTION_ROOT/123/candidate/prior-manifest.json" "$TRANSACTION_ROOT/123/candidate/candidate-manifest.json"
mv "$TRANSACTION_ROOT/123/candidate/service-releases.json" "$TRANSACTION_ROOT/123/next-service-releases.json"
printf '%s\\n' ${quote(JSON.stringify({ deployment: { reusePriorImages: reuse ? services : [] } }))} > "$TRANSACTION_ROOT/123/impact-plan.json"
verify_prior_state_inputs "$TRANSACTION_ROOT/123/prior"
require_unchanged_runtime_inputs "$TRANSACTION_ROOT/123"
${afterUnpack}
exec 9> "$TEST_ROOT/trace"
export BASH_XTRACEFD=9
set -x
${invocation.map(quote).join(' ')}
set +x
printf 'composed\\n'
`;
    writeFileSync(join(root, 'probe.sh'), script);
    const result = spawnSync('bash', [join(root, 'probe.sh')], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    const read = path => existsSync(join(root, path)) ? readFileSync(join(root, path), 'utf8') : '';
    return { ...result, root, source, states, trace: read('trace'),
      calls: read('compose.jsonl').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
  } finally { rmSync(root, { recursive: true, force: true }); }
}

function assertCompose(result, args, { service, reuse = false, aggregate = false } = {}) {
  assert.match(result.trace, /artifact_compose_(?:service_)?from 123/);
  assert.equal(result.status, 0, result.stderr + result.trace);
  assert.equal(result.stdout, 'composed\n');
  const directory = join(result.root, 'transactions/123', result.source);
  const manifest = JSON.parse(Buffer.from(result.states[result.source].manifestBase64, 'base64'));
  const ref = (section, key) => {
    const item = manifest[section].find(item => (item.artifactId ?? item.serviceId) === key);
    return `${item.repository}@${item.digest}`;
  };
  const releases = result.states[result.source === 'prior' || reuse ? 'prior' : 'candidate'].serviceReleases;
  const fromReleases = reuse || result.source === 'prior' && !aggregate || result.source === 'candidate' && aggregate;
  const env = {
    HB_APP_IMAGE_REF: fromReleases ? releases[service === 'commerce-reconciler' ? service : 'app'].imageRef : ref('artifacts', 'app'),
    HB_TAPESTRY_IMAGE_REF: fromReleases ? releases.tapestry.imageRef : ref('artifacts', 'tapestry'),
    HB_PLAYLIST_IMAGE_REF: fromReleases ? releases['playlist-bot'].imageRef : ref('artifacts', 'playlist-bot'),
    HB_ANALYTICS_IMAGE_REF: ref('artifacts', 'analytics'),
    HB_POSTGRES_IMAGE_REF: ref('externalImages', 'postgres'),
    HB_LIVEKIT_IMAGE_REF: ref('externalImages', 'livekit'),
    HB_CONFIG_PROFILE_SHA256: `sha256:${hash(Buffer.from(result.states[result.source].publicConfigBase64, 'base64'))}`,
  };
  assert.deepEqual(result.calls, [{ argv: ['compose', '--file', join(directory, 'docker-compose.yml'),
    '--file', join(directory, 'oci-images.compose.yml'), '--project-name', 'app',
    '--env-file', join(result.root, 'production.env'), ...args], cwd: directory, env }]);
  assert.ok(!result.calls[0].argv.includes('analytics'), 'analytics must never be a Live lifecycle target');
}

test('Compose aggregate candidate accepts closed Live inventory and interpolates qualified analytics', () => {
  const args = ['config', '--quiet'];
  assertCompose(composeHarness({ args }), args, { aggregate: true });
});

const replaceArgs = ['up', '-d', '--no-deps', '--force-recreate', '--no-build', '--pull', 'never'];
for (const service of services) test(`Compose candidate reuse-prior preserves exact ${service} image without analytics release`, () => {
  const options = { source: 'candidate', service, reuse: true, args: replaceArgs };
  assertCompose(composeHarness(options), [...replaceArgs, service], options);
});

for (const service of services) test(`Compose prior rollback preserves exact ${service} image without analytics release`, () => {
  const options = { source: 'prior', service, args: replaceArgs };
  assertCompose(composeHarness(options), [...replaceArgs, service], options);
});

for (const service of services) test(`Compose candidate fresh ${service} retains qualified candidate images`, () => {
  const options = { source: 'candidate', service, args: replaceArgs };
  assertCompose(composeHarness(options), [...replaceArgs, service], options);
});

test('Compose aggregate prior retains qualified prior manifest interpolation', () => {
  const args = ['config', '--quiet'];
  assertCompose(composeHarness({ source: 'prior', args }), args, { aggregate: true });
});

for (const args of [
  ['stop', 'app', 'commerce-reconciler'],
  ['run', '--rm', '--no-deps', '--no-build', '--pull', 'never', 'migrate', 'npx', 'tsx', 'scripts/release-quiesce-preflight.ts'],
  ['run', '--rm', '--no-deps', '--no-build', '--pull', 'never', 'migrate', 'npx', 'prisma', 'migrate', 'deploy'],
]) test(`Compose aggregate candidate keeps explicit Live targets: ${args.join(' ')}`, () => {
  assertCompose(composeHarness({ args }), args, { aggregate: true });
});

for (const service of ['app', 'commerce-reconciler']) {
  test(`Compose prior ${service} migration probe preserves exact image and service-command argv`, () => {
    const args = ['run', '-d', '--name', `hb-restore-${service}-123`, '--no-deps', '--no-build', '--pull', 'never',
      '-e', 'HB_RESTORE_DATABASE_NAME=hb_restore_123'];
    // An inert command argument with whitespace/metacharacters must survive verbatim.
    const command = ['node', '-e', 'process.stdout.write("not executed; $(false)")'];
    const options = { source: 'prior', service, args: [...args, '--service-command', ...command] };
    assertCompose(composeHarness(options), [...args, service, ...command], options);
  });
}

const composePaths = [
  ['aggregate candidate', { source: 'candidate' }],
  ['candidate reuse-prior', { source: 'candidate', service: 'app', reuse: true, args: replaceArgs }],
  ['prior rollback', { source: 'prior', service: 'commerce-reconciler', args: replaceArgs }],
];
for (const [name, options] of composePaths) {
  for (const [fault, mutateState, message] of [
    ['missing analytics artifact', state => rewriteManifest(state, manifest => {
      manifest.artifacts = manifest.artifacts.filter(artifact => artifact.artifactId !== 'analytics');
    }), 'missing artifact: analytics'],
    ...['signature', 'sbom', 'provenance'].map(field => [`missing analytics ${field}`, state => rewriteManifest(state, manifest => {
      delete manifest.artifacts.find(artifact => artifact.artifactId === 'analytics')[field];
    }), `artifact is missing ${field}`]),
    ['failed qualification', state => rewriteManifest(state, manifest => { manifest.qualification.result = 'failure'; }),
      'qualification result must be success'],
    ['contradictory manifest hash', state => { state.manifestSha256 = state.publication.manifestSha256 = '0'.repeat(64); },
      'current manifest and high-water are contradictory'],
    ['missing Live release', state => { delete state.serviceReleases.app; }, 'service releases is missing app'],
    ['extra analytics Live release', state => { state.serviceReleases.analytics = state.serviceReleases.app; },
      'service releases has unknown field: analytics'],
  ]) test(`Compose ${name} rejects admission ${fault} before subprocess`, () => {
    const result = composeHarness({ ...options, mutateState });
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(message), result.stderr);
    assert.equal(result.trace, '', 'admission must fail before the Compose builder');
    assert.deepEqual(result.calls, []);
    assert.doesNotMatch(result.stdout, /composed/);
  });

  const manifestPath = `$TRANSACTION_ROOT/123/${options.source}/${options.source === 'candidate' ? 'candidate' : 'prior'}-manifest.json`;
  for (const [fault, afterUnpack, message] of [
    ['missing manifest file', `rm -- "${manifestPath}"`, 'manifest is missing artifacts.analytics'],
    ['malformed manifest JSON', `printf '%s' '{broken' > "${manifestPath}"`, 'manifest is missing artifacts.analytics'],
    ['missing analytics ref', `jq 'del(.artifacts[] | select(.artifactId=="analytics"))' "${manifestPath}" > "${manifestPath}.new"; mv -- "${manifestPath}.new" "${manifestPath}"`,
      'manifest is missing artifacts.analytics'],
    ['invalid analytics ref', `jq '(.artifacts[] | select(.artifactId=="analytics")).digest="not-a-digest"' "${manifestPath}" > "${manifestPath}.new"; mv -- "${manifestPath}.new" "${manifestPath}"`,
      'invalid exact image reference'],
  ]) test(`Compose ${name} fails closed inside actual builder on ${fault}`, () => {
    // Corruption after valid admission tests the lookup itself, not signature verification.
    const result = composeHarness({ ...options, afterUnpack });
    assert.match(result.trace, /artifact_compose_(?:service_)?from 123/);
    assert.match(result.trace, /manifest_ref .* artifacts analytics/);
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes(message), result.stderr);
    assert.deepEqual(result.calls, []);
    assert.doesNotMatch(result.stdout, /composed/);
  });
}
