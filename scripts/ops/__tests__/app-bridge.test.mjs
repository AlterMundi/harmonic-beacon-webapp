import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../../..');
const helperPath = join(root, 'deploy/hb-app-bridge-root');
const validatorPath = join(root, 'deploy/hb-app-bridge-archive.py');
const productionComposePath = join(root, 'deploy/hb-app-bridge-production.compose.yml');
const stagingComposePath = join(root, 'deploy/hb-app-bridge-staging.compose.yml');

async function source(path) {
  return readFile(path, 'utf8');
}

function python(script, ...args) {
  return spawnSync('python3', [script, ...args], { encoding: 'utf8' });
}

test('bridge exposes only exact stage/apply/rollback/status sudo commands', async () => {
  const sudoers = await source(join(root, 'deploy/hb-app-bridge.sudoers'));
  assert.doesNotMatch(sudoers, /hb-app-bridge \*/);
  for (const verb of ['stage', 'stage-rollback', 'stage-reapply', 'apply', 'rollback', 'recover', 'status']) {
    assert.match(sudoers, new RegExp(`/usr/local/sbin/hb-app-bridge ${verb}`));
  }
  assert.doesNotMatch(sudoers, /docker|sh\b|bash\b/);
});

test('production bridge is app-only and has a read-only fixed preflight', async () => {
  const compose = await source(productionComposePath);
  assert.match(compose, /^\s{2}app:/m);
  assert.match(compose, /^\s{2}preflight:/m);
  assert.doesNotMatch(compose, /^\s{2}(postgres|livekit|playlist-bot|tapestry|commerce-reconciler|migrate):/m);
  assert.match(compose, /scripts\/release-quiesce-preflight\.ts/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /name: app_beacon/);
  assert.match(compose, /name: pmp_beacon_internal/);
});

test('staging bridge reuses only the isolated existing app networks', async () => {
  const compose = await source(stagingComposePath);
  assert.match(compose, /^\s{2}app:/m);
  assert.doesNotMatch(compose, /^\s{2}(postgres|migrate|livekit|tapestry|commerce-reconciler):/m);
  assert.match(compose, /name: hb_live_staging_database/);
  assert.match(compose, /name: hb_live_staging_app_egress/);
});

test('helper never runs migration or replaces shared services', async () => {
  const helper = await source(helperPath);
  assert.doesNotMatch(helper, /prisma migrate|stage-grant-forward-drain/);
  assert.doesNotMatch(helper, /\b(up|stop|restart)\b[^\n]*(commerce-reconciler|tapestry|playlist-bot|postgres|livekit)/);
  assert.match(helper, /up -d --no-deps --force-recreate app/g);
  assert.match(helper, /production app image changed since permit review/);
  assert.match(helper, /staging no longer runs the candidate image/);
  assert.match(helper, /env -i PATH=/);
  assert.match(helper, /--connect-timeout 2 --max-time 5/g);
  assert.match(helper, /run_read_only_quiesce_preflight "\$candidate"/);
  assert.doesNotMatch(helper, /restore_production[^\n]+\|\| true/);
});

