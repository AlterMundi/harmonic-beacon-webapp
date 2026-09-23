import assert from 'node:assert/strict';
import {chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');
const source = (path) => readFile(join(root, path), 'utf8');

test('retirement preserves recovery inputs and refuses active/fenced or unknown successors', async () => {
  const helper = await source('deploy/hb-migration-bridge-root');
  const body = helper.slice(helper.indexOf('retire_completed() {'), helper.indexOf('\nusage()'));
  assert.ok(body.startsWith('retire_completed() {'));
  assert.doesNotMatch(await source('deploy/hb-migration-bridge.sudoers'), /hb-migration-bridge retire/);
  for (const variant of ['completed', 'successor', 'fenced', 'active', 'changed-worker', 'unknown-app']) {
    const area = await mkdtemp(join(tmpdir(), 'hb-retire-'));
    try {
      await mkdir(join(area, 'config'), {recursive:true});
      const state = {permitId:'p',phase:variant==='active'?'applying':'applied',fenceState:variant==='fenced'?'held':'absent'};
      await writeFile(join(area, 'state.json'), JSON.stringify(state));
      await writeFile(join(area, 'config/permit.json'), JSON.stringify({permitId:'p',sourceSha:'source'}));
      await writeFile(join(area, 'config/activation.json'), '{}');
      await writeFile(join(area, 'staging-rehearsal.json'), '{}');
      if (variant === 'successor') {
        await mkdir(join(area,'app-bridge'));
        await writeFile(join(area,'app-bridge/state.json'), JSON.stringify({phase:'applied',candidateImageId:'other',productionPriorImageId:'candidate',permitId:'next',sourceSha:'nextsource'}));
        await writeFile(join(area,'app-bridge/permit.json'), JSON.stringify({permitId:'next',sourceSha:'nextsource'}));
      }
      const script = `set -eu
ROOT="$AREA"; CONFIG="$AREA/config"; STATE="$ROOT/state.json"
PERMIT="$CONFIG/permit.json"; ACTIVATION="$CONFIG/activation.json"; RECEIPT="$ROOT/staging-rehearsal.json"
SHARED_LOCK="$AREA/app-bridge/operation.lock"
die() { echo "$*" >&2; exit 1; }
validate_permit() { :; }; root_file() { test -f "$1"; }
phase_is() { test "$(jq -r .phase "$STATE")" = "$1" || die phase; }
permit() { jq -r "$1" "$PERMIT"; }; candidate_image() { echo candidate; }
container_image() { if [ "$1" = beacon-app ]; then echo "$APP"; else echo "$WORKER"; fi; }
wait_prior_app() { :; }; wait_worker() { :; }
remove_rehearsal_container() { :; }
install() { local args=(); while [ "$#" -gt 0 ]; do case "$1" in -o|-g) shift 2;; *) args+=("$1"); shift;; esac; done; command install "\${args[@]}"; }
${body}
retire_completed
`;
      const run = spawnSync('bash', ['-c',script,join(root,'deploy/hb-migration-bridge-root')], {encoding:'utf8',env:{...process.env,AREA:area,APP:['unknown-app','successor'].includes(variant)?'other':'candidate',WORKER:variant==='changed-worker'?'other':'candidate'}});
      if (['completed','successor'].includes(variant)) {
        assert.equal(run.status,0,run.stderr);
        await assert.rejects(stat(join(area,'state.json')));
        assert.deepEqual(JSON.parse(await readFile(join(area,'transactions/p/completed/state.json'),'utf8')),state);
        assert.equal(await readFile(join(area,'transactions/p/completed/permit.json'),'utf8'),await readFile(join(area,'config/permit.json'),'utf8'));
      } else {
        assert.notEqual(run.status,0,variant);
        assert.deepEqual(JSON.parse(await readFile(join(area,'state.json'),'utf8')),state);
      }
    } finally { await rm(area,{recursive:true,force:true}); }
  }
});

test('archive children remain readable under root-only transaction umask', async () => {
  const area = await mkdtemp(join(tmpdir(), 'hb-migration-modes-'));
  try {
    const input = join(area, 'input');
    const tx = join(area, 'transaction');
    await mkdir(join(input, 'public/assets'), {recursive:true});
    await writeFile(join(input, 'public/assets/test.txt'), 'asset');
    await mkdir(join(tx, 'source'), {recursive:true,mode:0o700});
    await chmod(tx, 0o700);
    const tar = spawnSync('tar', ['-cf',join(tx,'candidate.tar'),'-C',input,'public'], {encoding:'utf8'});
    assert.equal(tar.status,0,tar.stderr);
    const helper = await source('deploy/hb-migration-bridge-root');
    const line = helper.split('\n').find((value) => value.includes('python3 "$ARCHIVE_VALIDATOR" "$tx/candidate.tar"'));
    assert.ok(line);
    const run = spawnSync('bash',['-c',`set -eu; umask 077; permit() { printf 3; }; ${line}; test "$(umask)" = 0077`], {
      encoding:'utf8',env:{...process.env,tx,ARCHIVE_VALIDATOR:join(root,'deploy/hb-app-bridge-archive.py')},
    });
    assert.equal(run.status,0,run.stderr);
    assert.equal((await stat(tx)).mode & 0o777,0o700);
    assert.equal((await stat(join(tx,'source'))).mode & 0o777,0o700);
    assert.equal((await stat(join(tx,'source/public/assets'))).mode & 0o777,0o755);
    assert.equal((await stat(join(tx,'source/public/assets/test.txt'))).mode & 0o777,0o644);
  } finally { await rm(area,{recursive:true,force:true}); }
});

test('migration bridge is separate from the still-recoverable v1 transaction', async () => {
  const helper = await source('deploy/hb-migration-bridge-root');
  assert.match(helper, /migration-bridge-v2/);
  assert.match(helper, /app-bridge\/operation\.lock/);
  assert.doesNotMatch(helper, /current-state|HB_RELEASE_LANE_STATE|artifact-/);
  const v1 = await source('deploy/hb-app-bridge-root');
  assert.match(v1, /readonly ROOT='\/var\/lib\/harmonic-beacon\/app-bridge'/);
});

test('sudo authority is a closed argument-free verb set', async () => {
  const sudoers = await source('deploy/hb-migration-bridge.sudoers');
  assert.doesNotMatch(sudoers, /hb-migration-bridge \*/);
  for (const verb of ['stage','stage-resume','stage-rollback','stage-reapply','apply','rollback','recover','status']) {
    assert.match(sudoers, new RegExp(`/usr/local/sbin/hb-migration-bridge ${verb}`));
  }
  assert.doesNotMatch(sudoers, /\bdocker\b|\b(?:ba)?sh\b/);
});

test('the actual closed permit jq validator accepts a fully valid unique inventory', async () => {
  const helper = await source('deploy/hb-migration-bridge-root');
  const match = helper.match(/validate_permit\(\) \{[\s\S]*?jq -e '\n([\s\S]*?)' "\$PERMIT"/);
  assert.ok(match, 'permit filter must remain extractable');
  const hex = 'a'.repeat(64); const sha = 'b'.repeat(40); const image = `sha256:${hex}`;
  const permit = {
    archiveBytes: 1, archiveEntries: 1, archiveSha256: hex, archiveValidatorSha256: hex,
    buildTime: '2026-09-21T00:00:00Z', databaseSchemaVersion: '20260917211500_default_scene_capacity_12',
    expectedMigrations: [{name:'20260916010000_configurable_scene_capacity',sha256:hex},{name:'20260917211500_default_scene_capacity_12',sha256:'c'.repeat(64)}],
    expiresAt: '2099-01-01T00:00:00Z', livekitProbeSha256: hex, permitId: hex,
    productionBaseAppGitSha: sha, productionBaseAppImageId: image,
    productionBaseWorkerGitSha: sha, productionBaseWorkerImageId: image,
    productionPostgresImageId: image,
    productionComposeSha256: hex, productionProfileSha256: hex, rehearsalComposeSha256: hex,
    schemaVersion: 'hb-migration-bridge.permit.v2', sourceSha: sha, sourceTree: sha,
    stagingProfileSha256: hex,
  };
  const accepted = spawnSync('jq', ['-e', match[1]], {input: JSON.stringify(permit), encoding:'utf8'});
  assert.equal(accepted.status, 0, accepted.stderr);
  permit.expectedMigrations[1].name = permit.expectedMigrations[0].name;
  const duplicate = spawnSync('jq', ['-e', match[1]], {input: JSON.stringify(permit), encoding:'utf8'});
  assert.notEqual(duplicate.status, 0, 'duplicate migration names must be rejected');
});

test('fixed production composition preserves resource and runtime boundaries', async () => {
  const compose = await source('deploy/hb-migration-bridge-production.compose.yml');
  assert.match(compose, /cpus: "2"/); assert.match(compose, /memory: 1G/);
  assert.match(compose, /cpus: "0\.25"/); assert.match(compose, /memory: 512M/);
  for (const value of ['LIVEKIT_PUBLIC_URL','LIVEKIT_PUBLIC_URL_ALLOWLIST','BEACON_PUBLIC_ORIGIN','BEACON_CONFIG_PROFILE_SHA256','PROMO_INVITATIONS_ENABLED','TAPESTRY_PUBLIC_ENABLED']) assert.match(compose, new RegExp(value));
  assert.match(compose, /^  commerce-reconciler:/m);
  assert.match(compose, /^  migrate:/m);
  assert.match(compose, /^  preflight:/m);
});

test('forward grant drain receives only its bounded database and LiveKit environment', async () => {
  const compose = await source('deploy/hb-migration-bridge-production.compose.yml');
  const drain = compose.slice(compose.indexOf('  grant-drain:'), compose.indexOf('\n  preflight:'));
  assert.ok(drain.startsWith('  grant-drain:'));
  assert.doesNotMatch(drain, /env_file:/);
  const environment = [...drain.matchAll(/^      ([A-Z][A-Z0-9_]+):/gm)].map((match) => match[1]).sort();
  assert.deepEqual(environment, [
    'DATABASE_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET', 'LIVEKIT_IDENTITY_SECRET',
    'LIVEKIT_INTERNAL_URL', 'LIVEKIT_ROOM_NAME', 'NODE_ENV',
  ]);
  const helper = await source('deploy/hb-migration-bridge-root');
  assert.match(helper, /run --rm --no-deps grant-drain/);
  assert.doesNotMatch(helper, /migrate npx tsx scripts\/stage-grant-forward-drain\.ts/);
});

test('forward grant drain Compose preserves the optional identity-secret fallback', async () => {
  const compose = await source('deploy/hb-migration-bridge-production.compose.yml');
  const drain = compose.slice(compose.indexOf('  grant-drain:'), compose.indexOf('\n  preflight:'));
  const fragment = `services:\n${drain}\nnetworks:\n  beacon:\n    external: true\n`;
  const rendered = spawnSync('docker', ['compose', '-f', '-', 'config'], {
    input: fragment, encoding:'utf8', env:{...process.env,
      HB_MIGRATION_BRIDGE_IMAGE:`sha256:${'a'.repeat(64)}`,
      POSTGRES_PASSWORD:'isolated-test-password',
      LIVEKIT_API_KEY:'test-key', LIVEKIT_API_SECRET:'test-secret',
    },
  });
  assert.equal(rendered.status, 0, rendered.stderr);
  assert.match(rendered.stdout, /LIVEKIT_API_KEY: test-key/);
  assert.match(rendered.stdout, /LIVEKIT_API_SECRET: test-secret/);
  assert.match(rendered.stdout, /LIVEKIT_IDENTITY_SECRET: ""/);
});

test('every Compose tmpfs declaration renders as exactly one mount path', async () => {
  for (const file of ['deploy/hb-migration-bridge-production.compose.yml','deploy/hb-migration-bridge-rehearsal.compose.yml']) {
    const compose = await source(file); const declarations = [...compose.matchAll(/^\s+tmpfs: (.+)$/gm)];
    assert.ok(declarations.length > 0, `${file} must exercise tmpfs parsing`);
    for (const [, declaration] of declarations) {
      const rendered = spawnSync('docker', ['compose', '-f', '-', 'config', '--format', 'json'], {
        input:`services:\n  probe:\n    image: scratch\n    tmpfs: ${declaration}\n`, encoding:'utf8',
      });
      assert.equal(rendered.status, 0, `${file}: ${rendered.stderr}`);
      const mounts = JSON.parse(rendered.stdout).services.probe.tmpfs;
      assert.equal(mounts.length, 1, `${file}: ${declaration}`);
      assert.match(mounts[0], /^\/tmp:size=(32|64)m,mode=1777$/);
    }
  }
});

test('isolated rehearsal has no production secret bundles, PMP, or LiveKit network', async () => {
  const compose = await source('deploy/hb-migration-bridge-rehearsal.compose.yml');
  assert.doesNotMatch(compose, /env_file|commerce\.env|account\.env|pmp_beacon_internal|beacon-livekit/);
  assert.match(compose, /internal: true/);
  assert.match(compose, /HB_MIGRATION_BRIDGE_POSTGRES_IMAGE/);
  assert.doesNotMatch(compose, /name: app_beacon/);
  assert.match(compose, /http:\/\/127\.0\.0\.1:9/);
  assert.match(compose, /HB_RESTORE_DATABASE_NAME/);
  assert.doesNotMatch(compose, /ports:/);
});

test('production mutation records conservative recovery state before effects', async () => {
  const helper = await source('deploy/hb-migration-bridge-root');
  const apply = helper.slice(helper.indexOf('apply_candidate()'), helper.indexOf('\nrecover()'));
  assert.ok(apply.indexOf('fenceState="acquiring"') < apply.indexOf('fence_acquire'));
  assert.ok(apply.indexOf('migrationAttemptedToProduction=true') < apply.indexOf('npx prisma migrate deploy'));
  assert.ok(apply.indexOf('backup_and_prove') < apply.indexOf('npx prisma migrate deploy'));
  assert.ok(apply.indexOf('stop app commerce-reconciler') < apply.indexOf('backup_and_prove'));
  assert.match(apply, /wait_candidate_inside/);
  assert.doesNotMatch(apply, /wait_app beacon-app/);
  assert.match(helper, /validate_permit false; root_file "\$STATE" 600/);
  assert.match(helper, /production app is outside recovery endpoints/);
  assert.match(helper, /rollback candidate CAS failed/);
});

async function recoveryScenario({failBarrier = ''} = {}) {
  const sandbox = await mkdtemp(join(tmpdir(), 'hb-migration-recovery-'));
  const stateDir = join(sandbox, 'var/lib/harmonic-beacon/migration-bridge-v2');
  const configDir = join(sandbox, 'etc/harmonic-beacon/migration-bridge-v2');
  await mkdir(stateDir, {recursive:true}); await mkdir(configDir, {recursive:true});
  for (const path of [join(sandbox,'var'),join(sandbox,'var/lib'),join(sandbox,'var/lib/harmonic-beacon'),stateDir]) await chmod(path, 0o700);
  const hex = 'a'.repeat(64); const image = `sha256:${hex}`;
  await writeFile(join(stateDir, 'state.json'), JSON.stringify({
    permitId:hex, phase:'recovery-required', candidateImageId:image,
    migrationAttemptedToProduction:Boolean(failBarrier), fenceState:'held',
  }), {mode:0o600});
  await writeFile(join(configDir, 'permit.json'), JSON.stringify({
    permitId:hex, productionBaseAppImageId:`sha256:${'b'.repeat(64)}`,
    productionBaseWorkerImageId:`sha256:${'c'.repeat(64)}`,
    expectedMigrations:[{name:'20260916010000_configurable_scene_capacity',sha256:'d'.repeat(64)}],
  }), {mode:0o600});
  const helper = join(root, 'deploy/hb-migration-bridge-root');
  const shell = String.raw`
    source "$HELPER"
    log() { printf '%s\n' "$1" >> "$HB_LOG"; }
    permit() { case "$1" in
      .permitId) printf '%s\n' '${hex}';;
      .productionBaseAppImageId) printf '%s\n' 'sha256:${'b'.repeat(64)}';;
      .productionBaseWorkerImageId) printf '%s\n' 'sha256:${'c'.repeat(64)}';;
      .expectedMigrations\\|length) printf '1\n';;
      *) return 1;; esac; }
    container_image() { case "$1" in beacon-app) permit .productionBaseAppImageId;; *) permit .productionBaseWorkerImageId;; esac; }
    continuity() { log continuity; }
    fence_ensure() { log fence-ensure; }
    fence_release() { log fence-release; }
    restore_prior() { log restore-prior; }
    atomic_state() { cp "$1" "$STATE"; }
    migration_state() { printf '%s\n' '{"schemaVersion":"harmonic-beacon.migration-state.v1","databaseStateVerified":true,"failed":[],"unexpected":[],"unsafe":[],"checksumErrors":[],"duplicateRecords":[],"conflictingRecords":[],"historicalChecksumMatches":[],"pending":[]}' > "$3"; }
    prod_compose() {
      case "$*" in
        *'stop app commerce-reconciler'*) log stop-writers;;
        *'stage-grant-rollback-preflight.ts'*) log barrier-grant; [ "$HB_FAIL_BARRIER" != grant ];;
        *'scene-capacity-rollback-preflight.ts'*) log barrier-scene; [ "$HB_FAIL_BARRIER" != scene ];;
      esac
    }
    recover_internal
  `;
  const logPath = join(sandbox, 'operations.log');
  const result = spawnSync('bash', ['-c', shell], {encoding:'utf8', env:{...process.env,
    HELPER:helper, HB_LOG:logPath, HB_FAIL_BARRIER:failBarrier,
    HB_MIGRATION_BRIDGE_TEST_ROOT:sandbox, HB_MIGRATION_BRIDGE_SOURCE_ONLY:'1'}});
  const log = await readFile(logPath, 'utf8').catch(() => '');
  await rm(sandbox, {recursive:true, force:true});
  return {result, operations:log.trim().split('\n').filter(Boolean)};
}

for (const barrier of ['grant','scene']) test(`recovery retains fence and writers on ${barrier} rollback-barrier refusal`, async () => {
  const {result, operations} = await recoveryScenario({failBarrier:barrier});
  assert.notEqual(result.status, 0, result.stderr);
  assert.ok(operations.includes(`barrier-${barrier}`));
  assert.ok(!operations.includes('restore-prior'));
  assert.ok(!operations.includes('fence-release'));
});

test('recovery after reboot reproves continuity and fence before stopping restarted writers', async () => {
  const {result, operations} = await recoveryScenario();
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(operations, ['continuity','fence-ensure','stop-writers','restore-prior','fence-release']);
});

test('partial fence acquisition removes the first rule and fails closed', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'hb-migration-fence-'));
  const bin = join(sandbox, 'bin'); await mkdir(bin, {recursive:true});
  await writeFile(join(bin, 'iptables'), '#!/bin/sh\nexit 0\n', {mode:0o755});
  const helper = join(root, 'deploy/hb-migration-bridge-root'); const logPath = join(sandbox, 'operations.log');
  const shell = String.raw`
    source "$HELPER"
    entry_rule() {
      printf '%s %s\n' "$1" "$3" >> "$HB_LOG"
      [ "$1 $3" != '-I 7880' ]
    }
    fence_acquire attempt
  `;
  const result = spawnSync('bash', ['-c', shell], {encoding:'utf8', env:{...process.env,
    HELPER:helper, HB_LOG:logPath, HB_MIGRATION_BRIDGE_TEST_ROOT:sandbox, HB_MIGRATION_BRIDGE_SOURCE_ONLY:'1'}});
  const operations = (await readFile(logPath, 'utf8')).trim().split('\n');
  await rm(sandbox, {recursive:true, force:true});
  assert.notEqual(result.status, 0, result.stderr);
  assert.deepEqual(operations, ['-I 3000','-I 7880','-D 3000']);
});

