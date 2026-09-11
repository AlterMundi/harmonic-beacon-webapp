import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { qualifyTransitions, parseTransitionArgs, commandRunner, resolveExecutable } from '../qualify-transitions.mjs';
import { canonicalize, publicConfigSha256 as digest, candidateIdentitySha256, transitionStageContract, validateTransitionEvidence } from '../release-manifest.mjs';
import { validManifest } from './b2-fixture.mjs';
const { parse } = createRequire(import.meta.url)('yaml');
const services = ['postgres', 'livekit', 'app', 'commerce-reconciler', 'tapestry', 'playlist-bot', 'analytics'];
const project = `hbt-${'a'.repeat(32)}`;
const bytes = o => Buffer.from(canonicalize(o));
const imageId = ref => digest(ref);
const refs = m => Object.fromEntries([...m.artifacts, ...m.externalImages].map(a => [a.artifactId ?? a.serviceId, `${a.repository}@${a.digest}`]));
function acceptance(head) {
  return { browser: { engine: 'chromium', passed: 1, failed: 0, skipped: 0 }, syntheticSession: { created: 1, authenticatedRole: 'ADMIN' }, commerce: { workerHeartbeatAgeMs: 1, pending: 0, processing: 0 }, schema: { expectedHead: head, observedHead: head }, isolation: { internalNetworks: ['database', 'media'], forbiddenSecretNamesFound: [] }, restore: { backupSha256: digest('dump'), backupBytes: 4, restoredSessionCount: 1 } };
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'transition-test-'));
  function release(label, baseHash) {
    const dir = join(root, label);
    mkdirSync(dir);
    const put = (name, value) => { const path = join(dir, name); mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, value); return digest(value); };
    const m = validManifest();
    if (label === 'candidate') {
      m.source.gitSha = 'c'.repeat(40); m.source.gitTree = 'd'.repeat(40); m.build.workflowRunId = '34310000001';
      m.promotion.baseManifestSha256 = baseHash; m.rollback.manifestSha256 = baseHash;
      for (const a of m.artifacts) a.digest = digest(`candidate-${a.artifactId}`);
    }
    m.deploymentInputs.composeSha256 = put('docker-compose.yml', readFileSync('docker-compose.yml'));
    m.deploymentInputs.overlaySha256 = put('deploy/oci-images.compose.yml', readFileSync('deploy/oci-images.compose.yml'));
    for (const p of ['live-staging', 'production']) m.configProfiles[p].sha256 = put(`deploy/runtime-public-config/${p}.json`, readFileSync(`deploy/runtime-public-config/${p}.json`));
    for (const a of m.artifacts) {
      const prefix = `evidence/oci-evidence-${a.artifactId}/`;
      const record = { artifactId: a.artifactId, repository: a.repository, digest: a.digest, dockerfile: a.dockerfile, sourceSha: m.source.gitSha, sourceTree: m.source.gitTree, workflowRunId: m.build.workflowRunId, workflowRunAttempt: m.build.workflowRunAttempt };
      const statement = predicateType => ({ _type: 'https://in-toto.io/Statement/v1', subject: [{ name: a.repository, digest: { sha256: a.digest.slice(7) } }], predicateType });
      const sbom = { ...statement('https://spdx.dev/Document'), predicate: { spdxVersion: 'SPDX-2.3', SPDXID: 'SPDXRef-DOCUMENT', packages: [{}] } };
      const provenance = { ...statement('https://slsa.dev/provenance/v1'), predicate: { buildDefinition: { externalParameters: { source: { repository: m.source.repository, ref: 'refs/heads/main', gitSha: m.source.gitSha, gitTree: m.source.gitTree }, context: '.', dockerfile: a.dockerfile, platform: 'linux/amd64' } }, runDetails: { builder: { id: a.signature.identity }, metadata: { workflowRunId: m.build.workflowRunId, workflowRunAttempt: m.build.workflowRunAttempt, buildkitProvenance: {} } } } };
      a.sbom.digest = record.sbomDigest = put(`${prefix}sbom.bundle.json`, bytes(sbom));
      a.provenance.digest = record.provenanceDigest = put(`${prefix}provenance.bundle.json`, bytes(provenance));
      a.signature.bundleDigest = record.signatureBundleDigest = put(`${prefix}signature.bundle.json`, bytes({ fakeSignature: a.digest }));
      a.sbom.signatureBundleDigest = record.sbomSignatureBundleDigest = put(`${prefix}sbom.signature.bundle.json`, bytes({ fakeSignature: a.sbom.digest }));
      a.provenance.signatureBundleDigest = record.provenanceSignatureBundleDigest = put(`${prefix}provenance.signature.bundle.json`, bytes({ fakeSignature: a.provenance.digest }));
      a.evidenceRecordDigest = put(`${prefix}evidence.json`, bytes(record));
    }
    m.qualification.candidateIdentitySha256 = candidateIdentitySha256(m);
    m.qualification.runId = m.build.workflowRunId;
    const q = { schemaVersion: 'oci-qualification.v3', qualificationJob: 'qualify', measurementStartedAt: '2026-09-10T17:40:00.000Z', measurementCompletedAt: '2026-09-10T17:49:00.000Z', issuedAt: m.qualification.qualifiedAt, result: 'success', workflowRunId: m.build.workflowRunId, workflowRunAttempt: 1, candidateIdentitySha256: candidateIdentitySha256(m), imageRefs: refs(m), checkedServices: services, acceptance: acceptance(m.migrationSet.head) };
    m.qualification.receiptSha256 = put('qualification-receipt.json', bytes(q));
    const hash = put('release-manifest.json', bytes(m)).slice(7);
    put('release-manifest.signature.bundle.json', bytes({ fakeSignature: hash }));
    put('qualification-receipt.signature.bundle.json', bytes({ fakeSignature: m.qualification.receiptSha256 }));
    return { dir, m, expected: { manifestSha256: hash, sourceSha: m.source.gitSha, sourceTree: m.source.gitTree, runId: m.build.workflowRunId, runAttempt: 1 } };
  }
  const base = release('base');
  const candidate = release('candidate', base.expected.manifestSha256);
  const options = { candidateDir: candidate.dir, baseDir: base.dir, candidate: candidate.expected, base: base.expected, output: join(root, 'output') };
  return { root, base, candidate, options, close: () => rmSync(root, { recursive: true, force: true }) };
}
function fake(f, mutate = () => {}) {
  const calls = [];
  const runtimes = [];
  let running;
  let schema;
  let tick = Date.parse('2026-09-10T18:00:00.000Z');
  let uptime = 0;
  const clock = () => ++tick;
  const runner = (file, args, options) => {
    const resolvedFile = file;
    file = file.split('/').at(-1);
    const call = { file, resolvedFile, args, options };
    calls.push(call);
    const override = mutate(call, calls);
    if (override !== undefined) return override;
    let stdout = '';
    const configPath = args[args.indexOf('--file') + 1];
    const spec = () => JSON.parse(readFileSync(configPath));
    if (file === 'cosign') stdout = '{}';
    else if (file === 'npx') {
      assert.equal(args[0], '--no-install');
      assert.equal(options.env.E2E_BASE_URL, 'http://127.0.0.1:40000');
      assert.equal(options.env.HB_QUALIFICATION_APP_REF, running.services.app.image);
      stdout = JSON.stringify({ stats: { expected: 1, unexpected: 0, skipped: 0 } });
    } else if (file === 'curl') {
      const url = args.at(-1);
      const environment = running.services.app.environment;
      if (url.endsWith('/api/health')) stdout = JSON.stringify({ status: 'ok', uptime: ++uptime, gitSha: running.services.app.image === refs(f.base.m).app ? f.base.m.source.gitSha : f.candidate.m.source.gitSha, artifactDigest: running.services.app.image, configProfileSha256: environment.BEACON_CONFIG_PROFILE_SHA256 });
      else stdout = JSON.stringify({ status: url.endsWith(':40002/ready') ? 'ready' : 'ok' });
    } else if (file === 'docker') {
      if (args[0] === 'pull') assert.match(args[1], /@sha256:[a-f0-9]{64}$/);
      else if (args[0] === 'network') stdout = 'true';
      else if (args[0] === 'image') stdout = imageId(args[2]);
      else if (args[0] === 'inspect') {
        const service = args[1];
        const s = running.services[service];
        if (args.includes('--format')) stdout = Object.entries(s.environment ?? {}).map(([k, v]) => `${k}=${v}`).join('\n');
        else stdout = JSON.stringify([{ Image: imageId(s.image), Config: { Env: Object.entries(s.environment ?? {}).map(([k, v]) => `${k}=${v}`), Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': service } }, HostConfig: { Privileged: false, NetworkMode: `${project}_database` }, Mounts: [], NetworkSettings: { Ports: {} } }]);
      } else if (args[0] === 'compose') {
        const cmd = args[7];
        if (cmd === 'config') {
          if (configPath.endsWith('qualification.compose.yml')) {
            const text = readFileSync(configPath, 'utf8').replace(/\$\{([^}:]+)(?::[?\-][^}]*)?\}/g, (_, key) => options.env[key] ?? '12345');
            const template = parse(text, { merge: true });
            for (const [key, value] of Object.entries(template.networks)) template.networks[key] = value ?? {};
            for (const s of Object.values(template.services)) if (s.ports) s.ports = s.ports.map(p => ({ host_ip: '127.0.0.1', published: p.split(':')[1], target: Number(p.split(':')[2]) }));
            stdout = JSON.stringify(template);
          } else stdout = JSON.stringify(spec());
        } else if (cmd === 'up') { running = spec(); runtimes.push(structuredClone(running)); }
        else if (cmd === 'run') {
          if (args.includes('deploy')) schema = spec().services.migrate.image === refs(f.base.m).app ? f.base.m.migrationSet.head : f.candidate.m.migrationSet.head;
        } else if (cmd === 'ps') stdout = JSON.stringify(services.map(Service => ({ Service, ID: Service, Name: Service, State: 'running', Health: 'healthy' })));
        else if (cmd === 'port') stdout = `127.0.0.1:${{ app: 40000, tapestry: 40001, analytics: 40002, livekit: 40003 }[args[8]]}`;
        else if (cmd === 'exec') {
          if (args.includes('pg_dump')) stdout = 'real-fake-database-dump';
          else if (args.some(a => a.includes('migration_name'))) stdout = schema;
          else if (args.some(a => a.includes('backlog'))) stdout = '0,0';
          else if (args.some(a => a.includes('count(*)') || a.includes('heartbeat'))) stdout = '1';
        } else assert.equal(cmd, 'down');
      } else assert.fail(`unexpected Docker command ${args[0]}`);
    } else assert.fail(`unexpected executable ${file}`);
    return { exitCode: 0, stdout, stderr: '', timedOut: false };
  };
  const executableResolver = identity => ({ path: `/usr/bin/${identity}`, sha256: digest(`executable:${identity}`) });
  return { runner, clock, projectId: project, executableResolver, calls, runtimes };
}
function runCase(fn) { const f = fixture(); try { fn(f); } finally { f.close(); } }
const downCalls = fake => fake.calls.filter(c => c.args.includes('down'));

test('stateful control measures all three exact transitions and writes validator CLI inventory', () => runCase(f => {
  const deps = fake(f);
  const result = qualifyTransitions(f.options, deps);
  validateTransitionEvidence(result);
  assert.deepEqual(readdirSync(f.options.output).sort(), ['authorization.json', 'forward-repair.execution.json', 'forward-repair.json', 'qualification.json', 'rollback.execution.json', 'rollback.json', 'shadow.execution.json', 'shadow.json']);
  assert.equal(downCalls(deps).length, 1);
  assert.deepEqual(downCalls(deps)[0].args.slice(-3), ['down', '--remove-orphans', '--volumes']);
  assert.deepEqual(deps.runtimes.slice(1).map(s => s.services.app.image), [refs(f.base.m).app, refs(f.candidate.m).app, refs(f.candidate.m).app, refs(f.base.m).app, refs(f.candidate.m).app]);
  const evidenceHashes = new Set();
  for (const [stage, value] of Object.entries(result.stages)) {
    const e = JSON.parse(value.executionBytes);
    assert.ok(e.commands.length > 70 && e.commands.length <= 128);
    assert.deepEqual(e.commands.map(c => c.operation), transitionStageContract(stage).operations);
    assert.ok(e.commands.some(c => c.operation.startsWith('replace-')));
    assert.ok(e.commands.some(c => c.operation === 'check-browser-endpoints'));
    if (stage === 'shadow') assert.ok(e.commands.some(c => c.operation === 'migrate-candidate-app'));
    else assert.ok(e.observedRecoveryMs > 0 && e.observedRecoveryMs <= e.maxRecoveryMs);
    for (const command of e.commands) {
      assert.match(command.executableIdentity, /^\/usr\/bin\/(?:docker|curl|npx)$/u);
      for (const key of ['executableSha256', 'argvSha256', 'environmentSha256', 'stdinSha256', 'stdoutSha256', 'stderrSha256']) assert.match(command[key], /^sha256:[a-f0-9]{64}$/u);
    }
    for (const r of [e.runtimeBefore, e.runtimeAfter]) for (const k of ['runtimeCommandTranscriptSha256', 'healthCommandTranscriptSha256']) { assert.ok(!evidenceHashes.has(r[k])); evidenceHashes.add(r[k]); }
    assert.notEqual(e.runtimeBefore.privateBoundaryCommandTranscriptSha256, e.runtimeAfter.privateBoundaryCommandTranscriptSha256);
    assert.equal(readFileSync(join(f.options.output, `${stage}.execution.json`), 'utf8'), value.executionBytes.toString());
  }
  for (const c of deps.calls) { assert.ok(c.options.timeout > 0 && c.options.timeout <= 240000); assert.equal(c.options.maxBuffer, 16 * 1024 * 1024); assert.equal(c.resolvedFile, `/usr/bin/${c.file}`); }
  assert.equal(deps.calls.filter(c => c.file === 'cosign').length, 28);
  assert.equal(deps.calls.filter(c => c.file === 'npx').length, 4);
  // The issuer stores only hashes of argv and captures, not raw synthetic or credential material.
  const output = readdirSync(f.options.output).filter(p => p.includes('execution')).map(p => readFileSync(join(f.options.output, p), 'utf8')).join('');
  assert.doesNotMatch(output, /qualification-only|real-fake-database-dump|postgresql:|OCI Qualification Admin/);
}));

test('authentication rejection precedes JSON semantics for both releases', () => runCase(f => {
  writeFileSync(join(f.candidate.dir, 'release-manifest.json'), 'invalid JSON');
  const deps = fake(f, (c, calls) => calls.length === 4 ? { exitCode: 1, stdout: '', stderr: 'SECRET' } : undefined);
  assert.throws(() => qualifyTransitions(f.options, deps), /nonzero/);
  assert.equal(deps.calls.length, 4);
  assert.ok(deps.calls.every(c => c.file === 'cosign'));
  assert.ok(!existsSync(f.options.output));
}));
for (const label of ['candidate', 'base']) for (const field of ['manifestSha256', 'sourceSha', 'sourceTree', 'runId', 'runAttempt']) {
  test(`rejects ${label} expected ${field} contradiction before Docker`, () => runCase(f => {
    f.options[label][field] = field === 'runAttempt' ? 2 : '0'.repeat(64);
    const deps = fake(f);
    assert.throws(() => qualifyTransitions(f.options, deps), /contradiction/);
    assert.ok(deps.calls.every(c => c.file === 'cosign'));
  }));
}
for (const relative of ['docker-compose.yml', 'deploy/oci-images.compose.yml', 'deploy/runtime-public-config/production.json', 'evidence/oci-evidence-app/provenance.bundle.json']) {
  test(`rejects altered authenticated input ${relative}`, () => runCase(f => {
    writeFileSync(join(f.base.dir, relative), 'altered');
    const deps = fake(f);
    assert.throws(() => qualifyTransitions(f.options, deps), /contradiction|mismatch/);
    assert.ok(!existsSync(f.options.output));
  }));
}
function reseal(f) {
  const m = f.candidate.m;
  const q = JSON.parse(readFileSync(join(f.candidate.dir, 'qualification-receipt.json')));
  q.candidateIdentitySha256 = m.qualification.candidateIdentitySha256 = candidateIdentitySha256(m);
  q.imageRefs = refs(m);
  writeFileSync(join(f.candidate.dir, 'qualification-receipt.json'), bytes(q));
  m.qualification.receiptSha256 = digest(bytes(q));
  writeFileSync(join(f.candidate.dir, 'release-manifest.json'), bytes(m));
  f.options.candidate.manifestSha256 = digest(bytes(m)).slice(7);
}
for (const mode of ['base-hash', 'shared-dependency', 'compose-change', 'overlay-change']) {
  test(`authenticated semantic ${mode} contradiction rejects`, () => runCase(f => {
    const m = f.candidate.m;
    if (mode === 'base-hash') m.rollback.manifestSha256 = m.promotion.baseManifestSha256 = '0'.repeat(64);
    if (mode === 'shared-dependency') m.externalImages[0].digest = digest('other dependency');
    if (mode === 'compose-change' || mode === 'overlay-change') {
      const file = mode === 'compose-change' ? 'docker-compose.yml' : 'deploy/oci-images.compose.yml';
      const content = Buffer.concat([readFileSync(join(f.candidate.dir, file)), Buffer.from('\n# changed\n')]);
      writeFileSync(join(f.candidate.dir, file), content);
      m.deploymentInputs[mode === 'compose-change' ? 'composeSha256' : 'overlaySha256'] = digest(content);
    }
    reseal(f);
    const deps = fake(f);
    assert.throws(() => qualifyTransitions(f.options, deps), /base hash mismatch|shared dependency contradiction|Compose\/overlay transition unsupported/);
    assert.ok(deps.calls.every(c => c.file === 'cosign'));
  }));
}
for (const mode of ['nonzero', 'timeout', 'throw', 'wrong-image', 'wrong-config', 'private-network', 'static-health', 'missing-output', 'clock-order', 'recovery-timeout', 'cleanup']) {
  test(`rejects ${mode} and tears down the exact isolated stack`, () => runCase(f => {
    let fired = false;
    let firstHealth;
    const deps = fake(f, c => {
      const measurement = c.file === 'docker' && c.args[0] === 'inspect' && !c.args.includes('--format');
      if (mode === 'static-health' && c.file === 'curl' && c.args.at(-1).endsWith('/api/health')) {
        if (!firstHealth) firstHealth = JSON.stringify({ status: 'ok', uptime: 1, gitSha: f.base.m.source.gitSha, artifactDigest: refs(f.base.m).app, configProfileSha256: f.candidate.m.configProfiles['live-staging'].sha256 });
        return { exitCode: 0, stdout: firstHealth, stderr: '' };
      }
      if (mode === 'private-network' && c.args[0] === 'network') return { exitCode: 0, stdout: 'false', stderr: '' };
      if (mode === 'cleanup' && c.args.includes('down') && !fired) { fired = true; return { exitCode: 1, stdout: '', stderr: 'SECRET' }; }
      if (measurement && !fired && mode !== 'cleanup') {
        fired = true;
        if (mode === 'nonzero') return { exitCode: 1, stdout: 'SECRET', stderr: 'SECRET' };
        if (mode === 'timeout') return { exitCode: 0, timedOut: true, stdout: '', stderr: 'SECRET' };
        if (mode === 'throw') throw Error('SECRET');
        if (mode === 'missing-output') return undefinedResult;
        if (mode === 'clock-order') deps.clock = () => 0;
        if (mode === 'wrong-image') return { exitCode: 0, stdout: JSON.stringify([{ Image: 'sha256:' + '0'.repeat(64), Config: { Labels: { 'com.docker.compose.project': project, 'com.docker.compose.service': c.args[1] } } }]), stderr: '' };
      }
      if (mode === 'wrong-config' && c.file === 'curl' && c.args.at(-1).endsWith('/api/health')) return { exitCode: 0, stdout: JSON.stringify({ status: 'ok', uptime: 1, gitSha: f.base.m.source.gitSha, artifactDigest: refs(f.base.m).app, configProfileSha256: digest('wrong') }), stderr: '' };
    });
    // Clock closures are captured once; inject jumps only after stack creation.
    const normalClock = deps.clock;
    let clockRead = 0;
    if (mode === 'clock-order') deps.clock = () => deps.calls.some(c => c.args.includes('up')) && ++clockRead > 3 ? 0 : normalClock();
    if (mode === 'recovery-timeout') deps.clock = () => normalClock() + (deps.calls.filter(c => c.file === 'npx').length >= 2 ? 1000000 : 0);
    const errors = { nonzero: /nonzero/, timeout: /timeout/, throw: /command failed/, 'wrong-image': /wrong images/, 'wrong-config': /config mismatch/, 'private-network': /private network/, 'static-health': /static\/reused/, 'missing-output': /JSON/, 'clock-order': /timestamps/, 'recovery-timeout': /timeout/, cleanup: /nonzero/ };
    assert.throws(() => qualifyTransitions(f.options, deps), error => { assert.doesNotMatch(error.message, /SECRET/); assert.match(error.message, errors[mode]); return true; });
    assert.ok(downCalls(deps).length >= 1);
    for (const call of downCalls(deps)) { assert.equal(call.args[call.args.indexOf('--project-name') + 1], project); assert.deepEqual(call.args.slice(-3), ['down', '--remove-orphans', '--volumes']); }
    assert.ok(!existsSync(f.options.output));
  }));
}
const undefinedResult = { exitCode: 0, stdout: '', stderr: '' };

for (const [stage, browserCount] of [['shadow', 1], ['rollback', 2], ['forward-repair', 3]]) {
  test(`${stage} replacement failure cleans up without issuing partial evidence`, () => runCase(f => {
    let failed = false;
    const deps = fake(f, (c, calls) => {
      const expected = refs(stage === 'rollback' ? f.base.m : f.candidate.m).app;
      if (c.args.includes('up') && calls.filter(v => v.file === 'npx').length === browserCount &&
          JSON.parse(readFileSync(c.args[c.args.indexOf('--file') + 1])).services.app.image === expected) {
        failed = true;
        return { exitCode: 19, stdout: '', stderr: 'SECRET' };
      }
    });
    assert.throws(() => qualifyTransitions(f.options, deps), /nonzero/);
    assert.ok(failed);
    assert.equal(downCalls(deps).length, 1);
    assert.ok(!existsSync(f.options.output));
  }));
}
test('candidate migration failure cleans up before replacement', () => runCase(f => {
  let failed = false;
  const deps = fake(f, (c, calls) => {
    if (c.args.includes('deploy') && calls.filter(v => v.file === 'npx').length === 1) {
      failed = true;
      return { exitCode: 1, stdout: '', stderr: '' };
    }
  });
  assert.throws(() => qualifyTransitions(f.options, deps), /nonzero/);
  assert.ok(failed);
  assert.equal(downCalls(deps).length, 1);
  assert.ok(!existsSync(f.options.output));
}));
test('missing signature bundle and noncanonical authenticated manifest reject', () => runCase(f => {
  const original = readFileSync(join(f.candidate.dir, 'release-manifest.json'));
  writeFileSync(join(f.candidate.dir, 'release-manifest.json'), JSON.stringify(JSON.parse(original), null, 2));
  assert.throws(() => qualifyTransitions(f.options, fake(f)), /noncanonical/);
  writeFileSync(join(f.candidate.dir, 'release-manifest.json'), original);
  rmSync(join(f.base.dir, 'qualification-receipt.signature.bundle.json'));
  assert.throws(() => qualifyTransitions(f.options, fake(f)), /ENOENT/);
  assert.ok(!existsSync(f.options.output));
}));

test('validator rejects missing commands, timestamp disorder and reused execution bytes', () => runCase(f => {
  const result = qualifyTransitions(f.options, fake(f));
  for (const mutation of [e => e.commands = [], e => e.commands[1].startedAt = '2026-09-10T17:00:00.000Z']) {
    const copy = { ...result, stages: Object.fromEntries(Object.entries(result.stages).map(([k, v]) => [k, { ...v }])) };
    const execution = JSON.parse(copy.stages.shadow.executionBytes);
    mutation(execution);
    copy.stages.shadow.executionBytes = bytes(execution);
    const receipt = JSON.parse(copy.stages.shadow.receiptBytes);
    receipt.executionEvidenceSha256 = digest(copy.stages.shadow.executionBytes);
    copy.stages.shadow.receiptBytes = bytes(receipt);
    const authorization = JSON.parse(copy.authorizationBytes);
    authorization.stages.shadow = { executionEvidenceSha256: receipt.executionEvidenceSha256, receiptSha256: digest(copy.stages.shadow.receiptBytes) };
    copy.authorizationBytes = bytes(authorization);
    assert.throws(() => validateTransitionEvidence(copy));
  }
  const copy = { ...result, stages: Object.fromEntries(Object.entries(result.stages).map(([k, v]) => [k, { ...v }])) };
  copy.stages.rollback = copy.stages.shadow;
  assert.throws(() => validateTransitionEvidence(copy));
}));

test('full producer contract permits only exact refs, no source runtime or generic fallback, and exact cleanup', () => {
  const source = readFileSync(new URL('../qualify-transitions.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /['"](?:build|rebuild|push|latest|sign|sign-blob)['"]|execSync|shell:\s*true|sudo|hb-deploy-root/);
  assert.doesNotMatch(source, /docker-compose\.ya?ml['"]\s*\]|--build['"]|--pull['"],\s*['"]always/);
  assert.match(source, /'down', '--remove-orphans', '--volumes'/);
  assert.match(source, /finally\s*\{\s*deadline = Infinity/);
  assert.match(source, /'--no-build', '--pull', 'never'/);
  assert.match(source, /random\(16\)/);
  assert.match(source, /validateTransitionEvidence\(result\)/);
  assert.match(source, /verifyAcceptanceMatrix\(/);
  assert.match(source, /spawnSync\(file, args/);
  assert.throws(() => parseTransitionArgs(['--compose', 'docker-compose.yml']));
  assert.throws(() => parseTransitionArgs([]));
});

test('real argv runner bounds timeout and captures without throwing subprocess output', () => {
  const result = commandRunner(process.execPath, ['-e', "process.stdout.write('synthetic');process.stderr.write('secret');process.exitCode=7"], { timeout: 1000, env: {} });
  assert.equal(result.exitCode, 7);
  assert.equal(result.stdout.toString(), 'synthetic');
  const timeout = commandRunner(process.execPath, ['-e', 'setTimeout(()=>{},10000)'], { timeout: 10, env: {} });
  assert.equal(timeout.timedOut, true);
});

test('real executable resolver hashes and executes the same normalized absolute path', () => {
  const executable = resolveExecutable('curl', process.env);
  assert.equal(executable.path.startsWith('/'), true);
  assert.equal(executable.sha256, digest(readFileSync(executable.path)));
  const result = commandRunner(executable.path, ['--version'], { timeout: 1000, env: process.env });
  assert.equal(result.exitCode, 0);
});

// Real fixture signatures exercise byte authentication; they are not Fulcio/OIDC proof.
import { generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, cpSync, linkSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
test('full measured producer → signed fixture → hosted authorization → descriptor root admission', () => runCase(f => {
  const result = qualifyTransitions(f.options, fake(f));
  const repo = process.cwd();
  const fixedNow = result.now + 100;
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const issuer = 'https://token.actions.githubusercontent.com';
  const identity = kind => `https://github.com/AlterMundi/harmonic-beacon-webapp/.github/workflows/oci-${kind}.yml@refs/heads/main`;
  const seal = (root, name, kind) => writeFileSync(join(root, `${name}.signature.bundle.json`), JSON.stringify({ issuer, identity: identity(kind), signature: sign(null, readFileSync(join(root, `${name}.json`)), privateKey).toString('base64') }));
  cpSync(f.base.dir, join(f.root, 'base-candidate'), { recursive: true });
  const transition = join(f.candidate.dir, 'transition');
  cpSync(f.options.output, transition, { recursive: true });
  for (const dir of [f.candidate.dir, join(f.root, 'base-candidate')]) for (const name of ['release-manifest', 'qualification-receipt']) seal(dir, name, 'candidate');
  for (const name of ['authorization', 'shadow', 'rollback', 'forward-repair']) seal(transition, name, 'promote');
  const bin = join(f.root, 'bin'); mkdirSync(bin);
  const log = join(f.root, 'verification.log');
  writeFileSync(join(f.root, 'public.pem'), publicKey.export({ type: 'spki', format: 'pem' }));
  writeFileSync(join(bin, 'cosign'), `#!/usr/bin/env node
const fs=require('node:fs'),crypto=require('node:crypto'),a=process.argv.slice(2);
const b=JSON.parse(fs.readFileSync(a[a.indexOf('--bundle')+1]));
if(b.issuer!==a[a.indexOf('--certificate-oidc-issuer')+1] || b.identity!==a[a.indexOf('--certificate-identity')+1] || !crypto.verify(null,fs.readFileSync(a.at(-1)),fs.readFileSync(${JSON.stringify(join(f.root, 'public.pem'))}),Buffer.from(b.signature,'base64'))) process.exit(9);
fs.appendFileSync(${JSON.stringify(log)}, a.at(-1)+'\\n');
`); chmodSync(join(bin, 'cosign'), 0o755);
  const preload = join(f.root, 'clock.cjs'); writeFileSync(preload, `Date.now=()=>${fixedNow};`);
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, NODE_OPTIONS: `--require=${preload}`,
    BASE_CANDIDATE_RUN_ID: f.base.expected.runId, BASE_CANDIDATE_RUN_ATTEMPT: '1', BASE_SOURCE_SHA: f.base.expected.sourceSha, BASE_SOURCE_TREE: f.base.expected.sourceTree, BASE_MANIFEST_SHA256: f.base.expected.manifestSha256,
    CANDIDATE_RUN_ID: f.candidate.expected.runId, CANDIDATE_RUN_ATTEMPT: '1', SOURCE_SHA: f.candidate.expected.sourceSha, SOURCE_TREE: f.candidate.expected.sourceTree, MANIFEST_SHA256: f.candidate.expected.manifestSha256,
    TARGET: 'production', OPERATION: 'promote', RELEASE_LANE_STATE: 'oci-production', CONFIG_SHA256: f.candidate.m.configProfiles.production.sha256, GITHUB_RUN_ID: '987', GITHUB_RUN_ATTEMPT: '2' };
  const issue = (extra = {}) => {
    rmSync(join(f.candidate.dir, 'delivery-authorization.json'), { force: true });
    return spawnSync(process.execPath, [join(repo, 'scripts/ci/authorize-delivery.mjs')], { cwd: f.root, env: { ...env, ...extra }, encoding: 'utf8' });
  };
  assert.equal(issue().status, 0);
  const deliveryPath = join(f.candidate.dir, 'delivery-authorization.json');
  const delivery = JSON.parse(readFileSync(deliveryPath));
  assert.equal(delivery.transitionAuthorizationSha256, digest(result.authorizationBytes));
  assert.deepEqual(delivery.verbs, ['prepare', 'preflight', 'migrate', 'replace', 'status', 'rollback']);
  const helper = readFileSync('deploy/hb-deploy-root', 'utf8');
  const functions = helper.slice(helper.indexOf('admit_transition_evidence() {'), helper.indexOf('\natomic_install_release_state()'));
  const deliveryFn = helper.slice(helper.indexOf('admit_delivery_authorization() {'), helper.indexOf('\nrequire_delivery_invocation()'));
  const quote = v => `'${v.replaceAll("'", "'\\''")}'`;
  const transaction = join(f.root, 'transaction');
  const rootAdmit = () => {
    rmSync(transaction, { recursive: true, force: true }); mkdirSync(transaction);
    const script = `set -euo pipefail
RELEASE_MANIFEST=${quote(join(repo, 'scripts/ci/release-manifest.mjs'))}
die() { echo "$*" >&2; exit 9; }
# Test user cannot chown root. Production runs the same functions as root.
install() { local args=(); while [ "$#" -gt 0 ]; do case "$1" in -o|-g) shift 2;; *) args+=("$1"); shift;; esac; done; command install "\${args[@]}"; }
require_secure_root_file() { test -f "$1" && test ! -L "$1" && test "$(stat -c %a "$1")" = "$2"; }
admit_signature() { node "$RELEASE_MANIFEST" admit-signature --source "$1" --output "$2" --maximum-bytes 16777216 >/dev/null; }
${functions}
${deliveryFn}
admit_transition_evidence ${quote(f.candidate.dir)} ${quote(join(transaction, 'transition'))}
require_oci_transition_evidence ${quote(join(f.candidate.dir, 'release-manifest.json'))} ${quote(join(transaction, 'transition'))}
admit_delivery_authorization ${quote(f.candidate.dir)} ${quote(join(transaction, 'delivery'))}
node "$RELEASE_MANIFEST" validate-delivery --authorization ${quote(join(transaction, 'delivery/delivery-authorization.json'))} --manifest ${quote(join(f.candidate.dir, 'release-manifest.json'))} --source-sha "$SOURCE_SHA" --source-tree "$SOURCE_TREE" --manifest-sha256 "$MANIFEST_SHA256" --candidate-run-id "$CANDIDATE_RUN_ID" --candidate-run-attempt "$CANDIDATE_RUN_ATTEMPT" --delivery-run-id "$GITHUB_RUN_ID" --delivery-run-attempt "$GITHUB_RUN_ATTEMPT" --target production --config-sha256 "$CONFIG_SHA256" --output ${quote(join(transaction, 'receipt.json'))}
sync -f ${quote(join(transaction, 'receipt.json'))}
echo EFFECTS_ALLOWED
`;
    return spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });
  };
  seal(f.candidate.dir, 'delivery-authorization', 'promote');
  let admitted = rootAdmit(); assert.equal(admitted.status, 0, admitted.stderr); assert.match(admitted.stdout, /EFFECTS_ALLOWED/);
  assert.equal(readdirSync(join(transaction, 'transition')).length, 12);
  for (const [key, value] of [['BASE_CANDIDATE_RUN_ATTEMPT', '2'], ['CANDIDATE_RUN_ATTEMPT', '2'], ['CANDIDATE_RUN_ID', '123'], ['BASE_MANIFEST_SHA256', '0'.repeat(64)], ['BASE_SOURCE_SHA', '0'.repeat(40)]]) {
    assert.notEqual(issue({ [key]: value }).status, 0, key); assert.equal(existsSync(deliveryPath), false);
  }
  assert.equal(issue().status, 0); seal(f.candidate.dir, 'delivery-authorization', 'promote');
  const savedDelivery = readFileSync(deliveryPath);
  writeFileSync(deliveryPath, bytes({ ...delivery, transitionAuthorizationSha256: digest('wrong') })); seal(f.candidate.dir, 'delivery-authorization', 'promote');
  admitted = rootAdmit(); assert.notEqual(admitted.status, 0); assert.doesNotMatch(admitted.stdout, /EFFECTS_ALLOWED/);
  writeFileSync(deliveryPath, savedDelivery); seal(f.candidate.dir, 'delivery-authorization', 'promote');
  const inventory = readdirSync(transition);
  const original = Object.fromEntries(inventory.map(name => [name, readFileSync(join(transition, name))]));
  const restore = () => { for (const [name, value] of Object.entries(original)) { rmSync(join(transition, name), { force: true }); writeFileSync(join(transition, name), value); } };
  for (const mode of ['absent', 'unsigned', 'swapped', 'tampered', 'expired', 'wrong-attempt', 'wrong-base', 'wrong-issuer', 'wrong-identity', 'symlink', 'hardlink', 'parse-order']) {
    restore();
    if (mode === 'symlink' || mode === 'hardlink') { rmSync(join(transition, 'shadow.json')); (mode === 'symlink' ? symlinkSync : linkSync)(join(transition, 'rollback.json'), join(transition, 'shadow.json')); }
    if (mode === 'absent') rmSync(join(transition, 'authorization.json'));
    if (mode === 'unsigned') rmSync(join(transition, 'rollback.signature.bundle.json'));
    if (mode === 'swapped') writeFileSync(join(transition, 'shadow.signature.bundle.json'), original['rollback.signature.bundle.json']);
    if (mode === 'tampered') writeFileSync(join(transition, 'rollback.execution.json'), '{}');
    if (mode === 'parse-order') { writeFileSync(join(transition, 'authorization.json'), 'invalid JSON'); seal(transition, 'authorization', 'promote'); writeFileSync(join(transition, 'forward-repair.signature.bundle.json'), original['shadow.signature.bundle.json']); }
    if (['wrong-issuer', 'wrong-identity'].includes(mode)) {
      const bundle = JSON.parse(original['authorization.signature.bundle.json']);
      bundle[mode === 'wrong-issuer' ? 'issuer' : 'identity'] = 'https://untrusted.example';
      writeFileSync(join(transition, 'authorization.signature.bundle.json'), JSON.stringify(bundle));
    }
    if (['expired', 'wrong-attempt', 'wrong-base'].includes(mode)) {
      const a = JSON.parse(original['authorization.json']);
      if (mode === 'expired') a.expiresAt = new Date(fixedNow - 1).toISOString();
      if (mode === 'wrong-attempt') a.workflowRunAttempt++;
      if (mode === 'wrong-base') a.baseManifestSha256 = '0'.repeat(64);
      writeFileSync(join(transition, 'authorization.json'), bytes(a)); seal(transition, 'authorization', 'promote');
    }
    assert.notEqual(issue().status, 0, mode); assert.equal(existsSync(deliveryPath), false, mode);
    writeFileSync(deliveryPath, savedDelivery); seal(f.candidate.dir, 'delivery-authorization', 'promote');
    admitted = rootAdmit(); assert.notEqual(admitted.status, 0, mode); assert.doesNotMatch(admitted.stdout, /EFFECTS_ALLOWED/);
    if (mode === 'parse-order') assert.doesNotMatch(admitted.stderr, /SyntaxError|Unexpected token/);
  }
  restore();
  assert.ok(readFileSync(log, 'utf8').includes('/forward-repair.json'));
  for (const [target, operation, verbs] of [['shadow', 'promote', ['prepare', 'preflight', 'status']], ['production', 'rollback', ['rollback']]]) {
    rmSync(transition, { recursive: true, force: true });
    assert.equal(issue({ TARGET: target, OPERATION: operation, RELEASE_LANE_STATE: target === 'shadow' ? 'legacy-shadow' : 'oci-production', CONFIG_SHA256: f.candidate.m.configProfiles[target === 'shadow' ? 'live-staging' : 'production'].sha256 }).status, 0);
    const a = JSON.parse(readFileSync(deliveryPath)); assert.deepEqual(a.verbs, verbs); assert.equal(a.transitionAuthorizationSha256, null);
  }
}));