test('mocked command boundary rehearses, applies, rolls back and recovers app only', async () => {
  const area = mkdtempSync(join(tmpdir(), 'hb-app-bridge-flow-'));
  const bin = join(area, 'bin');
  const state = join(area, 'mock-state');
  const libexec = join(area, 'usr/local/libexec/harmonic-beacon');
  const etc = join(area, 'etc/harmonic-beacon');
  const bridgeEtc = join(etc, 'app-bridge');
  const bridgeRoot = join(area, 'var/lib/harmonic-beacon/app-bridge');
  await mkdir(bin, { recursive: true });
  await mkdir(state, { recursive: true });
  await mkdir(libexec, { recursive: true });
  await mkdir(bridgeEtc, { recursive: true });
  await mkdir(join(etc, 'live-production-secrets'), { recursive: true });
  await mkdir(join(bridgeRoot, 'inbox'), { recursive: true });
  await mkdir(join(area, 'run/lock'), { recursive: true });
  for (const path of [
    join(area, 'bin'), join(area, 'mock-state'), join(area, 'usr'), join(area, 'usr/local'),
    join(area, 'usr/local/libexec'), libexec, join(area, 'etc'), etc, bridgeEtc,
    join(etc, 'live-production-secrets'), join(area, 'var'), join(area, 'var/lib'),
    join(area, 'var/lib/harmonic-beacon'), bridgeRoot, join(bridgeRoot, 'inbox'),
    join(area, 'run'), join(area, 'run/lock'),
  ]) await chmod(path, 0o700);

  const sourceSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const sourceTree = spawnSync('git', ['rev-parse', 'HEAD^{tree}'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const candidate = `sha256:${'a'.repeat(64)}`;
  const productionBase = `sha256:${'c'.repeat(64)}`;
  const stagingBase = `sha256:${'b'.repeat(64)}`;
  const stagingBaseSha = '1'.repeat(40);
  const archive = join(bridgeRoot, 'inbox/candidate.tar');
  const archived = spawnSync('git', ['archive', '--format=tar', `--output=${archive}`, 'HEAD', '--', '.',
    ':(exclude).claude/skills/neon', ':(exclude).claude/skills/neon-postgres'], { cwd: root, encoding: 'utf8' });
  assert.equal(archived.status, 0, archived.stderr);

  await copyFile(productionComposePath, join(libexec, 'app-bridge-production.compose.yml'));
  await copyFile(stagingComposePath, join(libexec, 'app-bridge-staging.compose.yml'));
  await copyFile(validatorPath, join(libexec, 'hb-app-bridge-archive.py'));
  await copyFile(join(root, 'deploy/hb-app-bridge-livekit.py'), join(libexec, 'hb-app-bridge-livekit.py'));
  for (const path of [
    join(libexec, 'hb-app-bridge-archive.py'), join(libexec, 'hb-app-bridge-livekit.py'),
  ]) await chmod(path, 0o755);
  for (const path of [
    join(libexec, 'app-bridge-production.compose.yml'), join(libexec, 'app-bridge-staging.compose.yml'),
  ]) await chmod(path, 0o644);
  for (const path of [join(etc, 'production.env'), join(etc, 'live-staging.env'), join(etc, 'commerce.env')]) {
    await writeFile(path, 'POSTGRES_PASSWORD=test\n');
    await chmod(path, 0o600);
  }
  await writeFile(join(state, 'production.image'), productionBase);
  await writeFile(join(state, 'staging.image'), stagingBase);
  await writeFile(join(state, 'production.sha'), '9a40237a4042345c6c76c24ba4b492faa40ee03c');
  await writeFile(join(state, 'staging.sha'), stagingBaseSha);

  const dockerMock = `#!/usr/bin/env bash
set -euo pipefail
echo "$*" >> ${JSON.stringify(join(state, 'commands.log'))}
if [ "$1" = build ]; then echo ${candidate}; exit 0; fi
if [ "$1" = image ] && [ "$2" = inspect ]; then echo ${sourceSha}; exit 0; fi
if [ "$1" = network ]; then
  [[ "$*" == *Internal* ]] && { echo true; exit 0; }
  printf 'beacon-app\\npmp-myth-worker\\npmp-myth-worker-secondary\\n'; exit 0
fi
if [ "$1" = inspect ]; then
  name="$2"
  if [[ "$*" == *State.Health.Status* ]]; then echo healthy; exit 0; fi
  if [[ "$*" == *Config.Env* ]]; then printf 'BEACON_COMMERCE_SERVICE_KEY_CURRENT_ID=x\\nBEACON_COMMERCE_SERVICE_KEY_CURRENT=x\\n'; exit 0; fi
  [ "$name" = beacon-app ] && cat ${JSON.stringify(join(state, 'production.image'))} || cat ${JSON.stringify(join(state, 'staging.image'))}
  exit 0
fi
if [ "$1" = compose ]; then
  file=''; action=''
  for ((i=1;i<=$#;i++)); do
    value="${'$'}{!i}"
    [ "$value" = --file ] && { j=$((i+1)); file="${'$'}{!j}"; }
    { [ "$value" = up ] || [ "$value" = run ]; } && action="$value"
  done
  [ "$action" = run ] && { echo '{"safe":true,"liveSessions":0}'; exit 0; }
  target=staging; [[ "$file" == *production* ]] && target=production
  printf '%s' "$HB_APP_BRIDGE_IMAGE" > ${JSON.stringify(state)}/$target.image
  if [ "$HB_APP_BRIDGE_IMAGE" = ${candidate} ]; then printf '%s' ${sourceSha} > ${JSON.stringify(state)}/$target.sha;
  elif [ "$target" = production ]; then printf '%s' 9a40237a4042345c6c76c24ba4b492faa40ee03c > ${JSON.stringify(state)}/$target.sha;
  else printf '%s' ${stagingBaseSha} > ${JSON.stringify(state)}/$target.sha; fi
  exit 0
fi
exit 1
`;
  await writeFile(join(bin, 'docker'), dockerMock);
  await chmod(join(bin, 'docker'), 0o755);
  await writeFile(join(bin, 'curl'), `#!/usr/bin/env bash
set -euo pipefail
url="${'$'}{!#}"
target=production; [[ "$url" == *3200* ]] && target=staging
image="$(cat ${state}/$target.image)"
[ "$target" = production ] && [ -e ${state}/fail-candidate-health ] && [ "$image" = ${candidate} ] && exit 22
[ "$target" = production ] && [ -e ${state}/fail-base-health ] && [ "$image" != ${candidate} ] && exit 22
if [[ "$url" == */api/health/ready ]]; then echo '{"status":"ok"}'; else printf '{"schemaVersion":"health.response.v2","gitSha":"%s"}\\n' "$(cat ${state}/$target.sha)"; fi
`);
  await chmod(join(bin, 'curl'), 0o755);
  await writeFile(join(bin, 'python3'), `#!/usr/bin/env bash
if [[ "$1" == *hb-app-bridge-livekit.py ]]; then echo '{"safe":true,"rooms":1,"passiveParticipants":1}'; exit 0; fi
exec /usr/bin/python3 "$@"
`);
  await chmod(join(bin, 'python3'), 0o755);
  await writeFile(join(bin, 'sleep'), '#!/usr/bin/env bash\nexit 0\n');
  await chmod(join(bin, 'sleep'), 0o755);
  await writeFile(join(bin, 'chown'), '#!/usr/bin/env bash\nexit 0\n');
  await chmod(join(bin, 'chown'), 0o755);
  await writeFile(join(bin, 'install'), `#!/usr/bin/env bash
args=()
while [ "$#" -gt 0 ]; do
  case "$1" in -o|-g) shift 2;; *) args+=("$1"); shift;; esac
done
exec /usr/bin/install "${'$'}{args[@]}"
`);
  await chmod(join(bin, 'install'), 0o755);

  const digest = (path) => spawnSync('sha256sum', [path], { encoding: 'utf8' }).stdout.split(' ')[0];
  const entries = spawnSync('tar', ['-tf', archive], { encoding: 'utf8' }).stdout.trim().split('\n').length;
  const permit = {
    archiveBytes: Number(spawnSync('stat', ['-c', '%s', archive], { encoding: 'utf8' }).stdout),
    archiveEntries: entries,
    archiveSha256: digest(archive),
    archiveValidatorSha256: digest(join(libexec, 'hb-app-bridge-archive.py')),
    buildTime: '2026-09-21T00:00:00Z', databaseSchemaVersion: '20260908233000_create_sep9_internal_rehearsal',
    expiresAt: '2099-01-01T00:00:00Z', livekitProbeSha256: digest(join(libexec, 'hb-app-bridge-livekit.py')),
    permitId: 'd'.repeat(64), productionBaseGitSha: '9a40237a4042345c6c76c24ba4b492faa40ee03c',
    productionBaseImageId: productionBase, productionComposeSha256: digest(join(libexec, 'app-bridge-production.compose.yml')),
    schemaVersion: 'hb-app-bridge.permit.v1', sourceSha, sourceTree,
    stagingComposeSha256: digest(join(libexec, 'app-bridge-staging.compose.yml')),
  };
  await writeFile(join(bridgeEtc, 'permit.json'), JSON.stringify(permit));
  await chmod(join(bridgeEtc, 'permit.json'), 0o600);
  await chmod(archive, 0o600);

  const invoke = (verb) => spawnSync(helperPath, [verb], {
    cwd: root, encoding: 'utf8', env: { ...process.env, HB_APP_BRIDGE_TEST_ROOT: area },
  });
  for (const verb of ['stage', 'stage-rollback', 'stage-reapply']) {
    const result = invoke(verb);
    assert.equal(result.status, 0, `${verb}: ${result.stderr}`);
  }
  await writeFile(join(bridgeRoot, 'staging-rehearsal.json'), JSON.stringify({ outcome: 'passed', sourceSha, candidate }));
  await chmod(join(bridgeRoot, 'staging-rehearsal.json'), 0o600);
  const activation = {
    candidateImageId: candidate, expiresAt: '2099-01-01T00:00:00Z', permitId: permit.permitId,
    productionBaseImageId: productionBase, rehearsalReceiptSha256: digest(join(bridgeRoot, 'staging-rehearsal.json')),
    schemaVersion: 'hb-app-bridge.activation.v1',
  };
  await writeFile(join(bridgeEtc, 'activation.json'), JSON.stringify(activation));
  await chmod(join(bridgeEtc, 'activation.json'), 0o600);
  await writeFile(join(state, 'fail-candidate-health'), '1');
  await writeFile(join(state, 'fail-base-health'), '1');
  let result = invoke('apply');
  assert.notEqual(result.status, 0);
  assert.equal(JSON.parse(await source(join(bridgeRoot, 'state.json'))).phase, 'recovery-required');
  await unlink(join(state, 'fail-candidate-health'));
  await unlink(join(state, 'fail-base-health'));
  result = invoke('recover');
  assert.equal(result.status, 0, result.stderr);
  const reset = JSON.parse(await source(join(bridgeRoot, 'state.json')));
  reset.phase = 'rehearsed';
  await writeFile(join(bridgeRoot, 'state.json'), JSON.stringify(reset));
  await chmod(join(bridgeRoot, 'state.json'), 0o600);

  result = invoke('apply');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await source(join(state, 'production.image')), candidate);
  result = invoke('rollback');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await source(join(state, 'production.image')), productionBase);

  const transaction = JSON.parse(await source(join(bridgeRoot, 'state.json')));
  transaction.phase = 'applying';
  await writeFile(join(bridgeRoot, 'state.json'), JSON.stringify(transaction));
  await chmod(join(bridgeRoot, 'state.json'), 0o600);
  await writeFile(join(state, 'production.image'), candidate);
  await writeFile(join(state, 'production.sha'), sourceSha);
  result = invoke('recover');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await source(join(state, 'production.image')), productionBase);

  const commands = await source(join(state, 'commands.log'));
  assert.doesNotMatch(commands, /compose sha256:/, 'image id must not become a compose subcommand');
  assert.doesNotMatch(commands, /\b(migrate|commerce-reconciler|tapestry|playlist-bot|postgres|livekit)\b/);
});