test('legacy prior image identity falls back to the single baked git SHA', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'hb-migration-revision-'));
  const helper = join(root, 'deploy/hb-migration-bridge-root'); const expected = '9'.repeat(40);
  const shell = String.raw`
    source "$HELPER"
    docker() { case "$*" in *'.Config.Labels'*) printf '\n';; *'.Config.Env'*) printf '%s\n' 'PATH=/usr/bin' 'BEACON_GIT_SHA=${expected}';; esac; }
    image_revision sha256:${'a'.repeat(64)}
  `;
  const result = spawnSync('bash', ['-c', shell], {encoding:'utf8', env:{...process.env,
    HELPER:helper, HB_MIGRATION_BRIDGE_TEST_ROOT:sandbox, HB_MIGRATION_BRIDGE_SOURCE_ONLY:'1'}});
  await rm(sandbox, {recursive:true, force:true});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), expected);
});

test('LiveKit continuity enters its network namespace and does not use fenced host loopback', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'hb-migration-livekit-'));
  const helper = join(root, 'deploy/hb-migration-bridge-root'); const logPath = join(sandbox, 'probe.log');
  const shell = String.raw`
    source "$HELPER"
    docker() { case "$*" in *'.State.Running}} {{.State.Pid'*) printf 'true 4242\n';; *'.State.Running'*) printf 'true\n';; *'.State.Pid'*) printf '4242\n';; esac; }
    nsenter() { printf '%s\n' "$*" > "$HB_LOG"; }
    livekit_continuity
  `;
  const result = spawnSync('bash', ['-c', shell], {encoding:'utf8', env:{...process.env,
    HELPER:helper, HB_LOG:logPath, HB_MIGRATION_BRIDGE_TEST_ROOT:sandbox, HB_MIGRATION_BRIDGE_SOURCE_ONLY:'1'}});
  const invocation = await readFile(logPath, 'utf8'); await rm(sandbox, {recursive:true, force:true});
  assert.equal(result.status, 0, result.stderr);
  assert.match(invocation, /^--target 4242 --net -- python3 /);
  assert.doesNotMatch(invocation, /--mount|--pid|--root/);
});