test('archive validator extracts regular files deterministically', async () => {
  const area = mkdtempSync(join(tmpdir(), 'hb-app-bridge-'));
  const input = join(area, 'input');
  const output = join(area, 'output');
  await mkdir(join(input, 'src'), { recursive: true });
  await writeFile(join(input, 'Dockerfile'), 'FROM scratch\n');
  await writeFile(join(input, 'src', 'index.ts'), 'export {};\n');
  await chmod(join(input, 'Dockerfile'), 0o644);
  const archive = join(area, 'candidate.tar');
  const tar = spawnSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-cf', archive, '-C', input, '.'], { encoding: 'utf8' });
  assert.equal(tar.status, 0, tar.stderr);
  const listing = spawnSync('tar', ['-tf', archive], { encoding: 'utf8' });
  const count = listing.stdout.trim().split('\n').length;
  const result = python(validatorPath, archive, output, String(count));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await source(join(output, 'Dockerfile')), 'FROM scratch\n');
  assert.equal(await source(join(output, 'src', 'index.ts')), 'export {};\n');
});

test('archive validator rejects links and traversal before extraction', async () => {
  const area = mkdtempSync(join(tmpdir(), 'hb-app-bridge-reject-'));
  const makeArchive = join(area, 'make.py');
  await writeFile(makeArchive, String.raw`
import io, sys, tarfile
with tarfile.open(sys.argv[1], 'w') as out:
    link = tarfile.TarInfo('unsafe-link')
    link.type = tarfile.SYMTYPE
    link.linkname = '/etc/passwd'
    out.addfile(link)
`);
  const archive = join(area, 'bad.tar');
  assert.equal(python(makeArchive, archive).status, 0);
  const result = python(validatorPath, archive, join(area, 'output'), '1');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /links and special archive entries are forbidden/);

  await writeFile(makeArchive, String.raw`
import io, sys, tarfile
with tarfile.open(sys.argv[1], 'w') as out:
    item = tarfile.TarInfo('../escape')
    item.size = 1
    out.addfile(item, io.BytesIO(b'x'))
`);
  const traversal = join(area, 'traversal.tar');
  assert.equal(python(makeArchive, traversal).status, 0);
  const traversalResult = python(validatorPath, traversal, join(area, 'traversal-output'), '1');
  assert.notEqual(traversalResult.status, 0);
  assert.match(traversalResult.stderr, /unsafe archive path/);
});