test('runtime profile forwards supported false feature flags without jq truthiness failure', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'hb-migration-flags-'));
  const helper = join(root, 'deploy/hb-migration-bridge-root'); const profile = join(sandbox, 'profile.json');
  await writeFile(profile, JSON.stringify({schemaVersion:'harmonic-beacon.runtime-public-config.v1',
    publicOrigin:'https://example.invalid',livekitPublicUrl:'wss://livekit.example.invalid',
    featureFlags:{promoInvitations:false,tapestryPublic:false}}));
  const shell = String.raw`
    source "$HELPER"
    permit() { printf 'sha256:%064d\n' 0; }
    docker() { printf '%s %s\n' "$HB_PROMO_INVITATIONS_ENABLED" "$HB_TAPESTRY_PUBLIC_ENABLED"; }
    profile_compose "$PROFILE" compose image worker rehearsal config
  `;
  const result = spawnSync('bash', ['-c', shell], {encoding:'utf8', env:{...process.env, PROFILE:profile,
    HELPER:helper, HB_MIGRATION_BRIDGE_TEST_ROOT:sandbox, HB_MIGRATION_BRIDGE_SOURCE_ONLY:'1'}});
  await rm(sandbox, {recursive:true, force:true});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'false false');
});

async function stageResumeScenario(phase) {
  const sandbox = await mkdtemp(join(tmpdir(), 'hb-migration-stage-resume-'));
  const stateDir = join(sandbox, 'var/lib/harmonic-beacon/migration-bridge-v2');
  await mkdir(stateDir, {recursive:true});
  for (const path of [join(sandbox,'var'),join(sandbox,'var/lib'),join(sandbox,'var/lib/harmonic-beacon'),stateDir]) await chmod(path, 0o700);
  const permitId = 'a'.repeat(64); const logPath = join(sandbox, 'operations.log');
  await writeFile(join(stateDir, 'state.json'), JSON.stringify({permitId,phase,
    candidateImageId:`sha256:${'b'.repeat(64)}`,fenceState:'absent',
    migrationAttemptedToProduction:false,migrationAppliedToProduction:false}), {mode:0o600});
  const helper = join(root, 'deploy/hb-migration-bridge-root');
  const shell = String.raw`
    source "$HELPER"
    log() { printf '%s\n' "$1" >> "$HB_LOG"; }
    validate_permit() { :; }
    permit() { printf '%s\n' '${permitId}'; }
    build_candidate() { log build; }
    validate_staged_candidate() { log validate-staged; }
    run_stage_rehearsal() { log rehearse; }
    stage_resume
  `;
  const result = spawnSync('bash', ['-c', shell], {encoding:'utf8', env:{...process.env,
    HELPER:helper, HB_LOG:logPath, HB_MIGRATION_BRIDGE_TEST_ROOT:sandbox, HB_MIGRATION_BRIDGE_SOURCE_ONLY:'1'}});
  const operations = (await readFile(logPath, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
  await rm(sandbox, {recursive:true, force:true}); return {result,operations};
}

test('stage resume revalidates and rehearses the existing candidate without rebuilding', async () => {
  const {result,operations} = await stageResumeScenario('staging');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(operations, ['validate-staged','rehearse']);
});

test('stage resume rejects every non-staging phase before candidate reuse', async () => {
  const {result,operations} = await stageResumeScenario('staged');
  assert.notEqual(result.status, 0, result.stderr);
  assert.deepEqual(operations, []);
});

test('initial stage cannot overwrite any existing v2 transaction state', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'hb-migration-stage-existing-'));
  const stateDir = join(sandbox, 'var/lib/harmonic-beacon/migration-bridge-v2'); await mkdir(stateDir, {recursive:true});
  await writeFile(join(stateDir, 'state.json'), '{}', {mode:0o600});
  const helper = join(root, 'deploy/hb-migration-bridge-root');
  const shell = String.raw`
    source "$HELPER"
    validate_permit() { :; }
    build_candidate() { printf 'build\n'; }
    run_stage_rehearsal() { printf 'rehearse\n'; }
    stage_candidate
  `;
  const result = spawnSync('bash', ['-c', shell], {encoding:'utf8', env:{...process.env,
    HELPER:helper, HB_MIGRATION_BRIDGE_TEST_ROOT:sandbox, HB_MIGRATION_BRIDGE_SOURCE_ONLY:'1'}});
  await rm(sandbox, {recursive:true, force:true});
  assert.notEqual(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
});

test('rehearsal cleanup refuses a fixed-name container outside the bound project', async () => {
  const sandbox = await mkdtemp(join(tmpdir(), 'hb-migration-stage-container-'));
  const helper = join(root, 'deploy/hb-migration-bridge-root');
  const shell = String.raw`
    source "$HELPER"
    docker() { case "$*" in
      *'container ls'*) printf 'hb-migration-rehearsal-app\n';;
      *'container inspect'*) printf 'other-project\n';;
      *'rm -f'*) printf 'removed\n';;
    esac; }
    container_image() { printf 'sha256:%064d\n' 0; }
    remove_rehearsal_container hb-migration-rehearsal-app sha256:${'0'.repeat(64)}
  `;
  const result = spawnSync('bash', ['-c', shell], {encoding:'utf8', env:{...process.env,
    HELPER:helper, HB_MIGRATION_BRIDGE_TEST_ROOT:sandbox, HB_MIGRATION_BRIDGE_SOURCE_ONLY:'1'}});
  await rm(sandbox, {recursive:true, force:true});
  assert.notEqual(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /removed/);
});
